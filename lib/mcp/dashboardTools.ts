/**
 * MCP 조회(read) 툴 — claude.ai 커스텀 커넥터에서 회사 대시보드 데이터를 음성/채팅으로 물어보는 용도.
 * 각 핸들러는 기존 대시보드 데이터 함수를 얇게 감싼다(토큰은 서버측에서 취득).
 * 전부 읽기 전용. 실패해도 tool 결과에 error 문자열로 반환(크래시 X).
 */
import { getValidC24Token } from "@/lib/cafe24Auth";
import { getDashboardData } from "@/lib/cafe24Data";
import { computeAllBrandMer } from "@/lib/profit/mer";
import { getMetaTokenServer } from "@/lib/metaTokenStore";
import { computeInventoryLevels } from "@/lib/inventorySync";
import { getTasks } from "@/lib/today/tasks";
import { getActivity } from "@/lib/today/activity";
import { DOMAIN_LABEL } from "@/lib/today/types";
import { daysUntil, kstDateStr } from "@/lib/today/date";

type Brand = "paulvice" | "harriot";
const won = (n: number) => `₩${Math.round(n || 0).toLocaleString()}`;

export const READ_TOOLS = [
  {
    name: "get_sales_summary",
    description:
      "자사몰(cafe24) 매출 요약 조회 — 오늘/이번주/이번달/지난달 매출·주문수·객단가. 폴바이스·해리엇 브랜드별. '오늘 매출 어때?' 같은 질문에 사용. (외부 마켓 무신사·29CM·W컨셉은 미포함, 자사몰 기준.)",
    inputSchema: {
      type: "object",
      properties: {
        brand: { type: "string", enum: ["paulvice", "harriot"], description: "브랜드. 생략 시 둘 다." },
      },
    },
  },
  {
    name: "get_ad_performance",
    description:
      "메타 광고 성과 요약 조회 — 브랜드별 광고비·메타 어트리뷰션 매출·ROAS·자사몰 실매출·MER(자사몰매출÷광고비). '광고 효율 어때?', '요즘 ROAS?' 질문에 사용.",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "number", description: "최근 며칠 집계. 기본 7." },
      },
    },
  },
  {
    name: "get_inventory",
    description:
      "재고 조회 — 재고가 적은 품목(품절임박) 위주. '재고 부족한 거 있어?', '무슨 재고 얼마 남았어?' 질문에 사용.",
    inputSchema: {
      type: "object",
      properties: {
        brand: { type: "string", enum: ["paulvice", "harriot"], description: "브랜드. 기본 paulvice." },
        lowStockThreshold: { type: "number", description: "이 수량 이하만 표시. 기본 10." },
      },
    },
  },
  {
    name: "get_today_board",
    description:
      "오늘의 업무 보드(/today) 조회 — 오늘 할일과 완료 여부, 그리고 클로드 코드 세션에서 감지된 진행 중인 일을 폴바이스·해리엇·아르스·개인 4개 영역으로 나눠 반환. '오늘 뭐 해야 돼?', '내가 뭐 하고 있었지?', '이거 끝냈나?' 같은 질문에 사용. 사장님이 보드에서 체크한 완료 표시가 여기 반영된다 — 할일을 말하기 전에 먼저 이걸 확인해서 이미 끝낸 걸 다시 시키지 말 것.",
    inputSchema: {
      type: "object",
      properties: {
        domain: {
          type: "string",
          enum: ["paulvice", "harriot", "ars", "personal"],
          description: "이 영역만. 생략 시 전체.",
        },
      },
    },
  },
];

export const READ_TOOL_NAMES = new Set(READ_TOOLS.map((t) => t.name));

async function salesForBrand(brand: Brand): Promise<string> {
  const token = await getValidC24Token(brand);
  if (!token) return `${brand}: cafe24 토큰 없음`;
  const d = await getDashboardData(token, brand);
  const s = d.salesSummary;
  const line = (label: string, p: { revenue: number; orders: number; avgOrder: number }) =>
    `  ${label}: ${won(p.revenue)} · ${p.orders}건 · 객단가 ${won(p.avgOrder)}`;
  return [
    `[${brand} 자사몰]`,
    line("오늘", s.today),
    line("이번주", s.week),
    line("이번달", s.month),
    line("지난달", s.prevMonth),
  ].join("\n");
}

type DomainKey = "paulvice" | "harriot" | "ars" | "personal";

async function todayBoardText(only?: DomainKey): Promise<string> {
  const [{ tasks, error: taskError }, activity] = await Promise.all([getTasks(), getActivity()]);

  const pick = <T extends { domain: DomainKey }>(xs: T[]) => (only ? xs.filter((x) => x.domain === only) : xs);
  const myTasks   = pick(tasks as Array<{ domain: DomainKey } & (typeof tasks)[number]>);
  const myThreads = pick(activity.threads as Array<{ domain: DomainKey } & (typeof activity.threads)[number]>);

  const lines: string[] = [`[오늘의 보드] ${kstDateStr()}${only ? ` · ${DOMAIN_LABEL[only]}만` : ""}`, ""];

  const done = myTasks.filter((t) => t.done).length;
  lines.push(`■ 오늘 할일 (${done}/${myTasks.length})`);
  if (taskError) lines.push(`  (불러오기 실패: ${taskError})`);
  else if (myTasks.length === 0) lines.push("  (없음)");
  else {
    for (const t of myTasks) {
      const due = t.due ? (daysUntil(t.due) < 0 ? ` · ${-daysUntil(t.due)}일 지연` : daysUntil(t.due) === 0 ? " · 오늘 마감" : ` · D-${daysUntil(t.due)}`) : "";
      lines.push(`  ${t.done ? "[완료]" : "[    ]"} ${DOMAIN_LABEL[t.domain]}${t.side ? "(사이드)" : ""} · ${t.title}${due}`);
    }
  }

  lines.push("", `■ 진행 중 — 클로드 코드 세션에서 감지 (끝냄 처리된 ${activity.closedCount}개 제외)`);
  if (activity.error) lines.push(`  (스캔 없음: ${activity.error})`);
  else if (myThreads.length === 0) lines.push("  (없음)");
  else {
    for (const t of myThreads.slice(0, 25)) {
      const age = t.staleDays === 0 ? "오늘" : `${t.staleDays}일 전`;
      lines.push(`  ${DOMAIN_LABEL[t.domain]}${t.side ? "(사이드)" : ""} · ${age} · ${t.title}`);
    }
    if (myThreads.length > 25) lines.push(`  … 외 ${myThreads.length - 25}건`);
  }

  lines.push(
    "",
    "※ '진행 중' 목록은 세션 파일을 마지막으로 만진 시각으로 추린 것이라, 여기 있다고 해서",
    "  미완료라는 뜻은 아니다. 끝났는데 보드에서 '끝남'을 안 누른 것일 수 있으니,",
    "  오래된 항목을 할 일로 제시하기 전에 끝난 건 아닌지 먼저 물어볼 것.",
  );
  return lines.join("\n");
}

export async function callReadTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{ text: string; isError: boolean }> {
  try {
    if (name === "get_today_board") {
      const only = args.domain as DomainKey | undefined;
      return { text: await todayBoardText(only), isError: false };
    }

    if (name === "get_sales_summary") {
      const brand = args.brand as Brand | undefined;
      const brands: Brand[] = brand ? [brand] : ["paulvice", "harriot"];
      const parts = await Promise.all(brands.map(salesForBrand));
      return { text: parts.join("\n\n"), isError: false };
    }

    if (name === "get_ad_performance") {
      const days = Number(args.days) > 0 ? Number(args.days) : 7;
      const metaToken = await getMetaTokenServer();
      const mers = await computeAllBrandMer(days, metaToken);
      const text = mers
        .map(
          (m) =>
            `[${m.brand}] 최근 ${m.days}일\n` +
            `  광고비 ${won(m.metaSpend)} · 메타매출 ${won(m.metaPurchaseValue)}(${m.metaPurchaseCount}건) · 메타ROAS ${m.metaRoas.toFixed(2)}\n` +
            `  자사몰 실매출 ${won(m.selfMallRevenue)}(${m.selfMallOrders}건) · MER ${m.mer == null ? "—" : m.mer.toFixed(2)}`,
        )
        .join("\n\n");
      return { text: text || "광고 데이터 없음", isError: false };
    }

    if (name === "get_inventory") {
      const brand = (args.brand as Brand) || "paulvice";
      const thr = Number(args.lowStockThreshold) >= 0 ? Number(args.lowStockThreshold) : 10;
      const token = await getValidC24Token(brand);
      if (!token) return { text: `${brand}: cafe24 토큰 없음`, isError: true };
      const levels = await computeInventoryLevels(token, brand);
      const low = levels
        .filter((l) => l.currentStock <= thr)
        .sort((a, b) => a.currentStock - b.currentStock)
        .slice(0, 40);
      if (!low.length) return { text: `${brand}: 현재고 ${thr}개 이하 품목 없음`, isError: false };
      const text =
        `[${brand} 저재고 (현재고 ≤${thr}) · ${low.length}종]\n` +
        low
          .map((l) => `  ${l.sku}: ${l.currentStock}개 (초기 ${l.initialStock} · 판매 ${l.totalSold})${l.liveTracked ? " ·실시간추적" : ""}`)
          .join("\n");
      return { text, isError: false };
    }

    return { text: `Unknown read tool: ${name}`, isError: true };
  } catch (e) {
    return { text: `조회 실패(${name}): ${e instanceof Error ? e.message : String(e)}`, isError: true };
  }
}
