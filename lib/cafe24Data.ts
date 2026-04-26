import { cafe24Get } from "./cafe24Client";
import { getProductCogs } from "./profitSettings";

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

function summarize(orders: any[]): PeriodSummary {
  const revenue = orders.reduce(
    (s, o) => s + parseFloat(o.total_amount ?? o.payment_amount ?? "0"),
    0
  );
  const count = orders.length;
  return {
    revenue: Math.round(revenue),
    orders: count,
    avgOrder: count > 0 ? Math.round(revenue / count) : 0,
  };
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

export async function getDashboardData(token: string): Promise<DashboardData> {
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
  const [monthOrders, prevMonthOrders, productsData] = await Promise.all([
    fetchAllOrders(token, monthStartStr, todayStr),
    fetchAllOrders(token, prevMonthStartStr, prevMonthEndStr),
    cafe24Get("/api/v2/admin/products?limit=100&display=T", token),
  ]);

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
      revenue: Math.round(
        filtered.reduce((s, o) => s + parseFloat(o.total_amount ?? o.payment_amount ?? o.actual_order_amount ?? "0"), 0)
      ),
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
      revenue: Math.round(
        dayOrders.reduce((s, o) => s + parseFloat(o.total_amount ?? o.payment_amount ?? o.actual_order_amount ?? "0"), 0)
      ),
      orders: dayOrders.length,
    };
  });

  // ── 일별 매출 (최근 60일 = 이번달+지난달) ────────────────────────────
  const allOrdersForDaily = [...prevMonthOrders, ...monthOrders];
  const dailyMap = new Map<string, { revenue: number; orders: number }>();
  for (const o of allOrdersForDaily) {
    const ds = kstDateStr(o.payment_date ?? o.order_date);
    const cur = dailyMap.get(ds) ?? { revenue: 0, orders: 0 };
    cur.revenue += parseFloat(o.total_amount ?? o.payment_amount ?? o.actual_order_amount ?? "0");
    cur.orders += 1;
    dailyMap.set(ds, cur);
  }
  const dailyRevenue: DailyData[] = Array.from(dailyMap.entries())
    .map(([date, v]) => ({ date, revenue: Math.round(v.revenue), orders: v.orders }))
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
    dailyRevenue,
    dailyCogs,
    unmatchedSkus,
    inventory,
    isReal: true,
  };
}
