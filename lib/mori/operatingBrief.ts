/**
 * 모리 운영 브리핑.
 *
 * 매출·광고·CS·재고·발주·할일·일정을 한 번에 묶어 "오늘 뭐부터 볼지"를 만든다.
 * 채팅 tool_use와 능동 아침 브리핑이 같은 요약을 공유한다.
 */

import { getValidC24Token } from "@/lib/cafe24Auth";
import { getDashboardData, type DashboardData } from "@/lib/cafe24Data";
import { countThreadsByStatus } from "@/lib/cs/store";
import { loadInventoryFromStore } from "@/lib/inventorySync";
import { listPurchaseOrders, restockEta } from "@/lib/purchaseOrders";
import { fetchAdSummary, todayKstDate } from "@/lib/mori/adsLive";
import { loadTodayTasks, kstDateStr } from "@/lib/mori/tasks";
import { listTodayEvents } from "@/lib/today-hub/calendar";

const won = (n: number) => "₩" + Math.round(n).toLocaleString("ko-KR");

async function loadDashboard(): Promise<DashboardData | null> {
  const token = await getValidC24Token();
  if (!token) return null;
  return getDashboardData(token, "paulvice");
}

function salesLine(d: DashboardData | null): string {
  if (!d) return "매출: (불러오기 실패: 카페24 토큰 없음/만료 가능)";
  const s = d.salesSummary;
  const top =
    d.topProductsToday
      .slice(0, 3)
      .map((p) => `${p.name} ${p.sold}개`)
      .join(", ") || "오늘 판매 상품 없음";
  return [
    `매출: 오늘 ${won(s.today.revenue)} · ${s.today.orders}건 · 객단가 ${won(s.today.avgOrder)}`,
    `이번 주 ${won(s.week.revenue)} · ${s.week.orders}건 / 이번 달 ${won(s.month.revenue)} · ${s.month.orders}건`,
    `오늘 판매: ${top}`,
  ].join("\n");
}

function adsLine(ad: Awaited<ReturnType<typeof fetchAdSummary>>): string {
  if (!ad.ok) return `광고: (불러오기 실패: ${ad.error})`;
  if (ad.spend === 0 && ad.impressions === 0) {
    return "광고: 오늘 지출·노출 0 — 광고가 집행되지 않고 있음(중단/예산소진/심사반려 가능성)";
  }
  return (
    `광고: 지출 ${won(ad.spend)} · 노출 ${ad.impressions.toLocaleString("ko-KR")} · ` +
    `클릭 ${ad.clicks.toLocaleString("ko-KR")} · CTR ${ad.ctr.toFixed(2)}% · ` +
    `구매 ${ad.purchases}건 · ROAS ${ad.roas.toFixed(2)}`
  );
}

async function inventoryLine(d: DashboardData | null): Promise<{ text: string; lowCount: number }> {
  if (!d) return { text: "재고: (불러오기 실패)", lowCount: 0 };
  const entries = await loadInventoryFromStore().catch(
    (): Record<string, { discontinued?: boolean }> => ({}),
  );
  const discontinued = new Set(Object.keys(entries).filter((sku) => entries[sku].discontinued));
  const low = d.inventory
    .filter((i) => !discontinued.has(i.sku) && (i.status === "soldout" || i.status === "critical"))
    .sort((a, b) => a.stock - b.stock);
  if (low.length === 0) return { text: "재고: 품절·위험 품목 없음(단종 제외)", lowCount: 0 };
  const sample = low
    .slice(0, 6)
    .map((i) => `${i.name} ${i.status === "soldout" ? "품절" : `${i.stock}개`}`)
    .join(", ");
  return { text: `재고: 품절·위험 ${low.length}종 — ${sample}`, lowCount: low.length };
}

async function purchaseLine(): Promise<string> {
  const today = kstDateStr();
  const due = (await listPurchaseOrders())
    .filter((p) => {
      if (p.status !== "ordered") return false;
      const eta = restockEta(p);
      return today >= eta.start && today <= eta.end;
    })
    .slice(0, 5);
  if (due.length === 0) return "발주: 오늘 입고 예정 발주 없음";
  return `발주: 오늘 입고 확인 ${due.map((p) => `${p.productName} ${p.qty}개`).join(", ")}`;
}

async function tasksLine(): Promise<{ text: string; pendingCount: number; firstTask?: string }> {
  const { pending, total, doneCount } = await loadTodayTasks();
  if (total === 0) return { text: "할일: 오늘 등록된 할일 없음", pendingCount: 0 };
  if (pending.length === 0) return { text: `할일: ${total}개 중 ${doneCount}개 완료 — 전부 끝냄`, pendingCount: 0 };
  const list = pending.slice(0, 5).map((t) => t.title).join(", ");
  return {
    text: `할일: ${total}개 중 ${doneCount}개 완료, ${pending.length}개 남음 — ${list}`,
    pendingCount: pending.length,
    firstTask: pending[0]?.title,
  };
}

async function calendarLine(): Promise<string> {
  const events = await listTodayEvents();
  if (events.length === 0) return "일정: 오늘 등록된 일정 없음";
  return `일정: ${events.slice(0, 5).map((e) => `${e.time} ${e.title}`).join(", ")}`;
}

function buildPriorities(input: {
  d: DashboardData | null;
  ad: Awaited<ReturnType<typeof fetchAdSummary>>;
  unanswered: number | null;
  lowCount: number;
  pendingTasks: number;
  firstTask?: string;
}): string[] {
  const priorities: string[] = [];
  const todayOrders = input.d?.salesSummary.today.orders ?? null;

  if (todayOrders === 0) {
    priorities.push("오늘 주문 0건이면 광고 집행 여부와 클릭 후 전환 문제부터 확인");
  }
  if (input.ad.ok && input.ad.spend === 0 && input.ad.impressions === 0) {
    priorities.push("광고 지출·노출 0이면 캠페인 중단, 예산 소진, 심사 상태 확인");
  } else if (input.ad.ok && input.ad.clicks > 0 && input.ad.purchases === 0) {
    priorities.push("광고 클릭은 있는데 구매 0이면 상세페이지, 가격, 품절, 결제 흐름 확인");
  }
  if (input.unanswered != null && input.unanswered > 0) {
    priorities.push(`CS 미답변 ${input.unanswered}건 먼저 정리`);
  }
  if (input.lowCount > 0) {
    priorities.push(`품절·위험 재고 ${input.lowCount}종 확인 후 발주/노출 조정 판단`);
  }
  if (input.pendingTasks > 0 && input.firstTask) {
    priorities.push(`오늘 할일은 "${input.firstTask}"부터 처리`);
  }

  if (priorities.length === 0) {
    priorities.push("큰 경고 신호는 없으니 오늘 판매 상품과 광고 효율을 한 번만 점검");
  }

  return priorities.slice(0, 4);
}

export async function buildOperatingBrief(): Promise<string> {
  const today = todayKstDate();
  const [d, ad, cs, po, tasks, calendar] = await Promise.all([
    loadDashboard().catch(() => null),
    fetchAdSummary(today, today),
    countThreadsByStatus({ brand: "all" }).catch(() => null),
    purchaseLine().catch((e: any) => `발주: (불러오기 실패: ${e?.message ?? "오류"})`),
    tasksLine().catch((): { text: string; pendingCount: number; firstTask?: string } => ({
      text: "할일: (불러오기 실패)",
      pendingCount: 0,
    })),
    calendarLine().catch((e: any) => `일정: (불러오기 실패: ${e?.message ?? "오류"})`),
  ]);

  const inventory = await inventoryLine(d).catch(() => ({ text: "재고: (불러오기 실패)", lowCount: 0 }));
  const unanswered = cs?.unanswered ?? null;
  const priorities = buildPriorities({
    d,
    ad,
    unanswered,
    lowCount: inventory.lowCount,
    pendingTasks: tasks.pendingCount,
    firstTask: tasks.firstTask,
  });

  return `오늘 운영 브리핑 (${today}, KST)

${salesLine(d)}
${adsLine(ad)}
CS: ${cs ? `미답변 ${cs.unanswered}건 · 대기 ${cs.waiting}건 · 해결 ${cs.resolved}건` : "(불러오기 실패)"}
${inventory.text}
${po}
${tasks.text}
${calendar}

우선순위:
${priorities.map((p, i) => `${i + 1}. ${p}`).join("\n")}`;
}
