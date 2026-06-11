import { createClient } from "@supabase/supabase-js";
import { cafe24Get } from "./cafe24Client";
import { getProductCogs } from "./profitSettings";
import { loadCafe24Historical, mergeCafe24HistoricalDaily } from "./cafe24Historical";
import type { Brand, MultiChannelData } from "./multiChannelData";

// ── 타입 정의 ──────────────────────────────────────────────────────────────

export interface PeriodSummary {
  revenue: number;
  orders: number;
  avgOrder: number;
}

export interface SalesSummaryData {
  today: PeriodSummary;
  week: PeriodSummary;
  month: PeriodSummary;
  prevMonth: PeriodSummary;
}

export interface ProductRank {
  rank: number;
  name: string;
  sku: string;
  sold: number;
  revenue: number;
  image: string;
}

export interface HourlyData {
  hour: string;
  orders: number;
  revenue: number;
}

export interface WeeklyData {
  day: string;
  revenue: number;
  orders: number;
}

export interface DailyData {
  date: string; // YYYY-MM-DD (KST)
  revenue: number;
  orders: number;
  /** 합배송 그룹핑 후 실제 배송 건수. 없으면 orders와 동일하게 사용. */
  shipments?: number;
}

export interface DailyCost {
  date: string;
  cost: number;
}

export interface InventoryItem {
  name: string;
  sku: string;
  stock: number;
  threshold: number;
  status: "soldout" | "critical" | "warning" | "ok";
  /** 카페24 재고관리(use_inventory) 사용 여부. false면 stock은 의미 없고 sold_out으로만 판단(판매중/품절). */
  tracked?: boolean;
}

export interface DashboardData {
  salesSummary: SalesSummaryData;
  topProducts: ProductRank[];        // 이번 달
  topProductsToday: ProductRank[];   // 오늘
  topProductsWeek: ProductRank[];    // 이번 주
  hourlyOrders: HourlyData[];
  weeklyRevenue: WeeklyData[];
  dailyRevenue: DailyData[]; // 최근 60일치 일별 매출
  dailyCogs: DailyCost[];     // 최근 60일치 일별 매입원가
  unmatchedSkus: string[];   // COGS 미설정 SKU (UI에 경고 표시용)
  inventory: InventoryItem[];
  /** 공동구매 채널로 분리된 공구 상품(226 등) 매출 — 카페24 합계에서는 제외됨 */
  groupBuyLive?: MultiChannelData;
  isReal: true;
}

// ── 날짜 유틸 (KST) ────────────────────────────────────────────────────────

function kstNow() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

function kstStr(d: Date) {
  return d.toISOString().slice(0, 10);
}

function kstHour(isoString: string): number {
  const d = new Date(isoString);
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.getUTCHours();
}

function kstDateStr(isoString: string): string {
  const d = new Date(isoString);
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

// ── 주문 페이징 조회 ───────────────────────────────────────────────────────

export async function fetchAllOrders(
  token: string,
  startDate: string,
  endDate: string,
  embedItems = true,
) {
  const all: any[] = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const params: Record<string, string> = {
      start_date: startDate,
      end_date:   endDate,
      limit:      String(limit),
      offset:     String(offset),
    };
    if (embedItems) params.embed = "items";

    const qs   = new URLSearchParams(params);
    const data = await cafe24Get(`/api/v2/admin/orders?${qs}`, token);
    const batch: any[] = data.orders ?? [];
    all.push(...batch);
    if (batch.length < limit) break;
    offset += limit;
  }
  return all;
}

/**
 * 주문 1건의 실제 매출 금액.
 *
 * Cafe24는 결제수단별로 금액 필드가 분산되어 있어서,
 * 네이버페이 전액 결제처럼 외부 PG로 처리되는 케이스는 total_amount/payment_amount가
 * 0으로 들어오는 경우가 있음. 이 헬퍼는 모든 fallback을 시도해 실제 매출을 추출:
 *
 *   1) 표준 필드: total_amount → payment_amount → actual_payment_amount
 *   2) 0이면 naverpay_pay_amount (네이버페이 전액 결제 케이스)
 *   3) 그래도 0이면 order_price_amount (주문가 = 상품가 합계)
 *   4) 마지막 수단: items 배열 합산
 */
export function orderRevenue(o: {
  total_amount?: string | number;
  payment_amount?: string | number;
  actual_payment_amount?: string | number;
  naverpay_pay_amount?: string | number;
  order_price_amount?: string | number;
  actual_order_amount?: string | number;
  items?: Array<{
    actual_quantity?: number | string;
    quantity?: number | string;
    order_price?: string | number;
    product_price?: string | number;
  }>;
}): number {
  const num = (v: unknown): number => {
    const n = parseFloat(String(v ?? "0"));
    return Number.isFinite(n) ? n : 0;
  };

  // 1) 표준 매출 필드 (대부분의 주문은 여기서 결정됨)
  const std = num(o.total_amount) || num(o.payment_amount) || num(o.actual_payment_amount);
  if (std > 0) return std;

  // 2) 네이버페이 전액 결제 — payment_amount/total_amount가 0이고
  //    naverpay_pay_amount만 채워지는 케이스
  const npay = num(o.naverpay_pay_amount);
  if (npay > 0) return npay;

  // 3) 주문가 (상품가 합계) — 할인/배송비 미포함이지만 0보다는 정확
  const orderPrice = num(o.actual_order_amount) || num(o.order_price_amount);
  if (orderPrice > 0) return orderPrice;

  // 4) items 배열에서 직접 합산
  if (Array.isArray(o.items)) {
    return o.items.reduce((s, it) => {
      const qty = num(it.actual_quantity ?? it.quantity ?? 1) || 1;
      const price = num(it.order_price) || num(it.product_price);
      return s + price * qty;
    }, 0);
  }

  return 0;
}

/**
 * 단일 라인 아이템의 실수령 매출 (취소/반품 차감 후).
 *
 * 캠페인/공구 수수료 정산처럼 "특정 상품만의 매출"이 필요한 경우 사용 — orderRevenue()
 * 는 주문 전체 결제액이라서 같은 주문에 다른 상품이 섞이면 부풀려진다.
 *
 * 계산: qty × (product_price + option_price) − coupon_discount_price − additional_discount_price
 *   - quantity 는 actual_quantity 우선 (취소/반품 제외된 실 수량). 없으면 quantity − claim_quantity.
 *   - product_price/option_price 는 단가, 할인 필드는 Cafe24 규약상 라인 합계.
 *   - 결과 음수는 0으로 보정 (예: 전액 쿠폰 + 환불 케이스).
 */
export function lineItemRevenue(it: {
  quantity?: number | string;
  actual_quantity?: number | string;
  claim_quantity?: number | string;
  product_price?: string | number;
  option_price?: string | number;
  coupon_discount_price?: string | number;
  additional_discount_price?: string | number;
}): number {
  const num = (v: unknown): number => {
    const n = parseFloat(String(v ?? "0"));
    return Number.isFinite(n) ? n : 0;
  };
  let qty = num(it.actual_quantity);
  if (qty === 0) qty = Math.max(0, num(it.quantity) - num(it.claim_quantity));
  if (qty === 0) return 0;
  const base    = num(it.product_price);
  const opt     = num(it.option_price);
  const coupon  = num(it.coupon_discount_price);
  const extra   = num(it.additional_discount_price);
  return Math.max(0, qty * (base + opt) - coupon - extra);
}


/**
 * 결제가 확정된 주문만 매출로 집계하기 위한 필터.
 *
 * 카페24 `order_status` 흐름: N00 입금전 → N10 배송준비중 → … → N30 배송완료
 * (취소: N40/N41, 반품: N50, 교환: N60)
 *
 * 무통장입금으로 주문만 걸어두고 입금하지 않아 자동 취소되는 케이스가 흔해서,
 * 입금 확인 전(N00) 상태는 매출에 포함하지 않는다.
 *
 * 판단 기준 (lib/bankDeposit/matcher.ts:isUnpaid 와 동일):
 *   - `payment_date` 가 채워졌으면 결제 확정.
 *   - 비어있더라도 `actual_payment_amount > 0` 이면 결제됨 (외부 PG 케이스).
 *   - 둘 다 없으면 미결제 → 매출에서 제외.
 *
 * (결제 후 취소는 isCanceledOrder 로 별도 제외 — 아래 참조. 매출 기준은 결제일 그대로.)
 */
export function isPaidOrder(o: {
  payment_date?: string | null;
  actual_payment_amount?: string | number;
}): boolean {
  if (typeof o.payment_date === "string" && o.payment_date.trim() !== "") return true;
  const paid = parseFloat(String(o.actual_payment_amount ?? "0"));
  return Number.isFinite(paid) && paid > 0;
}

/**
 * 전체취소된 주문 — 매출에서 제외.
 *
 * 카페24 주문의 `canceled` 플래그: "F"=정상, "T"=전체취소, "M"=부분취소.
 * 결제 후 취소돼도 `payment_date`/`total_amount` 가 그대로 남아 매출이 과대계상되던 문제를
 * 막기 위해, "T"(전체취소)는 통째로 제외한다.
 *
 * "M"(부분취소/교환)은 주문이 살아있고 order_price_amount·payment_amount 가 이미 취소·교환분을
 * 반영한 실결제액이라(검증: 교환주문 20260505-0000028 payment_amount=31,000), orderRevenue 그대로 사용.
 * 라인아이템 netting 은 actual_quantity 누락 시 교환분을 이중계상해 오히려 부정확 → 쓰지 않는다.
 *
 * (배송완료 후 반품/교환은 canceled 가 "T"로 안 바뀔 수 있어 여기선 못 거른다 — 추후 claim/refund 신호 보완.)
 */
export function isCanceledOrder(o: { canceled?: string | null }): boolean {
  return o.canceled === "T";
}

// ── 공동구매 채널 분리 ────────────────────────────────────────────────────
// 카페24에 등록된 공구 전용 상품(예: 226)은 매출을 '공동구매' 채널로 분리한다.
// 카페24 채널 = 자사몰 순수 매출(공구 제외), 공구 채널 = 공구 상품 매출.

/** 공구 상품 번호 — kv_store(bysoy_consolidated:product) + 기본 226. 향후 공구 추가 시 union. */
export async function getGroupBuyProductNos(): Promise<Set<number>> {
  const set = new Set<number>([226]);
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    try {
      const db = createClient(url, key);
      const { data } = await db
        .from("kv_store")
        .select("data")
        .eq("key", "bysoy_consolidated:product")
        .maybeSingle();
      const pn = (data?.data as { productNo?: number } | null)?.productNo;
      if (Number.isFinite(pn)) set.add(Number(pn));
    } catch { /* kv 실패 시 기본값만 */ }
  }
  return set;
}

interface OrderSplit { cafe24: number; groupbuy: number; gbQty: number }

/**
 * 주문을 카페24/공구 매출로 분리.
 *   - 공구 상품만 있는 주문 → 통째로 공구(배송비 포함).
 *   - 섞인 주문 → 공구 상품 라인만 공구, 나머지는 카페24.
 *   - 공구 상품 없는 주문 → 전부 카페24.
 */
function splitOrderRevenue(o: any, gbNos: Set<number>): OrderSplit {
  const items = (o.items ?? []) as any[];
  const total = orderRevenue(o);
  const gbItems = items.filter((it) => gbNos.has(Number(it.product_no)));
  if (gbItems.length === 0) return { cafe24: total, groupbuy: 0, gbQty: 0 };

  let gbQty = 0;
  let gbLine = 0;
  for (const it of gbItems) {
    gbLine += lineItemRevenue(it);
    const raw = Number(it.actual_quantity ?? it.quantity ?? 0) || 0;
    const claim = Number(it.claim_quantity ?? 0) || 0;
    gbQty += Math.max(0, raw - claim);
  }
  const allGb = items.every((it) => gbNos.has(Number(it.product_no)));
  if (allGb) return { cafe24: 0, groupbuy: total, gbQty };
  return { cafe24: Math.max(0, total - gbLine), groupbuy: gbLine, gbQty };
}

/** revOf(주문)>0 인 주문만 카운트해서 기간 요약. */
function summarizeBy(orders: any[], revOf: (o: any) => number): PeriodSummary {
  let revenue = 0;
  let count = 0;
  for (const o of orders) {
    const r = revOf(o);
    if (r > 0) { revenue += r; count++; }
  }
  return { revenue: Math.round(revenue), orders: count, avgOrder: count > 0 ? Math.round(revenue / count) : 0 };
}

// ── 상품별 판매 순위 빌더 ─────────────────────────────────────────────────

export function buildRanking(
  orders: any[],
  limit = 10,
  itemFilter?: (item: any) => boolean,
): ProductRank[] {
  const pMap: Record<string, { name: string; sku: string; sold: number; revenue: number }> = {};
  orders.forEach((order) => {
    (order.items ?? []).forEach((item: any) => {
      if (itemFilter && !itemFilter(item)) return;
      const key = String(item.product_no ?? item.product_code ?? item.product_name);
      if (!pMap[key]) {
        pMap[key] = {
          name: item.product_name ?? "알 수 없음",
          sku: item.product_code ?? "",
          sold: 0,
          revenue: 0,
        };
      }
      const qty = item.actual_quantity ?? item.quantity ?? 1;
      pMap[key].sold += qty;
      pMap[key].revenue += parseFloat(item.order_price ?? item.product_price ?? "0") * qty;
    });
  });
  return Object.values(pMap)
    .sort((a, b) => b.sold - a.sold)
    .slice(0, limit)
    .map((p, i) => ({ rank: i + 1, ...p, revenue: Math.round(p.revenue), image: "⌚" }));
}

// ── 메인 데이터 조회 ──────────────────────────────────────────────────────

export async function getDashboardData(token: string, brand: Brand = "paulvice"): Promise<DashboardData> {
  const now = kstNow();
  const todayStr = kstStr(now);

  // 이번 주 월요일
  const weekStart = new Date(now);
  const dow = now.getUTCDay(); // 0=일
  weekStart.setUTCDate(now.getUTCDate() - (dow === 0 ? 6 : dow - 1));
  const weekStartStr = kstStr(weekStart);

  // 이번 달 1일
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthStartStr = kstStr(monthStart);

  // 지난 달 범위
  const prevMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const prevMonthEnd   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  const prevMonthStartStr = kstStr(prevMonthStart);
  const prevMonthEndStr   = kstStr(prevMonthEnd);

  // 이번 달 + 지난 달 주문 + 상품 목록(재고 variant 포함) 병렬 조회.
  // 상품은 진열중 전체를 페이지네이션(100개 초과 누락 방지) + embed=variants 로 재고까지 한 번에.
  const fetchProducts = async (): Promise<any[]> => {
    const out: any[] = [];
    for (let offset = 0; offset < 1000; offset += 100) {
      const res = await cafe24Get(
        `/api/v2/admin/products?limit=100&offset=${offset}&display=T&embed=variants`,
        token,
      );
      const batch: any[] = res.products ?? [];
      out.push(...batch);
      if (batch.length < 100) break;
    }
    return out;
  };
  const [rawMonthOrders, rawPrevMonthOrders, allProducts] = await Promise.all([
    fetchAllOrders(token, monthStartStr, todayStr),
    fetchAllOrders(token, prevMonthStartStr, prevMonthEndStr),
    fetchProducts(),
  ]);

  // 입금전(N00) 주문은 매출에서 제외 — 무통장 입금 미완료로 자동 취소되는 케이스가 잦음.
  // 입금 확인 후 배송준비중(N10) 이상으로 넘어간 주문만 진짜 매출로 본다.
  // 추가: 결제 후 전체취소(canceled="T")도 제외 — 과대계상 방지. (부분취소 M은 살림 — payment_amount가 이미 실결제분 반영)
  const keep = (o: any) => isPaidOrder(o) && !isCanceledOrder(o);
  const monthOrders     = rawMonthOrders.filter(keep);
  const prevMonthOrders = rawPrevMonthOrders.filter(keep);

  // ── 공동구매 채널 분리 — 공구 상품(226 등)은 카페24에서 빼고 공구로 ──────
  const gbNos = await getGroupBuyProductNos();
  const splitCache = new Map<any, OrderSplit>();
  const splitOf = (o: any): OrderSplit => {
    let s = splitCache.get(o);
    if (!s) { s = splitOrderRevenue(o, gbNos); splitCache.set(o, s); }
    return s;
  };
  const cafe24Rev = (o: any) => splitOf(o).cafe24;
  const gbRev = (o: any) => splitOf(o).groupbuy;
  const isGbItem = (it: any) => gbNos.has(Number(it.product_no));
  const notGbItem = (it: any) => !gbNos.has(Number(it.product_no));

  // 오늘 / 이번 주 필터
  const todayOrders = monthOrders.filter(
    (o) => kstDateStr(o.payment_date ?? o.order_date) === todayStr
  );
  const weekOrders = monthOrders.filter(
    (o) => kstDateStr(o.payment_date ?? o.order_date) >= weekStartStr
  );

  // ── 상품별 판매 순위 (기간별) — 카페24는 공구 상품 제외 ─────────────────
  const topProducts         = buildRanking(monthOrders, 10, notGbItem);
  const topProductsToday    = buildRanking(todayOrders, 10, notGbItem);
  const topProductsWeek     = buildRanking(weekOrders, 10, notGbItem);

  // ── 시간대별 주문 (오늘) — 카페24(공구 제외) ───────────────────────────
  const hourOf = (o: any) => kstHour(o.payment_date ?? o.order_date);
  const hourlyOrders: HourlyData[] = Array.from({ length: 24 }, (_, h) => {
    const filtered = todayOrders.filter((o) => hourOf(o) === h);
    return {
      hour: `${String(h).padStart(2, "0")}시`,
      orders: filtered.filter((o) => cafe24Rev(o) > 0).length,
      revenue: Math.round(filtered.reduce((s, o) => s + cafe24Rev(o), 0)),
    };
  });

  // ── 이번 주 일별 매출 ─────────────────────────────────────────────────
  const DAYS = ["월", "화", "수", "목", "금", "토", "일"];
  const weeklyRevenue: WeeklyData[] = DAYS.map((day, i) => {
    const d = new Date(weekStart);
    d.setUTCDate(weekStart.getUTCDate() + i);
    const ds = kstStr(d);
    const dayOrders = monthOrders.filter(
      (o) => kstDateStr(o.payment_date ?? o.order_date) === ds
    );
    return {
      day,
      revenue: Math.round(dayOrders.reduce((s, o) => s + cafe24Rev(o), 0)),
      orders: dayOrders.filter((o) => cafe24Rev(o) > 0).length,
    };
  });
  const weeklyRevenueGb: WeeklyData[] = DAYS.map((day, i) => {
    const d = new Date(weekStart);
    d.setUTCDate(weekStart.getUTCDate() + i);
    const ds = kstStr(d);
    const dayOrders = monthOrders.filter((o) => kstDateStr(o.payment_date ?? o.order_date) === ds);
    return {
      day,
      revenue: Math.round(dayOrders.reduce((s, o) => s + gbRev(o), 0)),
      orders: dayOrders.filter((o) => gbRev(o) > 0).length,
    };
  });

  // ── 일별 매출 + 합배송 그룹 (최근 60일 = 이번달+지난달) ────────────────
  // 같은 날 동일 (구매자, 수령인, 수령지) 조합은 1건의 배송으로 묶음
  const allOrdersForDaily = [...prevMonthOrders, ...monthOrders];
  const dailyMap = new Map<
    string,
    { revenue: number; orders: number; shipments: Set<string> }
  >();
  const gbDailyMap = new Map<string, { revenue: number; orders: number }>();
  for (const o of allOrdersForDaily) {
    const ds = kstDateStr(o.payment_date ?? o.order_date);
    const { cafe24, groupbuy } = splitOf(o);
    const cur = dailyMap.get(ds) ?? { revenue: 0, orders: 0, shipments: new Set<string>() };
    cur.revenue += cafe24;
    if (cafe24 > 0) cur.orders += 1;
    // 합배송 키: 주문자+수령인+연락처+주소
    const buyer = o.buyer_name ?? "";
    const receiver = o.receiver_name ?? "";
    const phone = o.receiver_cellphone ?? o.receiver_phone ?? "";
    const addr = `${o.receiver_address1 ?? ""}${o.receiver_address2 ?? ""}${o.receiver_zipcode ?? ""}`;
    const shipKey = `${buyer}|${receiver}|${phone}|${addr}`;
    cur.shipments.add(shipKey);
    dailyMap.set(ds, cur);

    if (groupbuy > 0) {
      const g = gbDailyMap.get(ds) ?? { revenue: 0, orders: 0 };
      g.revenue += groupbuy;
      g.orders += 1;
      gbDailyMap.set(ds, g);
    }
  }
  const dailyRevenue: DailyData[] = Array.from(dailyMap.entries())
    .map(([date, v]) => ({
      date,
      revenue: Math.round(v.revenue),
      orders: v.orders,
      shipments: v.shipments.size,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const gbDailyRevenue: DailyData[] = Array.from(gbDailyMap.entries())
    .map(([date, v]) => ({ date, revenue: Math.round(v.revenue), orders: v.orders }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // ── 일별 매입원가 (COGS) — items 단위로 SKU × 단가 합산 ────────────────
  const cogsMap = await getProductCogs();
  const dailyCogsMap = new Map<string, number>();
  const gbCogsMap = new Map<string, number>();
  const unmatchedSet = new Set<string>();
  for (const o of allOrdersForDaily) {
    const ds = kstDateStr(o.payment_date ?? o.order_date);
    let dayCost = dailyCogsMap.get(ds) ?? 0;
    let gbDayCost = gbCogsMap.get(ds) ?? 0;
    for (const item of (o.items ?? []) as Array<{
      product_code?: string;
      product_no?: number | string;
      actual_quantity?: number;
      quantity?: number;
    }>) {
      const sku = item.product_code ?? "";
      const qty = item.actual_quantity ?? item.quantity ?? 1;
      const unitCost = cogsMap[sku];
      const isGb = gbNos.has(Number(item.product_no));
      if (unitCost !== undefined) {
        if (isGb) gbDayCost += unitCost * qty;
        else dayCost += unitCost * qty;
      } else if (sku && !isGb) {
        unmatchedSet.add(sku);
      }
    }
    dailyCogsMap.set(ds, dayCost);
    gbCogsMap.set(ds, gbDayCost);
  }
  const dailyCogs: DailyCost[] = Array.from(dailyCogsMap.entries())
    .map(([date, cost]) => ({ date, cost: Math.round(cost) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const gbDailyCogs: DailyCost[] = Array.from(gbCogsMap.entries())
    .map(([date, cost]) => ({ date, cost: Math.round(cost) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const unmatchedSkus = Array.from(unmatchedSet);

  // ── 카페24 히스토리 보조 데이터 머지 ──────────────────────────────────────
  // 라이브 API 는 이번 달 + 지난 달만 가져오므로, 그 이전 기간(예: 1~3개월 전)
  // 매출은 별도 업로드된 CSV 에서 보충해 dailyRevenue 에 합친다.
  // 라이브 데이터가 있는 날짜는 라이브가 항상 우선 (보조 데이터는 빈 날짜만 채움).
  let mergedDailyRevenue = dailyRevenue;
  try {
    const historical = await loadCafe24Historical(brand);
    if (historical.uploads.length > 0) {
      const liveDates = new Set(dailyRevenue.map((d) => d.date));
      const supplemental = mergeCafe24HistoricalDaily(historical).filter(
        (d) => !liveDates.has(d.date),
      );
      if (supplemental.length > 0) {
        mergedDailyRevenue = [...supplemental, ...dailyRevenue].sort((a, b) =>
          a.date.localeCompare(b.date),
        );
      }
    }
  } catch (e) {
    console.error("[cafe24] historical merge 실패:", (e as Error).message);
  }

  // ── 재고 현황 ──────────────────────────────────────────────────────────
  // 카페24 products 목록은 stock_quantity 를 안 준다 → variant 의 quantity + use_inventory 로 계산.
  // 다수 상품이 use_inventory=F(재고관리 미사용) → 수량은 무의미(-1 등), sold_out 으로만 판매여부 판단.
  const THRESHOLD = 10;
  const inventory: InventoryItem[] = allProducts.map((p: any) => {
    const variants: any[] = Array.isArray(p.variants) ? p.variants : [];
    const managed = variants.filter((v) => v.use_inventory === "T");
    const tracked = managed.length > 0;
    const soldOut = p.sold_out === "T";
    let stock = 0;
    let status: InventoryItem["status"];
    if (tracked) {
      stock = managed.reduce((s, v) => s + Math.max(0, Number(v.quantity) || 0), 0);
      if (soldOut || stock === 0) status = "soldout";
      else if (stock <= 3) status = "critical";
      else if (stock <= THRESHOLD) status = "warning";
      else status = "ok";
    } else {
      // 재고관리 미사용 — 수량 추적 안 함. 품절 여부만 유효.
      status = soldOut ? "soldout" : "ok";
    }
    return {
      name: p.product_name,
      sku: p.product_code ?? "",
      stock,
      threshold: THRESHOLD,
      status,
      tracked,
    };
  });

  // ── 공동구매 라이브 채널 데이터 (226 등 공구 상품) ─────────────────────
  const hourlyOrdersGb: HourlyData[] = Array.from({ length: 24 }, (_, h) => {
    const filtered = todayOrders.filter((o) => hourOf(o) === h);
    return {
      hour: `${String(h).padStart(2, "0")}시`,
      orders: filtered.filter((o) => gbRev(o) > 0).length,
      revenue: Math.round(filtered.reduce((s, o) => s + gbRev(o), 0)),
    };
  });
  const groupBuyLive: MultiChannelData = {
    salesSummary: {
      today:     summarizeBy(todayOrders, gbRev),
      week:      summarizeBy(weekOrders, gbRev),
      month:     summarizeBy(monthOrders, gbRev),
      prevMonth: summarizeBy(prevMonthOrders, gbRev),
    },
    topProducts:  buildRanking(monthOrders, 10, isGbItem),
    hourlyOrders: hourlyOrdersGb,
    weeklyRevenue: weeklyRevenueGb,
    dailyRevenue: gbDailyRevenue,
    dailyCogs:    gbDailyCogs,
    inventory:    [],
  };

  return {
    salesSummary: {
      today:     summarizeBy(todayOrders, cafe24Rev),
      week:      summarizeBy(weekOrders, cafe24Rev),
      month:     summarizeBy(monthOrders, cafe24Rev),
      prevMonth: summarizeBy(prevMonthOrders, cafe24Rev),
    },
    topProducts,
    topProductsToday,
    topProductsWeek,
    hourlyOrders,
    weeklyRevenue,
    dailyRevenue: mergedDailyRevenue,
    dailyCogs,
    unmatchedSkus,
    inventory,
    groupBuyLive,
    isReal: true,
  };
}
