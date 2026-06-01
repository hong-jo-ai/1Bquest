/**
 * 대시보드 state 직렬화 — 모리가 "지금 보고 있는 화면".
 *
 * 매출·광고·CS·재고/발주 4개 소스를 텍스트 블록으로 조립해 모리 system 프롬프트에 주입한다.
 * 각 소스는 독립적으로 try/catch — 하나가 실패해도 나머지는 살아남고, 실패 항목은
 * "(불러오기 실패)"로 표시된다. API 재호출이 아니라 "옆에서 같이 화면 보는" 구조.
 */

import { getValidC24Token } from "@/lib/cafe24Auth";
import { getDashboardData, type DashboardData } from "@/lib/cafe24Data";
import { listRecommendations } from "@/lib/mads/dbStore";
import { countThreadsByStatus } from "@/lib/cs/store";
import { listPurchaseOrders, restockEta } from "@/lib/purchaseOrders";
import { loadInventoryFromStore } from "@/lib/inventorySync";
import { loadTodayTasks } from "@/lib/mori/tasks";

const won = (n: number) => "₩" + Math.round(n).toLocaleString("ko-KR");

/** 매출 + 재고 (둘 다 카페24 대시보드 데이터에서 나옴 → 토큰 1회로 묶음). */
async function salesAndInventoryBlock(): Promise<{ sales: string; inventory: string }> {
  const token = await getValidC24Token();
  if (!token) {
    const fail = "(불러오기 실패: 카페24 토큰 없음/만료)";
    return { sales: fail, inventory: fail };
  }
  const d: DashboardData = await getDashboardData(token, "paulvice");
  const s = d.salesSummary;

  const top = d.topProductsToday
    .slice(0, 3)
    .map((p) => `${p.rank}. ${p.name} ${p.sold}개 ${won(p.revenue)}`)
    .join(" / ") || "오늘 판매 없음";

  const sales = [
    `오늘: ${won(s.today.revenue)} · ${s.today.orders}건 (객단가 ${won(s.today.avgOrder)})`,
    `이번 주: ${won(s.week.revenue)} · ${s.week.orders}건`,
    `이번 달: ${won(s.month.revenue)} · ${s.month.orders}건 (전월 ${won(s.prevMonth.revenue)})`,
    `오늘 잘나가는 상품: ${top}`,
  ].join("\n");

  // 전 품목 재고를 재고 적은 순으로 주입한다.
  // (예전엔 품절·위험만 넣어, 정상 재고 제품이 컨텍스트에서 빠져 모리가 "재고 없음"이라 오답했다.)
  const entries = await loadInventoryFromStore().catch((): Record<string, { discontinued?: boolean }> => ({}));
  const discontinued = new Set(Object.keys(entries).filter((s) => entries[s].discontinued));
  const RANK: Record<string, number> = { soldout: 0, critical: 1, warning: 2, ok: 3 };
  const statusKo = (s: string) => (s === "soldout" ? "품절" : s === "critical" ? "위험" : s === "warning" ? "부족" : "양호");
  // 문제 품목(품절·부족) 먼저, 그다음 재고 적은 순.
  const sorted = [...d.inventory].sort(
    (a, b) => (RANK[a.status] - RANK[b.status]) || a.stock - b.stock,
  );
  const soldout = sorted.filter((i) => i.status === "soldout" && !discontinued.has(i.sku)).length;
  const critical = sorted.filter((i) => i.status === "critical" && !discontinued.has(i.sku)).length;
  const head = `총 ${sorted.length}품목 · 품절 ${soldout} · 위험 ${critical} (단종 제외)`;
  const lines = sorted
    .map((i) => {
      // tracked=false: 카페24 재고관리 미사용 → 수량 무의미, 판매중/품절로만.
      const qty =
        i.tracked === false
          ? i.status === "soldout"
            ? "품절"
            : "판매중(재고관리 안 함)"
          : `재고 ${i.stock}개 · ${statusKo(i.status)}`;
      const dc = discontinued.has(i.sku) ? " · 단종" : "";
      return `${i.name} (${i.sku}): ${qty}${dc}`;
    })
    .join("\n");
  const inventory = sorted.length === 0 ? "(상품 없음)" : `${head}\n${lines}`;

  return { sales, inventory };
}

/** 광고 — MADS 대기 중 추천 요약 (ROAS·예산·액션). */
async function adsBlock(): Promise<string> {
  const recs = await listRecommendations("pending", 50);
  if (recs.length === 0) return "MADS 대기 중 추천 없음 (현재 손 댈 광고세트 없음)";
  return recs
    .slice(0, 8)
    .map((r) => {
      const adset = r.adset?.name ?? "광고세트";
      const roas = r.trust?.roas7d;
      const roasStr = typeof roas === "number" ? `ROAS ${roas.toFixed(2)}` : "";
      const cur = r.currentBudget != null ? won(r.currentBudget) : "?";
      const rec = r.recommendedBudget != null ? won(r.recommendedBudget) : "?";
      return `· [${r.actionType}] ${adset} — ${roasStr} / 일예산 ${cur}→${rec} : ${r.reason}`;
    })
    .join("\n");
}

/** CS — 미답/대기 건수. */
async function csBlock(): Promise<string> {
  const c = await countThreadsByStatus({ brand: "all" });
  return `미답변 ${c.unanswered}건 · 대기 ${c.waiting}건 (해결 ${c.resolved})`;
}

/** 발주 — 진행 중(ordered) 건의 재입고 ETA. */
async function purchaseBlock(): Promise<string> {
  const pos = (await listPurchaseOrders()).filter((p) => p.status === "ordered");
  if (pos.length === 0) return "진행 중인 발주 없음";
  return pos
    .map((p) => {
      const eta = restockEta(p);
      return `· ${p.productName} ${p.qty}개 (${p.supplier || "공급사?"}) — 입고예정 ${eta.start}~${eta.end}`;
    })
    .join("\n");
}

/** 오늘 할일 — 미완료 우선, 진척(완료/전체) 표시. */
async function tasksBlock(): Promise<string> {
  const { pending, doneCount, total } = await loadTodayTasks();
  if (total === 0) return "오늘 등록된 할일 없음";
  const head = `오늘 할일 ${total}개 중 ${doneCount}개 완료, ${pending.length}개 남음`;
  if (pending.length === 0) return `${head} (전부 끝냄)`;
  const list = pending.map((t) => `· [${t.category}] ${t.title}`).join("\n");
  return `${head}\n${list}`;
}

async function safe(label: string, fn: () => Promise<string>): Promise<string> {
  try {
    return await fn();
  } catch (e: any) {
    return `(불러오기 실패: ${e?.message ?? "알 수 없는 오류"})`;
  }
}

/**
 * 4개 소스를 모아 모리에게 주입할 단일 컨텍스트 블록을 만든다.
 * 매출/재고는 한 번에 묶어 처리하고, 나머지는 병렬.
 */
export async function assembleDashboardContext(): Promise<string> {
  const [si, ads, cs, po, tasks] = await Promise.all([
    salesAndInventoryBlock().catch((e: any) => {
      const fail = `(불러오기 실패: ${e?.message ?? "알 수 없는 오류"})`;
      return { sales: fail, inventory: fail };
    }),
    safe("ads", adsBlock),
    safe("cs", csBlock),
    safe("po", purchaseBlock),
    safe("tasks", tasksBlock),
  ]);

  return `# 지금 대시보드 상태 (실시간 — 폴바이스 기준)

## 매출
${si.sales}

## 광고 (MADS 추천 대기열)
${ads}

## CS
${cs}

## 재고 (전 품목 · 재고 적은 순)
${si.inventory}

## 발주 (재입고 예정)
${po}

## 오늘 할일
${tasks}`;
}
