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

export type FatigueSeverity = "critical" | "warning" | "info";
export type FatigueType =
  | "frequency"
  | "roas"
  | "ctr"
  | "cpm"
  | "age";

export interface FatigueAlert {
  campaignId:     string;
  campaignName:   string;
  severity:       FatigueSeverity;
  type:           FatigueType;
  title:          string;
  detail:         string;
  value:          string;
  recommendation: string;
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
  fatigueAlerts: FatigueAlert[];
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
  datePreset: string = "this_month"
): Promise<MetaCampaign[]> {
  try {
    const data = await metaGet(`/${accountId}/campaigns`, token, {
      fields: [
        "id", "name", "status", "objective",
        "daily_budget", "created_time",
        `insights.date_preset(${datePreset}){${INSIGHT_FIELDS}}`,
      ].join(","),
      effective_status: JSON.stringify(["ACTIVE", "PAUSED"]),
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

// ── 소재 피로도 감지 ──────────────────────────────────────────────────────

function detectCreativeFatigue(campaigns: MetaCampaign[]): FatigueAlert[] {
  const alerts: FatigueAlert[] = [];
  const now = Date.now();

  for (const c of campaigns) {
    if (c.status !== "ACTIVE") continue;
    // 이번 달 지출이 없으면 스킵 (데이터 없는 캠페인)
    if (c.spend === 0 && c.impressions === 0) continue;

    // ── 1. Frequency (노출 빈도) ──────────────────────────────────────
    if (c.frequency >= 3) {
      alerts.push({
        campaignId:     c.id,
        campaignName:   c.name,
        severity:       "critical",
        type:           "frequency",
        title:          "노출 빈도 초과",
        detail:         `이번 달 동일 오디언스에게 평균 ${c.frequency.toFixed(1)}회 노출됐습니다.`,
        value:          `${c.frequency.toFixed(1)}회`,
        recommendation: "지금 바로 소재를 교체하거나 Lookalike 등 신규 오디언스로 확장하세요.",
      });
    } else if (c.frequency >= 2) {
      alerts.push({
        campaignId:     c.id,
        campaignName:   c.name,
        severity:       "warning",
        type:           "frequency",
        title:          "노출 빈도 주의",
        detail:         `오디언스에게 평균 ${c.frequency.toFixed(1)}회 노출 — 피로도가 축적되고 있습니다.`,
        value:          `${c.frequency.toFixed(1)}회`,
        recommendation: "소재 변형(variation)을 준비하고 2~3일 내 교체를 검토하세요.",
      });
    }

    // ── 2. ROAS (광고비 대비 매출) ────────────────────────────────────
    if (c.roas > 0) {
      if (c.roas < 1.0) {
        alerts.push({
          campaignId:     c.id,
          campaignName:   c.name,
          severity:       "critical",
          type:           "roas",
          title:          "ROAS 위험 수준",
          detail:         `ROAS ${c.roas.toFixed(2)}x — 광고비보다 매출이 적어 적자 구조입니다.`,
          value:          `${c.roas.toFixed(2)}x`,
          recommendation: "소재를 즉시 중단하거나 타겟·입찰 전략을 전면 재검토하세요.",
        });
      } else if (c.roas < 1.5) {
        alerts.push({
          campaignId:     c.id,
          campaignName:   c.name,
          severity:       "warning",
          type:           "roas",
          title:          "ROAS 저조",
          detail:         `ROAS ${c.roas.toFixed(2)}x — 원가·운영비 반영 시 실질적으로 손익분기점 이하일 수 있습니다.`,
          value:          `${c.roas.toFixed(2)}x`,
          recommendation: "신규 소재를 병행 테스트하고 성과 개선 추이를 모니터링하세요.",
        });
      }
    }

    // ── 3. CTR (클릭률) — 전환/트래픽 목적 캠페인 위주 ──────────────
    const isPerformanceCampaign = [
      "OUTCOME_SALES", "OUTCOME_TRAFFIC", "CONVERSIONS", "LINK_CLICKS",
    ].includes(c.objective);
    if (isPerformanceCampaign && c.impressions >= 2000) {
      if (c.ctr < 0.5) {
        alerts.push({
          campaignId:     c.id,
          campaignName:   c.name,
          severity:       "critical",
          type:           "ctr",
          title:          "CTR 심각",
          detail:         `CTR ${c.ctr.toFixed(2)}% — 오디언스가 소재에 반응하지 않고 있습니다.`,
          value:          `${c.ctr.toFixed(2)}%`,
          recommendation: "썸네일·카피·훅(hook)을 전면 교체한 신규 소재를 즉시 테스트하세요.",
        });
      } else if (c.ctr < 1.0) {
        alerts.push({
          campaignId:     c.id,
          campaignName:   c.name,
          severity:       "warning",
          type:           "ctr",
          title:          "CTR 평균 이하",
          detail:         `CTR ${c.ctr.toFixed(2)}% — 한국 패션·액세서리 평균(1~3%) 대비 낮습니다.`,
          value:          `${c.ctr.toFixed(2)}%`,
          recommendation: "썸네일 또는 첫 3초 영상을 교체한 변형 소재를 A/B 테스트하세요.",
        });
      }
    }

    // ── 4. CPM (1,000회 노출 비용) — 비정상적 상승 감지 ─────────────
    // 한국 패션 평균 CPM ~20,000~40,000 KRW
    if (c.impressions >= 2000 && c.cpm > 70000) {
      alerts.push({
        campaignId:     c.id,
        campaignName:   c.name,
        severity:       "warning",
        type:           "cpm",
        title:          "CPM 과도 상승",
        detail:         `CPM ₩${Math.round(c.cpm).toLocaleString("ko-KR")} — 오디언스 경쟁이 심화되거나 소재 관련성 점수가 하락했습니다.`,
        value:          `₩${Math.round(c.cpm).toLocaleString("ko-KR")}`,
        recommendation: "오디언스를 확장하거나 소재를 교체해 Meta의 관련성 점수를 높이세요.",
      });
    }

    // ── 5. 캠페인 운영 기간 (패션/액세서리 기준) ─────────────────────
    if (c.createdTime) {
      const ageDays = (now - new Date(c.createdTime).getTime()) / 86_400_000;

      if (ageDays >= 42) {
        alerts.push({
          campaignId:     c.id,
          campaignName:   c.name,
          severity:       "critical",
          type:           "age",
          title:          "소재 교체 필수",
          detail:         `${Math.floor(ageDays)}일째 동일 소재 운영 중 (6주 초과). 소재 피로도가 극에 달했을 가능성이 높습니다.`,
          value:          `${Math.floor(ageDays)}일`,
          recommendation: "즉시 새 소재로 교체하세요. 기존 소재는 일시 중단 후 4~6주 후 재활용을 검토하세요.",
        });
      } else if (ageDays >= 21) {
        alerts.push({
          campaignId:     c.id,
          campaignName:   c.name,
          severity:       "warning",
          type:           "age",
          title:          "소재 교체 권고",
          detail:         `${Math.floor(ageDays)}일째 운영 중. 패션·액세서리 카테고리 권장 교체 주기(2~3주)를 초과했습니다.`,
          value:          `${Math.floor(ageDays)}일`,
          recommendation: "소재 변형(variation) 또는 신규 소재로 교체하세요. 동일 소구점에서 각도만 바꿔도 효과적입니다.",
        });
      } else if (ageDays >= 14) {
        alerts.push({
          campaignId:     c.id,
          campaignName:   c.name,
          severity:       "info",
          type:           "age",
          title:          "소재 교체 준비",
          detail:         `${Math.floor(ageDays)}일째 운영 중. 권장 교체 주기(2~3주)에 근접했습니다.`,
          value:          `${Math.floor(ageDays)}일`,
          recommendation: "신규 소재를 준비하고 CTR·ROAS 추이를 주의 깊게 모니터링하세요.",
        });
      }
    }
  }

  // 심각도 순 정렬 (critical → warning → info)
  const order: Record<FatigueSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) => order[a.severity] - order[b.severity]);
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

  const fatigueAlerts = detectCreativeFatigue(campaigns);

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
    fatigueAlerts,
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
