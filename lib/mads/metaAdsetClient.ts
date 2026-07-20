/**
 * Meta Marketing API helpers for MADS.
 *
 *   - listActiveAdSets: 모든 활성 광고세트 (캠페인/계정 메타 포함)
 *   - fetchDailyMetrics: 광고세트의 14일 일별 인사이트 (큰 주문 보정용 maximum 포함)
 *   - updateBudget: 광고세트 daily_budget 변경
 *   - pauseAdset: 광고세트 일시중지
 *   - duplicateAdset: 광고세트 복제 (예산 + 오디언스 분리 옵션)
 *
 * KRW는 zero-decimal 통화 (Meta가 daily_budget을 cents 변환 안 함).
 */
import { metaGet, metaPost } from "../metaClient";
import type { AdDailyMetric, AdSetSummary, AdSummary, DailyMetric, FunnelStage } from "./types";

const PURCHASE_ACTIONS = new Set([
  "purchase",
  "omni_purchase",
  "offsite_conversion.fb_pixel_purchase",
]);

interface AdInsightAction {
  action_type: string;
  value: string;
  "1d_click"?: string;
  "7d_click"?: string;
}

interface InsightRow {
  date_start?: string;
  date_stop?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  ctr?: string;
  cpm?: string;
  frequency?: string;
  reach?: string;
  ad_id?: string;
  actions?: AdInsightAction[];
  action_values?: AdInsightAction[];
}

function sumPurchase(rows: AdInsightAction[] | undefined): number {
  if (!rows) return 0;
  let total = 0;
  for (const r of rows) {
    if (PURCHASE_ACTIONS.has(r.action_type)) {
      // 가장 큰 attribution window 값 사용
      total = Math.max(total, parseFloat(r.value ?? "0"));
    }
  }
  return total;
}

/** 캠페인명/오디언스명 패턴으로 funnel stage 추정. */
function guessFunnelStage(name: string, campaignName: string): FunnelStage {
  const n = `${name} ${campaignName}`.toLowerCase();
  if (/리타게?팅|리타겟|리마케팅|재타겟|retarget|remarket|rt|warm|engaged|view|atc|add[_ ]?to[_ ]?cart|장바구니|구매자|repurch/.test(n)) {
    return "retargeting";
  }
  if (/신규|prospect|cold|broad|interest|lookalike|lal|asc/.test(n)) {
    return "prospecting";
  }
  return "unknown";
}

export async function listActiveAccounts(token: string): Promise<Array<{ id: string; name: string }>> {
  const res = (await metaGet("/me/adaccounts", token, {
    fields: "id,name,account_status",
    limit: "20",
  })) as { data?: Array<{ id: string; name: string; account_status: number }> };
  return (res.data ?? []).filter((a) => a.account_status === 1).map((a) => ({ id: a.id, name: a.name }));
}

interface MetaAdSet {
  id: string;
  name: string;
  status: string;
  daily_budget?: string;
  campaign?: { id: string; name: string; objective?: string; updated_time?: string };
  updated_time?: string;
}

function latestIso(...values: Array<string | undefined>): string | null {
  const valid = values.filter((v): v is string => Boolean(v));
  if (valid.length === 0) return null;
  return valid.reduce((latest, value) =>
    new Date(value).getTime() > new Date(latest).getTime() ? value : latest,
  );
}

export async function listActiveAdSets(
  token: string,
  accountId: string,
  accountName: string,
): Promise<AdSetSummary[]> {
  const data = (await metaGet(`/${accountId}/adsets`, token, {
    fields: "id,name,status,daily_budget,updated_time,campaign{id,name,objective,updated_time}",
    effective_status: JSON.stringify(["ACTIVE"]),
    limit: "200",
  })) as { data?: MetaAdSet[] };

  return (data.data ?? []).map((s) => ({
    metaAdsetId:        s.id,
    metaAccountId:      accountId,
    accountName,
    campaignId:         s.campaign?.id ?? null,
    campaignName:       s.campaign?.name ?? null,
    campaignObjective:  s.campaign?.objective ?? null,
    name:               s.name ?? "",
    status:             s.status ?? "ACTIVE",
    dailyBudget:        s.daily_budget ? parseInt(s.daily_budget, 10) : null,
    funnelStage:        guessFunnelStage(s.name ?? "", s.campaign?.name ?? ""),
    lastBudgetChangeAt: latestIso(s.updated_time, s.campaign?.updated_time),
  }));
}

/** 광고세트의 최근 days일 일별 메트릭. action_values의 max로 큰 주문 보정. */
export async function fetchDailyMetrics(
  token: string,
  metaAdsetId: string,
  days = 14,
): Promise<DailyMetric[]> {
  const since = new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000);
  const sinceStr = since.toISOString().slice(0, 10);
  const untilStr = new Date().toISOString().slice(0, 10);

  const insRes = (await metaGet(`/${metaAdsetId}/insights`, token, {
    fields: "spend,impressions,clicks,ctr,cpm,frequency,reach,actions,action_values",
    time_range: JSON.stringify({ since: sinceStr, until: untilStr }),
    time_increment: "1",
    level: "adset",
  })) as { data?: InsightRow[] };

  // 전환 일자별 큰 주문 1건 추정: action_values에서 가장 큰 value를 일별 max로 사용.
  // (Meta는 일별 개별 주문 단가를 직접 제공하지 않음 — 최선의 근사)
  const today = new Date();
  const yesterdayStr = new Date(today.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  return (insRes.data ?? []).map((r) => {
    const date = r.date_start ?? "";
    const spend         = parseFloat(r.spend ?? "0");
    const impressions   = parseInt(r.impressions ?? "0", 10);
    const clicks        = parseInt(r.clicks ?? "0", 10);
    const ctr           = parseFloat(r.ctr ?? "0");
    const revenue       = sumPurchase(r.action_values);
    const conversions   = Math.round(sumPurchase(r.actions));
    // 일별 가장 큰 주문 추정 — purchase 계열 action_values 중 max.
    // ⚠️ 반드시 PURCHASE_ACTIONS 필터링 — 그렇지 않으면 view_content 같은 비-구매 액션의 value
    //   (해당 일에 본 상품 가격 합 — 시계 30만원 × 100명 = 3000만원 같은 값)이 '큰 주문' 으로 둔갑함.
    const purchaseValues = (r.action_values ?? [])
      .filter((a) => PURCHASE_ACTIONS.has(a.action_type))
      .map((a) => parseFloat(a.value ?? "0"));
    const largestOrderValue = revenue > 0 && conversions > 0
      ? Math.max(revenue / conversions, ...purchaseValues, 0)
      : 0;

    return {
      date,
      spend,
      revenue,
      conversions,
      impressions,
      clicks,
      ctr,
      largestOrderValue,
      isProvisional: date >= yesterdayStr,
      cpm:       r.cpm ? parseFloat(r.cpm) : null,
      frequency: r.frequency ? parseFloat(r.frequency) : null,
      reach:     r.reach ? parseInt(r.reach, 10) : null,
    };
  });
}

// ── 개별 광고(소재) 레벨 — /ads 현황판용 ────────────────────────────────

interface MetaAdRow {
  id: string;
  name?: string;
  adset_id?: string;
  effective_status?: string;
  creative?: MetaCreative & { thumbnail_url?: string };
}

/**
 * 계정의 광고(개별 소재) 목록 — 썸네일·포맷·상태 포함.
 * ACTIVE + PAUSED만 (아카이브 제외). 페이지네이션 없이 200개 한도(현재 계정 규모 충분).
 */
export async function listAccountAds(
  token: string,
  accountId: string,
): Promise<AdSummary[]> {
  const res = (await metaGet(`/${accountId}/ads`, token, {
    fields: "id,name,adset_id,effective_status,creative{thumbnail_url,object_type,video_id,object_story_spec{video_data,link_data,template_data},asset_feed_spec{videos,images}}",
    effective_status: JSON.stringify(["ACTIVE", "PAUSED", "PENDING_REVIEW", "DISAPPROVED", "WITH_ISSUES"]),
    limit: "200",
  })) as { data?: MetaAdRow[] };

  return (res.data ?? []).map((a) => ({
    metaAdId:        a.id,
    metaAdsetId:     a.adset_id ?? "",
    metaAccountId:   accountId,
    name:            a.name ?? "",
    effectiveStatus: a.effective_status ?? "UNKNOWN",
    creativeFormat:  detectCreativeFormat(a.creative),
    thumbnailUrl:    a.creative?.thumbnail_url ?? null,
  }));
}

/**
 * 계정 전체의 광고 레벨 일별 인사이트 (최근 days일) — 계정당 1콜.
 * ad_id 별 일별 spend/ROAS/CTR/CPM/빈도. limit 넉넉히(일수×광고수).
 */
export async function fetchAccountAdDailyInsights(
  token: string,
  accountId: string,
  days = 8,
): Promise<AdDailyMetric[]> {
  const since = new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const until = new Date().toISOString().slice(0, 10);
  const res = (await metaGet(`/${accountId}/insights`, token, {
    fields: "ad_id,spend,impressions,clicks,ctr,cpm,frequency,reach,actions,action_values",
    time_range: JSON.stringify({ since, until }),
    time_increment: "1",
    level: "ad",
    limit: "1000",
  })) as { data?: InsightRow[] };

  return (res.data ?? [])
    .filter((r) => r.ad_id && r.date_start)
    .map((r) => ({
      metaAdId:    r.ad_id as string,
      date:        r.date_start as string,
      spend:       parseFloat(r.spend ?? "0"),
      revenue:     sumPurchase(r.action_values),
      conversions: Math.round(sumPurchase(r.actions)),
      impressions: parseInt(r.impressions ?? "0", 10),
      clicks:      parseInt(r.clicks ?? "0", 10),
      ctr:         r.ctr ? parseFloat(r.ctr) : null,
      cpm:         r.cpm ? parseFloat(r.cpm) : null,
      frequency:   r.frequency ? parseFloat(r.frequency) : null,
      reach:       r.reach ? parseInt(r.reach, 10) : null,
    }));
}

interface MetaCreative {
  object_type?: string;
  video_id?: string;
  object_story_spec?: {
    video_data?: unknown;
    link_data?: { child_attachments?: unknown[] };
    template_data?: unknown;
  };
  asset_feed_spec?: { videos?: unknown[]; images?: unknown[] };
}

/** 소재 1건의 포맷 추정 — video / image / unknown. */
function detectCreativeFormat(creative?: MetaCreative): "video" | "image" | "unknown" {
  if (!creative) return "unknown";
  const oss = creative.object_story_spec;
  const afs = creative.asset_feed_spec;
  if (creative.video_id || oss?.video_data || (afs?.videos?.length ?? 0) > 0) return "video";
  if (oss?.link_data || oss?.template_data || (afs?.images?.length ?? 0) > 0) return "image";
  const ot = (creative.object_type ?? "").toUpperCase();
  if (ot.includes("VIDEO")) return "video";
  if (["PHOTO", "SHARE", "CAROUSEL", "STATUS"].includes(ot)) return "image";
  return "unknown";
}

/**
 * 광고세트에서 현재 노출 중인(ACTIVE) 광고의 소재 포맷 distinct 목록.
 * "소재 유형 다양성" 조언용 — 예: ["video"] 만 있으면 image 추가 권장.
 */
export async function fetchAdSetCreativeFormats(
  token: string,
  metaAdsetId: string,
): Promise<string[]> {
  const res = (await metaGet(`/${metaAdsetId}/ads`, token, {
    fields: "effective_status,creative{object_type,video_id,object_story_spec{video_data,link_data,template_data},asset_feed_spec{videos,images}}",
    effective_status: JSON.stringify(["ACTIVE"]),
    limit: "50",
  })) as { data?: Array<{ effective_status?: string; creative?: MetaCreative }> };

  const formats = new Set<string>();
  for (const ad of res.data ?? []) {
    const f = detectCreativeFormat(ad.creative);
    if (f !== "unknown") formats.add(f);
  }
  return [...formats];
}

export async function updateAdsetBudget(
  token: string,
  metaAdsetId: string,
  newDailyBudgetKrw: number,
): Promise<{ success: boolean; raw: unknown }> {
  const raw = await metaPost(`/${metaAdsetId}`, token, {
    daily_budget: String(newDailyBudgetKrw),
  });
  return { success: true, raw };
}

export async function pauseAdset(
  token: string,
  metaAdsetId: string,
): Promise<{ success: boolean; raw: unknown }> {
  const raw = await metaPost(`/${metaAdsetId}`, token, {
    status: "PAUSED",
  });
  return { success: true, raw };
}

export async function duplicateAdset(
  token: string,
  metaAdsetId: string,
): Promise<{ success: boolean; raw: unknown }> {
  // copies endpoint
  const raw = await metaPost(`/${metaAdsetId}/copies`, token, {
    deep_copy: "true",
    status_option: "PAUSED",
  });
  return { success: true, raw };
}
