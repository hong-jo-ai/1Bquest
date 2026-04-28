/**
 * 최근 90일 광고(ad)별 성과 분석 → 베스트 소재 top N 픽.
 *
 * 평가 기준:
 *   - 통계적 표본 충분: 90일 지출 ≥ MIN_SPEND OR 전환 ≥ MIN_CONV
 *   - 큰 주문 보정 ROAS (90d 매출 중 1건이 40%+면 그 1건 빼고 계산 — 추정)
 *   - decay 제외: 30일 ROAS가 90일 평균의 70% 이상
 *   - 정렬: adjusted_roas_90d desc
 */
import { metaGet } from "../metaClient";
import { listActiveAccounts } from "./metaAdsetClient";

const PURCHASE_ACTIONS = new Set([
  "purchase",
  "omni_purchase",
  "offsite_conversion.fb_pixel_purchase",
]);

const POLICY = {
  WINDOW_DAYS:        90,
  RECENT_DAYS:        30,
  MIN_SPEND_KRW:      300_000,    // 90일 누적 지출 (표본 충분)
  MIN_CONVERSIONS:    25,         // 또는 전환 25건
  DECAY_THRESHOLD:    0.70,       // 최근 30d ROAS / 90d ROAS ≥ 0.70
  TOP_N:              5,
  LARGE_ORDER_SHARE:  0.40,
} as const;

function sumPurchase(rows: { action_type: string; value: string }[] | undefined): number {
  if (!rows) return 0;
  let total = 0;
  for (const r of rows) {
    if (PURCHASE_ACTIONS.has(r.action_type)) {
      total = Math.max(total, parseFloat(r.value ?? "0"));
    }
  }
  return total;
}

interface AdInsightWindow {
  spend:         number;
  revenue:       number;
  conversions:   number;
  impressions:   number;
  clicks:        number;
  ctr:           number;
}

interface MetaAdRow {
  ad_id:        string;
  ad_name?:     string;
  adset_id?:    string;
  adset_name?:  string;
  campaign_id?: string;
  campaign_name?: string;
  spend?:       string;
  impressions?: string;
  clicks?:      string;
  ctr?:         string;
  actions?:     { action_type: string; value: string }[];
  action_values?: { action_type: string; value: string }[];
}

async function fetchAdInsights(
  token: string,
  accountId: string,
  days: number,
): Promise<MetaAdRow[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const until = new Date().toISOString().slice(0, 10);

  // ad-level insights — 한 번에 가져옴 (limit 500)
  const out: MetaAdRow[] = [];
  let url = `${accountId}/insights`;
  let qs: Record<string, string> = {
    fields: "ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,spend,impressions,clicks,ctr,actions,action_values",
    time_range: JSON.stringify({ since, until }),
    level: "ad",
    limit: "500",
  };

  // 페이징 (Meta Graph API paging)
  let pages = 0;
  while (pages < 10) {
    const res = await metaGet(`/${url}`, token, qs) as { data?: MetaAdRow[]; paging?: { next?: string } };
    if (res.data) out.push(...res.data);
    if (!res.paging?.next) break;

    // next URL parsing — graph.facebook.com/v22.0/...?access_token=...&...
    try {
      const nextUrl = new URL(res.paging.next);
      const params = Object.fromEntries(nextUrl.searchParams.entries());
      delete params.access_token; // metaGet이 다시 붙임
      url = nextUrl.pathname.replace(/^\/v\d+\.\d+\//, "");
      qs = params;
    } catch {
      break;
    }
    pages++;
  }

  return out;
}

function aggregate(rows: MetaAdRow[]): Map<string, { meta: { ad_name: string; adset_id: string; adset_name: string; campaign_id: string; campaign_name: string }; insight: AdInsightWindow; rowCount: number; rawRevenues: number[] }> {
  const map = new Map<string, { meta: { ad_name: string; adset_id: string; adset_name: string; campaign_id: string; campaign_name: string }; insight: AdInsightWindow; rowCount: number; rawRevenues: number[] }>();
  for (const r of rows) {
    const id = r.ad_id;
    if (!id) continue;
    const spend = parseFloat(r.spend ?? "0");
    const impressions = parseInt(r.impressions ?? "0", 10);
    const clicks = parseInt(r.clicks ?? "0", 10);
    const ctr = parseFloat(r.ctr ?? "0");
    const revenue = sumPurchase(r.action_values);
    const conversions = Math.round(sumPurchase(r.actions));

    const cur = map.get(id);
    if (cur) {
      cur.insight.spend += spend;
      cur.insight.revenue += revenue;
      cur.insight.conversions += conversions;
      cur.insight.impressions += impressions;
      cur.insight.clicks += clicks;
      cur.rowCount += 1;
      if (revenue > 0) cur.rawRevenues.push(revenue);
    } else {
      map.set(id, {
        meta: {
          ad_name:        r.ad_name ?? id,
          adset_id:       r.adset_id ?? "",
          adset_name:     r.adset_name ?? "",
          campaign_id:    r.campaign_id ?? "",
          campaign_name:  r.campaign_name ?? "",
        },
        insight: { spend, revenue, conversions, impressions, clicks, ctr },
        rowCount: 1,
        rawRevenues: revenue > 0 ? [revenue] : [],
      });
    }
  }
  return map;
}

export type RejectionReason = "no_revenue" | "low_sample" | "decayed" | null;

export interface BestCreative {
  adId:           string;
  adName:         string;
  adsetId:        string;
  adsetName:      string;
  campaignId:     string;
  campaignName:   string;
  accountId:      string;
  accountName:    string;
  spend90d:       number;
  revenue90d:     number;
  adjustedRevenue90d: number;
  conversions90d: number;
  roas90d:        number;
  adjustedRoas90d: number;
  spend30d:       number;
  revenue30d:     number;
  conversions30d: number;
  roas30d:        number;
  largestRevenueShare: number;  // 90일 매출 중 단일 최대값 비율
  thumbnailUrl:   string | null;
  status:         string;       // 광고 자체 status (ACTIVE/PAUSED)
  rejectionReason: RejectionReason; // null = 후보 통과, 외 = 떨어진 사유
  spendShortfall: number;       // MIN_SPEND_KRW - spend90d (양수면 부족분)
  conversionsShortfall: number; // MIN_CONVERSIONS - conversions90d (양수면 부족분)
  decayRatio:     number | null; // roas30d / roas90d (30d 데이터 없으면 null)
}

export interface RejectionStats {
  totalAds:      number;
  passed:        number;
  noRevenue:     number;
  lowSample:     number;
  decayed:       number;
}

export async function findBestCreatives(token: string): Promise<{
  candidates: BestCreative[];
  top: BestCreative[];
  analyzed: BestCreative[];
  nearMisses: BestCreative[];
  stats: RejectionStats;
  errors: Array<{ scope: string; id?: string; error: string }>;
}> {
  const errors: Array<{ scope: string; id?: string; error: string }> = [];
  const accounts = await listActiveAccounts(token);
  const all: BestCreative[] = [];

  for (const acc of accounts) {
    let rows90d: MetaAdRow[] = [];
    let rows30d: MetaAdRow[] = [];
    try {
      [rows90d, rows30d] = await Promise.all([
        fetchAdInsights(token, acc.id, POLICY.WINDOW_DAYS),
        fetchAdInsights(token, acc.id, POLICY.RECENT_DAYS),
      ]);
    } catch (e) {
      errors.push({ scope: "insights", id: acc.id, error: e instanceof Error ? e.message : String(e) });
      continue;
    }

    const agg90 = aggregate(rows90d);
    const agg30 = aggregate(rows30d);

    // 광고 메타데이터 (creative thumbnail + status)
    const adIds = Array.from(agg90.keys());
    const adMeta = new Map<string, { thumbnail_url: string | null; status: string }>();
    if (adIds.length > 0) {
      try {
        const data = await metaGet(`/${acc.id}/ads`, token, {
          fields: "id,status,creative{thumbnail_url}",
          filtering: JSON.stringify([{ field: "id", operator: "IN", value: adIds }]),
          limit: "500",
        }) as { data?: Array<{ id: string; status: string; creative?: { thumbnail_url?: string } }> };
        for (const ad of data.data ?? []) {
          adMeta.set(ad.id, {
            thumbnail_url: ad.creative?.thumbnail_url ?? null,
            status: ad.status,
          });
        }
      } catch (e) {
        errors.push({ scope: "ad_meta", id: acc.id, error: e instanceof Error ? e.message : String(e) });
      }
    }

    for (const [adId, a] of agg90) {
      const r30 = agg30.get(adId);
      const spend30 = r30?.insight.spend ?? 0;
      const revenue30 = r30?.insight.revenue ?? 0;
      const conversions30d = r30?.insight.conversions ?? 0;
      const roas30 = spend30 > 0 ? revenue30 / spend30 : 0;
      const roas90 = a.insight.spend > 0 ? a.insight.revenue / a.insight.spend : 0;

      // 큰 주문 보정 (단일 최대 매출이 90d 매출의 LARGE_ORDER_SHARE 이상)
      const maxSingle = a.rawRevenues.length > 0 ? Math.max(...a.rawRevenues) : 0;
      const largestShare = a.insight.revenue > 0 ? maxSingle / a.insight.revenue : 0;
      const adjustedRevenue = largestShare >= POLICY.LARGE_ORDER_SHARE
        ? Math.max(0, a.insight.revenue - maxSingle)
        : a.insight.revenue;
      const adjustedRoas = a.insight.spend > 0 ? adjustedRevenue / a.insight.spend : 0;

      const meta = adMeta.get(adId) ?? { thumbnail_url: null, status: "UNKNOWN" };

      // 탈락 사유 계산 (우선순위: no_revenue > low_sample > decayed)
      const sampleOk = a.insight.spend >= POLICY.MIN_SPEND_KRW || a.insight.conversions >= POLICY.MIN_CONVERSIONS;
      const decayRatio = roas90 > 0 && spend30 > 0 ? roas30 / roas90 : null;
      const decayed = decayRatio !== null && decayRatio < POLICY.DECAY_THRESHOLD;
      let rejectionReason: RejectionReason = null;
      if (adjustedRoas <= 0) rejectionReason = "no_revenue";
      else if (!sampleOk) rejectionReason = "low_sample";
      else if (decayed) rejectionReason = "decayed";

      all.push({
        adId,
        adName:        a.meta.ad_name,
        adsetId:       a.meta.adset_id,
        adsetName:     a.meta.adset_name,
        campaignId:    a.meta.campaign_id,
        campaignName:  a.meta.campaign_name,
        accountId:     acc.id,
        accountName:   acc.name,
        spend90d:      Math.round(a.insight.spend),
        revenue90d:    Math.round(a.insight.revenue),
        adjustedRevenue90d: Math.round(adjustedRevenue),
        conversions90d: a.insight.conversions,
        roas90d:       +roas90.toFixed(3),
        adjustedRoas90d: +adjustedRoas.toFixed(3),
        spend30d:      Math.round(spend30),
        revenue30d:    Math.round(revenue30),
        conversions30d,
        roas30d:       +roas30.toFixed(3),
        largestRevenueShare: +largestShare.toFixed(3),
        thumbnailUrl:  meta.thumbnail_url,
        status:        meta.status,
        rejectionReason,
        spendShortfall: Math.max(0, POLICY.MIN_SPEND_KRW - Math.round(a.insight.spend)),
        conversionsShortfall: Math.max(0, POLICY.MIN_CONVERSIONS - a.insight.conversions),
        decayRatio: decayRatio !== null ? +decayRatio.toFixed(3) : null,
      });
    }
  }

  const candidates = all.filter((c) => c.rejectionReason === null);
  candidates.sort((a, b) => b.adjustedRoas90d - a.adjustedRoas90d);
  const top = candidates.slice(0, POLICY.TOP_N);

  // 통계
  const stats: RejectionStats = {
    totalAds:  all.length,
    passed:    candidates.length,
    noRevenue: all.filter((c) => c.rejectionReason === "no_revenue").length,
    lowSample: all.filter((c) => c.rejectionReason === "low_sample").length,
    decayed:   all.filter((c) => c.rejectionReason === "decayed").length,
  };

  // 가장 근접한 후보 (low_sample 위주):
  //   - spend90d 또는 conversions90d 비율로 가장 근접한 5개
  //   - 매출이 있는 광고만 (보정 ROAS > 0)
  const nearMisses = all
    .filter((c) => c.rejectionReason === "low_sample" && c.adjustedRoas90d > 0)
    .map((c) => ({
      c,
      // 0~1: 둘 중 더 큰 비율 (어느 쪽이든 임계 100% 가까울수록 1)
      progress: Math.max(
        c.spend90d / POLICY.MIN_SPEND_KRW,
        c.conversions90d / POLICY.MIN_CONVERSIONS,
      ),
    }))
    .sort((a, b) => b.progress - a.progress)
    .slice(0, 5)
    .map((x) => x.c);

  return { candidates, top, analyzed: all, nearMisses, stats, errors };
}

export const BEST_CREATIVE_POLICY = POLICY;
