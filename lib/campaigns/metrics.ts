/**
 * Cafe24 주문에서 캠페인 매출/주문/구매자 명단 집계.
 *
 * 매칭 방식: 캠페인의 couponCode 와 일치하는 쿠폰이 적용된 주문만 합산.
 * Cafe24 orders.embed=coupons 응답의 `o.coupons` 배열을 검사.
 */
import { cafe24Get } from "@/lib/cafe24Client";
import { getValidC24Token } from "@/lib/cafe24Auth";
import type { Campaign, CampaignMetrics, CampaignBuyer } from "./types";

/** 캠페인 매칭용 — coupons + buyer 함께 embed 해서 가져옴. */
async function fetchOrdersWithCoupons(
  token:     string,
  startDate: string,
  endDate:   string,
): Promise<RawOrder[]> {
  const all: RawOrder[] = [];
  let offset = 0;
  const limit = 100;
  while (true) {
    const qs = new URLSearchParams({
      start_date: startDate,
      end_date:   endDate,
      limit:      String(limit),
      offset:     String(offset),
      embed:      "coupons,buyer",
    });
    const data = await cafe24Get(`/api/v2/admin/orders?${qs}`, token);
    const batch: RawOrder[] = data.orders ?? [];
    all.push(...batch);
    if (batch.length < limit) break;
    offset += limit;
  }
  return all;
}

function kstToday(): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

interface RawOrder {
  order_id?:     string;
  payment_amount?: string;
  total_amount?: string;
  order_price_amount?: string;
  paid_amount?: string;
  ordered_date?: string;
  order_date?: string;
  buyer_name?:  string;
  buyer_email?: string;
  buyer_cellphone?: string;
  member_email?: string;
  email?: string;
  cellphone?: string;
  /** embed=coupons 시 채워짐 */
  coupons?: Array<{
    coupon_code?: string;
    coupon_no?: string;
    benefit_text?: string;
    benefit_amount?: string;
  }>;
}

function orderHasCoupon(order: RawOrder, couponCode: string): boolean {
  const target = couponCode.trim().toLowerCase();
  if (!target) return false;
  for (const c of order.coupons ?? []) {
    if ((c.coupon_code ?? "").trim().toLowerCase() === target) return true;
  }
  return false;
}

function orderRevenue(order: RawOrder): number {
  return parseFloat(
    order.payment_amount ??
    order.paid_amount ??
    order.total_amount ??
    order.order_price_amount ??
    "0"
  );
}

function orderToBuyer(order: RawOrder): CampaignBuyer {
  return {
    orderId:   order.order_id ?? "",
    email:     order.buyer_email ?? order.member_email ?? order.email ?? null,
    phone:     order.buyer_cellphone ?? order.cellphone ?? null,
    name:      order.buyer_name ?? null,
    amount:    Math.round(orderRevenue(order)),
    orderedAt: order.ordered_date ?? order.order_date ?? "",
  };
}

export async function computeCampaignMetrics(
  campaign: Campaign,
): Promise<CampaignMetrics> {
  const today = kstToday();
  const windowStart = campaign.startDate;
  const windowEnd   = (campaign.endDate && campaign.endDate <= today) ? campaign.endDate : today;

  // 캠페인 시작 전이면 빈 메트릭
  if (windowStart > today) {
    return {
      campaignId: campaign.id,
      windowStart,
      windowEnd:  windowStart,
      ordersCount: 0,
      revenue: 0,
      avgOrder: 0,
      buyers: [],
      matchedBy: campaign.couponCode ? "coupon" : "none",
    };
  }

  if (!campaign.couponCode || !campaign.couponCode.trim()) {
    return {
      campaignId: campaign.id,
      windowStart, windowEnd,
      ordersCount: 0, revenue: 0, avgOrder: 0,
      buyers: [],
      matchedBy: "none",
      warning: "쿠폰 코드 미설정 — 캠페인을 편집해 코드를 지정하면 매칭됩니다.",
    };
  }

  const token = await getValidC24Token();
  if (!token) {
    return {
      campaignId: campaign.id,
      windowStart, windowEnd,
      ordersCount: 0, revenue: 0, avgOrder: 0,
      buyers: [],
      matchedBy: "coupon",
      warning: "Cafe24 미연결 — 토큰 갱신 후 다시 조회하세요.",
    };
  }

  const orders = await fetchOrdersWithCoupons(token, windowStart, windowEnd);

  const matched = orders.filter((o) => orderHasCoupon(o, campaign.couponCode!));
  const revenue = matched.reduce((s, o) => s + orderRevenue(o), 0);
  const ordersCount = matched.length;
  const avgOrder = ordersCount > 0 ? Math.round(revenue / ordersCount) : 0;

  const buyers = matched.map(orderToBuyer);

  // 쿠폰 정보가 비어있는지 진단
  const hasAnyCouponInfo = orders.some((o) => (o.coupons?.length ?? 0) > 0);
  const warning =
    !hasAnyCouponInfo && orders.length > 0
      ? "Cafe24 주문 응답에 쿠폰 정보(coupons)가 없습니다 — fetchAllOrders 의 embed 옵션 확인 또는 Cafe24 admin 권한 확인 필요."
      : undefined;

  return {
    campaignId: campaign.id,
    windowStart, windowEnd,
    ordersCount, revenue, avgOrder,
    buyers,
    matchedBy: "coupon",
    warning,
  };
}
