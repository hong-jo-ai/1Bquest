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
  if (/리타겟|retarget|rt|warm|engaged|view|atc|add[_ ]?to[_ ]?cart|구매자|repurch/.test(n)) {
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
    // 일별 가장 큰 주문 추정 — action_values의 가장 큰 단일 값.
    // (Meta는 같은 attribution에서 합산한 값이라 단일 주문가는 아님,
    //  하지만 평균객단가 8만원 기준 1건 매출이 30만원+이면 큰 주문으로 간주 가능)
    const largestOrderValue = revenue > 0 && conversions > 0
      ? Math.max(revenue / conversions, ...((r.action_values ?? []).map((a) => parseFloat(a.value ?? "0"))))
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
