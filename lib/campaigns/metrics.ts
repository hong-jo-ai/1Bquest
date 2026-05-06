/**
 * Cafe24 주문에서 캠페인 매출/주문/구매자 명단 집계.
 *
 * 매칭 방식 (우선순위):
 *   1. campaign.productNos: 인플루언서 협업용 신상품 product_no — 주문의 items 중 이 product_no
 *      가 있으면 매칭 (옵션 차이 무관, 옵션은 상품 내부 옵션이라 product_no 동일).
 *   2. campaign.couponCode (legacy): productNos 비어있을 때만 fallback. 쿠폰이 적용된 주문 매칭.
 *
 * 두 경우 모두 — 매칭된 주문 전체 매출을 합산 (인플루언서가 데려온 주문 단위 인정).
 */
import { cafe24Get } from "@/lib/cafe24Client";
import { getValidC24Token } from "@/lib/cafe24Auth";
import type { Campaign, CampaignMetrics, CampaignBuyer } from "./types";

/** 캠페인 매칭용 — items + buyer + coupons 함께 embed 해서 가져옴. */
async function fetchOrdersWithDetails(
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
      embed:      "items,buyer,coupons",
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
  payment_date?: string | null;
  payment_amount?: string;
  total_amount?: string;
  order_price_amount?: string;
  actual_order_amount?: string;
  actual_payment_amount?: string;
  paid_amount?: string;
  naverpay_pay_amount?: string;
  ordered_date?: string;
  order_date?: string;
  buyer_name?:  string;
  buyer_email?: string;
  buyer_cellphone?: string;
  member_email?: string;
  email?: string;
  cellphone?: string;
  items?: Array<{
    actual_quantity?: number | string;
    quantity?: number | string;
    order_price?: string | number;
    product_price?: string | number;
    product_no?:    number | string;
  }>;
  /** embed=coupons 시 채워짐 */
  coupons?: Array<{
    coupon_code?: string;
    coupon_no?: string;
    benefit_text?: string;
    benefit_amount?: string;
  }>;
}

function orderHasProduct(order: RawOrder, productNos: Set<number>): boolean {
  for (const it of order.items ?? []) {
    const pn = Number(it.product_no);
    if (Number.isFinite(pn) && productNos.has(pn)) return true;
  }
  return false;
}

function orderHasCoupon(order: RawOrder, couponCode: string): boolean {
  const target = couponCode.trim().toLowerCase();
  if (!target) return false;
  for (const c of order.coupons ?? []) {
    if ((c.coupon_code ?? "").trim().toLowerCase() === target) return true;
  }
  return false;
}

// cafe24Data 의 orderRevenue 와 동일 로직 — 네이버페이 전액 결제 포함.
import { orderRevenue as cafe24OrderRevenue, isPaidOrder } from "@/lib/cafe24Data";
function orderRevenue(order: RawOrder): number {
  return cafe24OrderRevenue(order);
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

  const productNos = (campaign.productNos ?? []).filter((n) => Number.isFinite(n) && n > 0);
  const hasProductMatch = productNos.length > 0;
  const hasCouponMatch  = !hasProductMatch && !!campaign.couponCode?.trim();
  const matchedBy: CampaignMetrics["matchedBy"] = hasProductMatch ? "product" : hasCouponMatch ? "coupon" : "none";

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
      matchedBy,
    };
  }

  if (matchedBy === "none") {
    return {
      campaignId: campaign.id,
      windowStart, windowEnd,
      ordersCount: 0, revenue: 0, avgOrder: 0,
      buyers: [],
      matchedBy: "none",
      warning: "협업 상품 번호 또는 쿠폰 코드가 없습니다 — 캠페인을 편집해 product_no 를 지정하세요.",
    };
  }

  const token = await getValidC24Token();
  if (!token) {
    return {
      campaignId: campaign.id,
      windowStart, windowEnd,
      ordersCount: 0, revenue: 0, avgOrder: 0,
      buyers: [],
      matchedBy,
      warning: "Cafe24 미연결 — 토큰 갱신 후 다시 조회하세요.",
    };
  }

  // 입금전 주문은 매출/ROAS에서 제외 — 자동 취소되는 케이스 많음
  const orders = (await fetchOrdersWithDetails(token, windowStart, windowEnd)).filter(isPaidOrder);

  let matched: RawOrder[];
  let warning: string | undefined;

  if (matchedBy === "product") {
    const productSet = new Set(productNos);
    matched = orders.filter((o) => orderHasProduct(o, productSet));

    // 진단: items 가 비어있는 주문이 많으면 embed 누락 의심
    const hasAnyItems = orders.some((o) => (o.items?.length ?? 0) > 0);
    if (!hasAnyItems && orders.length > 0) {
      warning = "Cafe24 주문 응답에 items 정보가 없습니다 — embed 옵션 확인 필요.";
    }
  } else {
    matched = orders.filter((o) => orderHasCoupon(o, campaign.couponCode!));

    const hasAnyCouponInfo = orders.some((o) => (o.coupons?.length ?? 0) > 0);
    if (!hasAnyCouponInfo && orders.length > 0) {
      warning = "Cafe24 주문 응답에 쿠폰 정보(coupons)가 없습니다 — embed 옵션 또는 admin 권한 확인 필요.";
    }
  }

  const revenue = matched.reduce((s, o) => s + orderRevenue(o), 0);
  const ordersCount = matched.length;
  const avgOrder = ordersCount > 0 ? Math.round(revenue / ordersCount) : 0;
  const buyers = matched.map(orderToBuyer);

  return {
    campaignId: campaign.id,
    windowStart, windowEnd,
    ordersCount, revenue, avgOrder,
    buyers,
    matchedBy,
    warning,
  };
}
