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
import type { AdSetSummary, DailyMetric, FunnelStage } from "./types";

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
  campaign?: { id: string; name: string; objective?: string };
  updated_time?: string;
}

export async function listActiveAdSets(
  token: string,
  accountId: string,
  accountName: string,
): Promise<AdSetSummary[]> {
  const data = (await metaGet(`/${accountId}/adsets`, token, {
    fields: "id,name,status,daily_budget,updated_time,campaign{id,name,objective}",
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
    lastBudgetChangeAt: s.updated_time ?? null,
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
    fields: "spend,impressions,clicks,ctr,actions,action_values",
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
    };
  });
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
