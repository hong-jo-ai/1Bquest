import { cookies } from "next/headers";
import { metaGet, META_BASE } from "@/lib/metaClient";
import { fetchAllOrders } from "@/lib/cafe24Data";
import { fetchGa4Data, refreshGoogleToken, type Ga4Data } from "@/lib/ga4Client";
import { getValidC24Token } from "@/lib/cafe24Auth";
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

export interface DailyMetricRow {
  date: string;
  // GA4
  gaUsers: number;
  gaNewUsers: number;
  gaSessions: number;
  gaPageviews: number;
  gaBounceRate: number;
  gaAvgSessionSec: number;
  // Meta
  impressions: number;
  reach: number;
  clicks: number;
  landingViews: number;
  spend: number;
  purchases: number;
  // Cafe24
  orders: number;
  revenue: number;
}

export interface AnalyticsData {
  period: { start: string; end: string };
  hasMeta:   boolean;
  hasCafe24: boolean;
  hasGa4:    boolean;
  ga4PropertyId: string;
  ga4Error: string | null;
  daily: DailyMetricRow[];
  totals: {
    // GA4
    gaUsers: number;
    gaNewUsers: number;
    gaSessions: number;
    gaPageviews: number;
    gaAvgBounceRate: number;
    gaAvgSessionMin: number;
    // Meta
    impressions: number;
    reach: number;
    clicks: number;
    landingViews: number;
    spend: number;
    purchases: number;
    // Cafe24
    orders: number;
    revenue: number;
    // 복합 지표
    ctr: number;
    metaCvr: number;
    gaCvr: number;
    cpo: number;
    roas: number;
  };
  ga4: Ga4Data | null;
  metaAccountId: string;
  topMetaActions: { type: string; value: number }[];
}

// ── Meta 일별 인사이트 ────────────────────────────────────────────────────

async function fetchMetaDailyInsights(
  token: string, accountId: string, since: string, until: string
) {
  const qs = new URLSearchParams({
    access_token:   token,
    fields:         "date_start,impressions,reach,clicks,spend,actions,action_values",
    time_range:     JSON.stringify({ since, until }),
    time_increment: "1",
    level:          "account",
    limit:          "31",   // 기본 25개 → 30일치 모두 가져오도록
  });
  const res = await fetch(`${META_BASE}/${accountId}/insights?${qs}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Meta daily insights: ${await res.text()}`);
  const json = await res.json();

  return (json.data ?? []).map((d: any) => {
    const actionVal = (type: string) => {
      const found = (d.actions ?? []).find((a: any) => a.action_type === type);
      return found ? parseFloat(found.value ?? "0") : 0;
    };
    return {
      date:         d.date_start as string,
      impressions:  parseInt(d.impressions ?? "0", 10),
      reach:        parseInt(d.reach        ?? "0", 10),
      clicks:       parseInt(d.clicks       ?? "0", 10),
      landingViews: actionVal("landing_page_view"),
      spend:        parseFloat(d.spend ?? "0"),
      purchases:    actionVal("purchase"),
    };
  });
}

async function getMetaAccountId(token: string): Promise<string> {
  const envId = process.env.META_AD_ACCOUNT_ID;
  if (envId) return envId;
  const data = await metaGet("/me/adaccounts", token, {
    fields: "id,account_status", limit: "10",
  });
  const accounts: any[] = data.data ?? [];
  if (!accounts.length) throw new Error("연결된 Meta 광고 계정 없음");
  return ((accounts.find(a => a.account_status === 1) ?? accounts[0]).id) as string;
}

// ── 메인 핸들러 ───────────────────────────────────────────────────────────

export async function GET(_req: NextRequest) {
  const cookieStore = await cookies();
  const c24Token  = await getValidC24Token();
  const metaToken = cookieStore.get("meta_at")?.value ?? null;
  let   gaToken   = cookieStore.get("ga_at")?.value   ?? null;
  const gaRt      = cookieStore.get("ga_rt")?.value   ?? null;
  const ga4PropId = cookieStore.get("ga4_prop")?.value ?? process.env.GA4_PROPERTY_ID ?? "";

  // GA4 토큰 갱신 시도
  if (!gaToken && gaRt) {
    try {
      gaToken = await refreshGoogleToken(gaRt);
      cookieStore.set("ga_at", gaToken, { httpOnly: true, secure: true, maxAge: 3600, path: "/" });
    } catch { gaToken = null; }
  }

  const now      = kstNow();
  const endDate  = kstStr(now);
  const startD   = new Date(now);
  startD.setUTCDate(now.getUTCDate() - 29);
  const startDate = kstStr(startD);

  // ── 30일 날짜 맵 초기화 ─────────────────────────────────────────────────
  const dateMap: Record<string, DailyMetricRow> = {};
  for (let i = 0; i < 30; i++) {
    const d = new Date(startD);
    d.setUTCDate(startD.getUTCDate() + i);
    const ds = kstStr(d);
    dateMap[ds] = {
      date: ds,
      gaUsers: 0, gaNewUsers: 0, gaSessions: 0, gaPageviews: 0,
      gaBounceRate: 0, gaAvgSessionSec: 0,
      impressions: 0, reach: 0, clicks: 0, landingViews: 0,
      spend: 0, purchases: 0,
      orders: 0, revenue: 0,
    };
  }

  let hasMeta   = false;
  let hasCafe24 = false;
  let hasGa4    = false;
  let metaAccountId = "";
  let topMetaActions: { type: string; value: number }[] = [];
  let ga4Data: Ga4Data | null = null;
  let ga4Error: string | null = null;

  // ── [1] GA4 ─────────────────────────────────────────────────────────────
  if (gaToken && ga4PropId) {
    try {
      ga4Data = await fetchGa4Data(ga4PropId, gaToken);
      ga4Data.daily.forEach((row) => {
        if (dateMap[row.date]) {
          dateMap[row.date].gaUsers        = row.users;
          dateMap[row.date].gaNewUsers     = row.newUsers;
          dateMap[row.date].gaSessions     = row.sessions;
          dateMap[row.date].gaPageviews    = row.pageviews;
          dateMap[row.date].gaBounceRate   = row.bounceRate;
          dateMap[row.date].gaAvgSessionSec = row.avgSessionSec;
        }
      });
      hasGa4 = ga4Data.daily.length > 0;
    } catch (e: any) {
      console.error("[analytics] GA4 error:", e);
      ga4Error = e.message ?? "GA4 데이터 조회 실패";
    }
  } else if (!gaToken && gaRt) {
    ga4Error = "Google 토큰 갱신 실패 — 재로그인 필요";
  } else if (!gaToken) {
    ga4Error = "Google 계정 연결 필요";
  } else if (!ga4PropId) {
    ga4Error = "GA4 Property ID 미설정";
  }

  // ── [2] Meta ─────────────────────────────────────────────────────────────
  if (metaToken) {
    try {
      metaAccountId = await getMetaAccountId(metaToken);
      const metaRows = await fetchMetaDailyInsights(metaToken, metaAccountId, startDate, endDate);
      metaRows.forEach((row: any) => {
        if (dateMap[row.date]) {
          Object.assign(dateMap[row.date], {
            impressions:  row.impressions,
            reach:        row.reach,
            clicks:       row.clicks,
            landingViews: row.landingViews,
            spend:        row.spend,
            purchases:    row.purchases,
          });
        }
      });
      hasMeta = metaRows.length > 0;

      // 전체 기간 액션 집계
      try {
        const qs2 = new URLSearchParams({
          access_token: metaToken,
          fields:       "actions",
          time_range:   JSON.stringify({ since: startDate, until: endDate }),
          level:        "account",
        });
        const aggRes = await fetch(`${META_BASE}/${metaAccountId}/insights?${qs2}`, { cache: "no-store" });
        if (aggRes.ok) {
          const agg = await aggRes.json();
          const d = agg.data?.[0];
          if (d?.actions) {
            topMetaActions = (d.actions as any[])
              .map((a: any) => ({ type: a.action_type as string, value: parseFloat(a.value ?? "0") }))
              .sort((a, b) => b.value - a.value)
              .slice(0, 8);
          }
        }
      } catch { /* 무시 */ }
    } catch (e) {
      console.error("[analytics] Meta error:", e);
    }
  }

  // ── [3] Cafe24 주문 ──────────────────────────────────────────────────────
  if (c24Token) {
    try {
      // analytics에선 items 불필요 → embedItems=false 로 훨씬 빠름
      const orders = await fetchAllOrders(c24Token, startDate, endDate, false);
      orders.forEach((o) => {
        const ds = kstDateStr(o.payment_date ?? o.order_date);
        if (dateMap[ds]) {
          dateMap[ds].orders  += 1;
          dateMap[ds].revenue += parseFloat(
            o.total_amount ?? o.payment_amount ?? o.actual_order_amount ?? "0"
          );
        }
      });
      hasCafe24 = true;
    } catch (e) {
      console.error("[analytics] Cafe24 error:", e);
    }
  }

  const daily = Object.values(dateMap).sort((a, b) => a.date.localeCompare(b.date));

  // ── 합계 ─────────────────────────────────────────────────────────────────
  const T = {
    gaUsers:      ga4Data?.totals.users       ?? 0,
    gaNewUsers:   ga4Data?.totals.newUsers     ?? 0,
    gaSessions:   ga4Data?.totals.sessions     ?? 0,
    gaPageviews:  ga4Data?.totals.pageviews    ?? 0,
    gaAvgBounceRate: ga4Data?.totals.avgBounceRate ?? 0,
    gaAvgSessionMin: ga4Data?.totals.avgSessionMin ?? 0,
    impressions:  daily.reduce((s, d) => s + d.impressions, 0),
    reach:        daily.reduce((s, d) => s + d.reach, 0),
    clicks:       daily.reduce((s, d) => s + d.clicks, 0),
    landingViews: daily.reduce((s, d) => s + d.landingViews, 0),
    spend:        Math.round(daily.reduce((s, d) => s + d.spend, 0)),
    purchases:    daily.reduce((s, d) => s + d.purchases, 0),
    orders:       daily.reduce((s, d) => s + d.orders, 0),
    revenue:      Math.round(daily.reduce((s, d) => s + d.revenue, 0)),
  };

  const visitors = T.gaUsers || T.reach || 1;
  const ctr        = T.impressions  > 0 ? (T.clicks / T.impressions)     * 100 : 0;
  const metaCvr    = T.clicks       > 0 ? (T.orders / T.clicks)          * 100 : 0;
  const gaCvr      = T.gaSessions   > 0 ? (T.orders / T.gaSessions)      * 100 : 0;
  const cpo        = T.orders       > 0 ? T.spend / T.orders                   : 0;
  const roas       = T.spend        > 0 ? T.revenue / T.spend                  : 0;

  return Response.json({
    period: { start: startDate, end: endDate },
    hasMeta, hasCafe24, hasGa4,
    ga4PropertyId: ga4PropId,
    ga4Error,
    daily,
    totals: { ...T, ctr, metaCvr, gaCvr, cpo, roas },
    ga4: ga4Data,
    metaAccountId,
    topMetaActions,
  } satisfies AnalyticsData);
}
