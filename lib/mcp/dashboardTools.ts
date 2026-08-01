/**
 * MCP 조회(read) 툴 — claude.ai 커스텀 커넥터에서 회사 대시보드 데이터를 음성/채팅으로 물어보는 용도.
 * 각 핸들러는 기존 대시보드 데이터 함수를 얇게 감싼다(토큰은 서버측에서 취득).
 * 전부 읽기 전용. 실패해도 tool 결과에 error 문자열로 반환(크래시 X).
 */
import { getValidC24Token } from "@/lib/cafe24Auth";
import { getDashboardData } from "@/lib/cafe24Data";
import { computeAllBrandMer } from "@/lib/profit/mer";
import { getMetaTokenServer } from "@/lib/metaTokenStore";
import { loadInventoryFromStore } from "@/lib/inventorySync";

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

export async function callReadTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{ text: string; isError: boolean }> {
  try {
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
      const inv = await loadInventoryFromStore(brand);
      const rows = Object.entries(inv)
        .map(([sku, e]) => {
          const en = e as unknown as Record<string, unknown>;
          const qty = Number(en.current ?? en.qty ?? en.stock ?? en.available ?? NaN);
          const nm = String(en.name ?? en.productName ?? sku);
          return { sku, nm, qty };
        })
        .filter((r) => Number.isFinite(r.qty) && r.qty <= thr)
        .sort((a, b) => a.qty - b.qty)
        .slice(0, 30);
      if (!rows.length) return { text: `${brand}: ${thr}개 이하 품목 없음(또는 재고 데이터 형식 확인 필요)`, isError: false };
      const text = `[${brand} 재고 ${thr}개 이하 · ${rows.length}종]\n` + rows.map((r) => `  ${r.nm} (${r.sku}): ${r.qty}개`).join("\n");
      return { text, isError: false };
    }

    return { text: `Unknown read tool: ${name}`, isError: true };
  } catch (e) {
    return { text: `조회 실패(${name}): ${e instanceof Error ? e.message : String(e)}`, isError: true };
  }
}
