/**
 * 외환 환율 — USD → KRW 변환.
 * 영문몰(shop_no=2)처럼 결제 단위가 USD인 채널의 데이터를 KRW로 통일.
 *
 * 환율은 일별 변동하지만 P&L 합산 목적상 **단일 기준 환율**을 쓴다.
 * 일별 실환율로 바꾸면 과거 매출 수치가 소급해서 흔들려 기준선 비교가 깨진다.
 *
 * 2026-09-10: 하드코딩 1450 → **비용 설정(⚙)에서 변경 가능**하게 바꿨다.
 * 값을 읽을 땐 `getUsdToKrw()` 를 쓸 것. `USD_TO_KRW` 는 설정을 못 읽는
 * 동기 문맥(순수 파서 등)에서만 쓰는 **폴백 기본값**이다.
 * ⚠️ 파쇼 USD 지급액 환산은 여기가 아니라 **당일 매매기준율**을 쓴다(별개 규칙).
 */
import type { MultiChannelData } from "@/lib/multiChannelData";
export { getUsdToKrw } from "@/lib/profitSettings";

/** 폴백 기본값. 실제 값은 getUsdToKrw() 로 읽는다. */
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
