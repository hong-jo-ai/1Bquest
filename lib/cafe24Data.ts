import { cafe24Get } from "./cafe24Client";
import { getProductCogs } from "./profitSettings";
import { loadCafe24Historical, mergeCafe24HistoricalDaily } from "./cafe24Historical";
import type { Brand } from "./multiChannelData";

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

function summarize(orders: any[]): PeriodSummary {
  const revenue = orders.reduce((s, o) => s + orderRevenue(o), 0);
  const count = orders.length;
  return {
    revenue: Math.round(revenue),
    orders: count,
    avgOrder: count > 0 ? Math.round(revenue / count) : 0,
  };
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
 * (입금 후 취소된 N40/N41 케이스는 환불이 별도로 회계 처리되는 구조라 여기선 제외하지 않는다.)
 */
export function isPaidOrder(o: {
  payment_date?: string | null;
  actual_payment_amount?: string | number;
}): boolean {
  if (typeof o.payment_date === "string" && o.payment_date.trim() !== "") return true;
  const paid = parseFloat(String(o.actual_payment_amount ?? "0"));
  return Number.isFinite(paid) && paid > 0;
}

// ── 상품별 판매 순위 빌더 ─────────────────────────────────────────────────

export function buildRanking(orders: any[], limit = 10): ProductRank[] {
  const pMap: Record<string, { name: string; sku: string; sold: number; revenue: number }> = {};
  orders.forEach((order) => {
    (order.items ?? []).forEach((item: any) => {
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

  // 이번 달 + 지난 달 주문 + 상품 목록 병렬 조회
  const [rawMonthOrders, rawPrevMonthOrders, productsData] = await Promise.all([
    fetchAllOrders(token, monthStartStr, todayStr),
    fetchAllOrders(token, prevMonthStartStr, prevMonthEndStr),
    cafe24Get("/api/v2/admin/products?limit=100&display=T", token),
  ]);

  // 입금전(N00) 주문은 매출에서 제외 — 무통장 입금 미완료로 자동 취소되는 케이스가 잦음.
  // 입금 확인 후 배송준비중(N10) 이상으로 넘어간 주문만 진짜 매출로 본다.
  const monthOrders     = rawMonthOrders.filter(isPaidOrder);
  const prevMonthOrders = rawPrevMonthOrders.filter(isPaidOrder);

  // 오늘 / 이번 주 필터
  const todayOrders = monthOrders.filter(
    (o) => kstDateStr(o.payment_date ?? o.order_date) === todayStr
  );
  const weekOrders = monthOrders.filter(
    (o) => kstDateStr(o.payment_date ?? o.order_date) >= weekStartStr
  );

  // ── 상품별 판매 순위 (기간별) ──────────────────────────────────────────
  const topProducts         = buildRanking(monthOrders);
  const topProductsToday    = buildRanking(todayOrders);
  const topProductsWeek     = buildRanking(weekOrders);

  // ── 시간대별 주문 (오늘) ───────────────────────────────────────────────
  const hourlyOrders: HourlyData[] = Array.from({ length: 24 }, (_, h) => {
    const filtered = todayOrders.filter(
      (o) => kstHour(o.payment_date ?? o.order_date) === h
    );
    return {
      hour: `${String(h).padStart(2, "0")}시`,
      orders: filtered.length,
      revenue: Math.round(filtered.reduce((s, o) => s + orderRevenue(o), 0)),
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
      revenue: Math.round(dayOrders.reduce((s, o) => s + orderRevenue(o), 0)),
      orders: dayOrders.length,
    };
  });

  // ── 일별 매출 + 합배송 그룹 (최근 60일 = 이번달+지난달) ────────────────
  // 같은 날 동일 (구매자, 수령인, 수령지) 조합은 1건의 배송으로 묶음
  const allOrdersForDaily = [...prevMonthOrders, ...monthOrders];
  const dailyMap = new Map<
    string,
    { revenue: number; orders: number; shipments: Set<string> }
  >();
  for (const o of allOrdersForDaily) {
    const ds = kstDateStr(o.payment_date ?? o.order_date);
    const cur = dailyMap.get(ds) ?? { revenue: 0, orders: 0, shipments: new Set<string>() };
    cur.revenue += orderRevenue(o);
    cur.orders += 1;
    // 합배송 키: 주문자+수령인+연락처+주소
    const buyer = o.buyer_name ?? "";
    const receiver = o.receiver_name ?? "";
    const phone = o.receiver_cellphone ?? o.receiver_phone ?? "";
    const addr = `${o.receiver_address1 ?? ""}${o.receiver_address2 ?? ""}${o.receiver_zipcode ?? ""}`;
    const shipKey = `${buyer}|${receiver}|${phone}|${addr}`;
    cur.shipments.add(shipKey);
    dailyMap.set(ds, cur);
  }
  const dailyRevenue: DailyData[] = Array.from(dailyMap.entries())
    .map(([date, v]) => ({
      date,
      revenue: Math.round(v.revenue),
      orders: v.orders,
      shipments: v.shipments.size,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // ── 일별 매입원가 (COGS) — items 단위로 SKU × 단가 합산 ────────────────
  const cogsMap = await getProductCogs();
  const dailyCogsMap = new Map<string, number>();
  const unmatchedSet = new Set<string>();
  for (const o of allOrdersForDaily) {
    const ds = kstDateStr(o.payment_date ?? o.order_date);
    let dayCost = dailyCogsMap.get(ds) ?? 0;
    for (const item of (o.items ?? []) as Array<{
      product_code?: string;
      actual_quantity?: number;
      quantity?: number;
    }>) {
      const sku = item.product_code ?? "";
      const qty = item.actual_quantity ?? item.quantity ?? 1;
      const unitCost = cogsMap[sku];
      if (unitCost !== undefined) {
        dayCost += unitCost * qty;
      } else if (sku) {
        unmatchedSet.add(sku);
      }
    }
    dailyCogsMap.set(ds, dayCost);
  }
  const dailyCogs: DailyCost[] = Array.from(dailyCogsMap.entries())
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
  const THRESHOLD = 10;
  const inventory: InventoryItem[] = (productsData.products ?? []).map((p: any) => {
    const stock = p.stock_quantity ?? 0;
    let status: InventoryItem["status"] = "ok";
    if (stock === 0) status = "soldout";
    else if (stock <= 3) status = "critical";
    else if (stock <= THRESHOLD) status = "warning";
    return {
      name: p.product_name,
      sku: p.product_code ?? "",
      stock,
      threshold: THRESHOLD,
      status,
    };
  });

  return {
    salesSummary: {
      today:     summarize(todayOrders),
      week:      summarize(weekOrders),
      month:     summarize(monthOrders),
      prevMonth: summarize(prevMonthOrders),
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
    isReal: true,
  };
}
