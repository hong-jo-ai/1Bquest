import { metaGet } from "./metaClient";

// ── 타입 ──────────────────────────────────────────────────────────────────

export interface MetaPeriodInsights {
  spend:       number;
  impressions: number;
  clicks:      number;
  ctr:         number;
  cpm:         number;
  reach:       number;
  roas:        number;
}

export interface MetaCampaign {
  id:          string;
  name:        string;
  status:      "ACTIVE" | "PAUSED" | "ARCHIVED" | "DELETED";
  objective:   string;
  spend:       number;
  impressions: number;
  clicks:      number;
  ctr:         number;
  cpm:         number;
  reach:       number;
  roas:        number;
  frequency:   number;
  dailyBudget: number;
  createdTime: string;   // ISO 날짜 — 운영 기간 계산용
}

export type Period = "today" | "yesterday" | "last3d" | "last7d" | "week" | "month";

export const PERIOD_META_PRESET: Record<Period, string> = {
  today:     "today",
  yesterday: "yesterday",
  last3d:    "last_3d",
  last7d:    "last_7d",
  week:      "this_week_mon_today",
  month:     "this_month",
};

export const PERIOD_LABEL: Record<Period, string> = {
  today:     "오늘",
  yesterday: "어제",
  last3d:    "최근 3일",
  last7d:    "최근 7일",
  week:      "이번 주",
  month:     "이번 달",
};

export interface MetaAdsData {
  adAccountId:   string;
  adAccountName: string;
  currency:      string;
  today:         MetaPeriodInsights;
  yesterday:     MetaPeriodInsights;
  last3d:        MetaPeriodInsights;
  last7d:        MetaPeriodInsights;
  week:          MetaPeriodInsights;
  month:         MetaPeriodInsights;
  campaigns:     MetaCampaign[];   // this_month 기준 초기 데이터
  isReal:        true;
}

// ── 파싱 유틸 ─────────────────────────────────────────────────────────────

const EMPTY_INSIGHTS: MetaPeriodInsights = {
  spend: 0, impressions: 0, clicks: 0,
  ctr: 0, cpm: 0, reach: 0, roas: 0,
};

function parseInsights(raw: any): MetaPeriodInsights & { frequency: number } {
  const d = raw?.data?.[0];
  if (!d) return { ...EMPTY_INSIGHTS, frequency: 0 };

  const spend       = parseFloat(d.spend       ?? "0");
  const impressions = parseInt(d.impressions   ?? "0", 10);
  const clicks      = parseInt(d.clicks        ?? "0", 10);
  const ctr         = parseFloat(d.ctr         ?? "0");
  const cpm         = parseFloat(d.cpm         ?? "0");
  const reach       = parseInt(d.reach         ?? "0", 10);
  const frequency   = parseFloat(d.frequency   ?? "0");

  let roas = 0;
  if (Array.isArray(d.purchase_roas) && d.purchase_roas.length > 0) {
    roas = parseFloat(d.purchase_roas[0].value ?? "0");
  }

  return { spend, impressions, clicks, ctr, cpm, reach, roas, frequency };
}

export const INSIGHT_FIELDS = "spend,impressions,clicks,ctr,cpm,reach,purchase_roas,frequency";

// ── 인사이트 조회 ─────────────────────────────────────────────────────────

async function fetchInsights(
  token: string,
  accountId: string,
  datePreset: string
): Promise<MetaPeriodInsights> {
  try {
    const data = await metaGet(`/${accountId}/insights`, token, {
      fields:      INSIGHT_FIELDS,
      date_preset: datePreset,
      level:       "account",
    });
    const { frequency: _f, ...rest } = parseInsights(data);
    return rest;
  } catch (e) {
    console.error(`[meta] insights(${datePreset}) error:`, e);
    return { ...EMPTY_INSIGHTS };
  }
}

// ── 캠페인 조회 ───────────────────────────────────────────────────────────

export async function fetchCampaigns(
  token: string,
  accountId: string,
  datePreset: string = "this_month",
  includePaused: boolean = false
): Promise<MetaCampaign[]> {
  try {
    const data = await metaGet(`/${accountId}/campaigns`, token, {
      fields: [
        "id", "name", "status", "objective",
        "daily_budget", "created_time",
        `insights.date_preset(${datePreset}){${INSIGHT_FIELDS}}`,
      ].join(","),
      effective_status: JSON.stringify(includePaused ? ["ACTIVE", "PAUSED"] : ["ACTIVE"]),
      limit: "25",
    });

    return (data.data ?? []).map((c: any): MetaCampaign => {
      const ins = parseInsights(c.insights);
      return {
        id:          c.id,
        name:        c.name,
        status:      c.status,
        objective:   c.objective ?? "",
        spend:       ins.spend,
        impressions: ins.impressions,
        clicks:      ins.clicks,
        ctr:         ins.ctr,
        cpm:         ins.cpm,
        reach:       ins.reach,
        roas:        ins.roas,
        frequency:   ins.frequency,
        dailyBudget: parseInt(c.daily_budget ?? "0", 10),
        createdTime: c.created_time ?? "",
      };
    });
  } catch (e) {
    console.error("[meta] campaigns error:", e);
    return [];
  }
}

// ── 메인 데이터 조회 ──────────────────────────────────────────────────────

export async function getMetaAdsData(token: string): Promise<MetaAdsData> {
  const accountsData = await metaGet("/me/adaccounts", token, {
    fields: "id,name,currency,account_status",
    limit:  "10",
  });

  const accounts: any[] = accountsData.data ?? [];
  if (accounts.length === 0) throw new Error("연결된 광고 계정이 없습니다");

  const envAccountId = process.env.META_AD_ACCOUNT_ID;
  const account =
    (envAccountId ? accounts.find((a) => a.id === envAccountId) : null) ??
    accounts.find((a) => a.account_status === 1) ??
    accounts[0];

  const accountId = account.id as string;

  const [today, yesterday, last3d, last7d, week, month, campaigns] = await Promise.all([
    fetchInsights(token, accountId, "today"),
    fetchInsights(token, accountId, "yesterday"),
    fetchInsights(token, accountId, "last_3d"),
    fetchInsights(token, accountId, "last_7d"),
    fetchInsights(token, accountId, "this_week_mon_today"),
    fetchInsights(token, accountId, "this_month"),
    fetchCampaigns(token, accountId, "this_month"),
  ]);

  return {
    adAccountId:   accountId,
    adAccountName: account.name ?? "광고 계정",
    currency:      account.currency ?? "KRW",
    today,
    yesterday,
    last3d,
    last7d,
    week,
    month,
    campaigns,
    isReal: true,
  };
}

// ── 목적 한국어 레이블 ────────────────────────────────────────────────────

export const OBJECTIVE_KO: Record<string, string> = {
  OUTCOME_SALES:         "판매",
  OUTCOME_TRAFFIC:       "트래픽",
  OUTCOME_ENGAGEMENT:    "참여",
  OUTCOME_AWARENESS:     "인지도",
  OUTCOME_LEADS:         "리드",
  OUTCOME_APP_PROMOTION: "앱 홍보",
  CONVERSIONS:           "전환",
  LINK_CLICKS:           "링크 클릭",
  REACH:                 "도달",
  BRAND_AWARENESS:       "브랜드 인지도",
  VIDEO_VIEWS:           "동영상 조회",
  APP_INSTALLS:          "앱 설치",
};
