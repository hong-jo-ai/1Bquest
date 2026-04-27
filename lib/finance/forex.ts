/**
 * 외환 환율 — USD → KRW 변환.
 * 식스샵 글로벌처럼 결제 단위가 USD인 채널의 데이터를 KRW로 통일.
 *
 * 환율은 일별 변동하지만 P&L 합산 목적상 단일 기준 환율 사용.
 * 추후 사용자가 ⚙에서 변경 원하면 profitSettings에 키 추가.
 */
import type { MultiChannelData } from "@/lib/multiChannelData";

export const USD_TO_KRW = 1450;

/**
 * MultiChannelData의 모든 금액 필드를 USD에서 KRW로 환산.
 * 수량/주문수는 그대로 유지.
 */
export function convertUsdToKrw(data: MultiChannelData, rate: number = USD_TO_KRW): MultiChannelData {
  const x = (n: number | undefined) => Math.round((n ?? 0) * rate);

  return {
    salesSummary: {
      today: {
        revenue: x(data.salesSummary.today.revenue),
        orders: data.salesSummary.today.orders,
        avgOrder: x(data.salesSummary.today.avgOrder),
      },
      week: {
        revenue: x(data.salesSummary.week.revenue),
        orders: data.salesSummary.week.orders,
        avgOrder: x(data.salesSummary.week.avgOrder),
      },
      month: {
        revenue: x(data.salesSummary.month.revenue),
        orders: data.salesSummary.month.orders,
        avgOrder: x(data.salesSummary.month.avgOrder),
      },
      prevMonth: {
        revenue: x(data.salesSummary.prevMonth.revenue),
        orders: data.salesSummary.prevMonth.orders,
        avgOrder: x(data.salesSummary.prevMonth.avgOrder),
      },
    },
    topProducts: data.topProducts.map((p) => ({
      ...p,
      revenue: x(p.revenue),
    })),
    hourlyOrders: data.hourlyOrders.map((h) => ({
      ...h,
      revenue: x(h.revenue),
    })),
    weeklyRevenue: data.weeklyRevenue.map((w) => ({
      ...w,
      revenue: x(w.revenue),
    })),
    dailyRevenue: data.dailyRevenue?.map((d) => ({
      ...d,
      revenue: x(d.revenue),
    })),
    dailyCogs: data.dailyCogs?.map((c) => ({
      ...c,
      cost: x(c.cost),
    })),
    inventory: data.inventory,
  };
}
