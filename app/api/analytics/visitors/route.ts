import { cookies } from "next/headers";
import { cafe24Get } from "@/lib/cafe24Client";
import { fetchAllOrders } from "@/lib/cafe24Data";
import { type NextRequest } from "next/server";

function kstNow() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}
function kstStr(d: Date) {
  return d.toISOString().slice(0, 10);
}
function kstDateStr(iso: string) {
  return new Date(new Date(iso).getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

export interface DailyVisitorData {
  date: string;
  visitors: number;
  pageviews: number;
  orders: number;
  revenue: number;
  bounceRate?: number;
}

export interface TrafficSource {
  name: string;
  visits: number;
  pct: number;
}

export interface AnalyticsOverview {
  totalVisitors: number;
  totalPageviews: number;
  totalOrders: number;
  totalRevenue: number;
  avgBounceRate: number;
  avgConversionRate: number;
  newVisitors: number;
  returnVisitors: number;
  hasRealAnalytics: boolean;
  needsScope: boolean;
}

export interface AnalyticsData {
  overview: AnalyticsOverview;
  daily: DailyVisitorData[];
  trafficSources: TrafficSource[];
  topKeywords: { keyword: string; visits: number }[];
  deviceBreakdown: { device: string; pct: number }[];
  period: { start: string; end: string };
}

// ── Cafe24 Analytics API helpers ──────────────────────────────────────────

async function fetchAnalyticsStatistic(token: string, startDate: string, endDate: string) {
  try {
    const qs = new URLSearchParams({ start_date: startDate, end_date: endDate });
    const data = await cafe24Get(`/api/v2/admin/analytics/statistic?${qs}`, token);
    return { data: data.statistic ?? data.statistics ?? [], error: null };
  } catch (e: any) {
    const msg = e.message ?? "";
    const needsScope = msg.includes("401") || msg.includes("403") || msg.includes("scope") || msg.includes("permission");
    return { data: [], error: msg, needsScope };
  }
}

async function fetchInflowStatistic(token: string, startDate: string, endDate: string) {
  try {
    const qs = new URLSearchParams({ start_date: startDate, end_date: endDate });
    const data = await cafe24Get(`/api/v2/admin/analytics/inflowstatistic?${qs}`, token);
    return data.inflowstatistic ?? data.inflow_statistic ?? [];
  } catch {
    return [];
  }
}

async function fetchSearchKeywords(token: string, startDate: string, endDate: string) {
  try {
    const qs = new URLSearchParams({ start_date: startDate, end_date: endDate, limit: "10" });
    const data = await cafe24Get(`/api/v2/admin/analytics/searchkeyword?${qs}`, token);
    return data.searchkeyword ?? data.search_keyword ?? [];
  } catch {
    return [];
  }
}

// ── Main handler ──────────────────────────────────────────────────────────

export async function GET(_req: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get("c24_at")?.value;

  if (!token) {
    return Response.json({ error: "카페24 인증이 필요합니다." }, { status: 401 });
  }

  const now = kstNow();
  const endDate = kstStr(now);

  // 최근 30일
  const startD = new Date(now);
  startD.setUTCDate(now.getUTCDate() - 29);
  const startDate = kstStr(startD);

  // ── 주문 데이터 (항상 가능) ─────────────────────────────────────────────
  let allOrders: any[] = [];
  let orderError: string | null = null;
  try {
    allOrders = await fetchAllOrders(token, startDate, endDate);
  } catch (e: any) {
    orderError = e.message;
  }

  // 날짜별 주문 집계
  const ordersByDate: Record<string, { orders: number; revenue: number }> = {};
  allOrders.forEach((o) => {
    const d = kstDateStr(o.payment_date ?? o.order_date);
    if (!ordersByDate[d]) ordersByDate[d] = { orders: 0, revenue: 0 };
    ordersByDate[d].orders += 1;
    ordersByDate[d].revenue += parseFloat(o.total_amount ?? "0");
  });

  // ── Cafe24 Analytics API (mall.read_analytics 스코프 필요) ────────────
  const { data: analyticsRows, error: analyticsError, needsScope } =
    await fetchAnalyticsStatistic(token, startDate, endDate);

  const inflowRows = await fetchInflowStatistic(token, startDate, endDate);
  const keywordRows = await fetchSearchKeywords(token, startDate, endDate);

  const hasRealAnalytics = analyticsRows.length > 0;

  // ── 30일 배열 생성 ──────────────────────────────────────────────────────
  const dailyArr: DailyVisitorData[] = [];
  for (let i = 0; i < 30; i++) {
    const d = new Date(startD);
    d.setUTCDate(startD.getUTCDate() + i);
    const ds = kstStr(d);

    const analyticsRow = analyticsRows.find((r: any) => (r.date ?? r.period) === ds);
    const orderRow = ordersByDate[ds] ?? { orders: 0, revenue: 0 };

    if (analyticsRow) {
      dailyArr.push({
        date: ds,
        visitors: Number(analyticsRow.visitors ?? analyticsRow.visitor ?? 0),
        pageviews: Number(analyticsRow.pageviews ?? analyticsRow.pageview ?? 0),
        orders: orderRow.orders,
        revenue: Math.round(orderRow.revenue),
        bounceRate: Number(analyticsRow.bounce_rate ?? 0),
      });
    } else {
      // Analytics 데이터 없으면 주문 기반 추정
      dailyArr.push({
        date: ds,
        visitors: 0,
        pageviews: 0,
        orders: orderRow.orders,
        revenue: Math.round(orderRow.revenue),
      });
    }
  }

  // ── Overview 집계 ───────────────────────────────────────────────────────
  const totalVisitors = dailyArr.reduce((s, d) => s + d.visitors, 0);
  const totalPageviews = dailyArr.reduce((s, d) => s + d.pageviews, 0);
  const totalOrders = allOrders.length;
  const totalRevenue = Math.round(
    allOrders.reduce((s, o) => s + parseFloat(o.total_amount ?? "0"), 0)
  );

  const bounceRateDays = dailyArr.filter((d) => d.bounceRate && d.bounceRate > 0);
  const avgBounceRate =
    bounceRateDays.length > 0
      ? bounceRateDays.reduce((s, d) => s + (d.bounceRate ?? 0), 0) / bounceRateDays.length
      : 0;

  const avgConversionRate =
    totalVisitors > 0 ? (totalOrders / totalVisitors) * 100 : 0;

  // ── 유입 경로 ────────────────────────────────────────────────────────────
  let trafficSources: TrafficSource[] = [];
  if (inflowRows.length > 0) {
    const total = inflowRows.reduce((s: number, r: any) => s + Number(r.visits ?? r.visitors ?? 0), 0);
    trafficSources = inflowRows.slice(0, 6).map((r: any) => {
      const visits = Number(r.visits ?? r.visitors ?? 0);
      return {
        name: r.inflow_path ?? r.name ?? r.path ?? "기타",
        visits,
        pct: total > 0 ? Math.round((visits / total) * 100) : 0,
      };
    });
  } else {
    // 기본 유입 경로 (실데이터 없을 경우 빈 표시)
    trafficSources = [
      { name: "직접 유입", visits: 0, pct: 0 },
      { name: "검색 유입", visits: 0, pct: 0 },
      { name: "SNS 유입", visits: 0, pct: 0 },
      { name: "광고 유입", visits: 0, pct: 0 },
    ];
  }

  // ── 키워드 ───────────────────────────────────────────────────────────────
  const topKeywords = keywordRows.slice(0, 10).map((r: any) => ({
    keyword: r.keyword ?? r.search_word ?? "",
    visits: Number(r.visits ?? r.visitors ?? 0),
  }));

  // ── 기기 분석 ────────────────────────────────────────────────────────────
  // Cafe24 별도 엔드포인트가 없으면 빈값
  const deviceBreakdown: { device: string; pct: number }[] = [];

  const result: AnalyticsData & { needsScope?: boolean; analyticsError?: string; orderError?: string } = {
    overview: {
      totalVisitors,
      totalPageviews,
      totalOrders,
      totalRevenue,
      avgBounceRate: Math.round(avgBounceRate * 10) / 10,
      avgConversionRate: Math.round(avgConversionRate * 100) / 100,
      newVisitors: 0,
      returnVisitors: 0,
      hasRealAnalytics,
      needsScope: !!needsScope,
    },
    daily: dailyArr,
    trafficSources,
    topKeywords,
    deviceBreakdown,
    period: { start: startDate, end: endDate },
    needsScope: !!needsScope,
    analyticsError: analyticsError ?? undefined,
    orderError: orderError ?? undefined,
  };

  return Response.json(result);
}
