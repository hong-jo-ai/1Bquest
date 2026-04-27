/**
 * 광고세트 자동 예산 조정 — 정책 엔진.
 *
 * Phase 1: 추천만 산출 (실제 변경 X). 매일 cron으로 실행 → DB 기록 → UI 표시.
 *
 * 단위: KRW는 zero-decimal 통화라 Meta API의 daily_budget이 그대로 원 단위.
 *       (USD처럼 cents로 ×100 하지 않음.) 내부 계산도 모두 원 단위.
 *
 * 정책:
 *   - 7일 rolling Meta purchase_roas 기준
 *   - ≥ HIGH(2.5)  → +DELTA(15)% 증액
 *   - ≤ LOW(1.5)   → -DELTA(15)% 감액
 *   - 그 사이      → 유지
 *   - 7일 지출 < MIN_SPEND(10만원) → 통계 노이즈로 제외 (skipped)
 *   - 추천 일 예산이 MIN_BUDGET(5천원) 미만이면 5천원으로 클램프
 *   - 상한 없음 (한 번에 +15%만 오르므로 점진적)
 *   - Meta 20% 룰: 한 번에 ±20% 이내면 학습 단계 리셋 안 됨 → 15%는 안전 마진
 */
import { metaGet } from "./metaClient";

export const POLICY = {
  ROAS_HIGH:        2.5,
  ROAS_LOW:         1.5,
  DELTA_PCT:        15,
  MIN_SPEND_KRW:    100_000,   // 7일 누적 지출 하한
  MIN_BUDGET_KRW:   5_000,     // 일 예산 하한
} as const;

export type AutoBudgetAction = "increase" | "decrease" | "maintain" | "skipped";
export type AutoBudgetReason =
  | "roas_high"
  | "roas_low"
  | "roas_neutral"
  | "low_spend"
  | "no_budget"
  | "no_data";

export interface AdsetSnapshot {
  accountId:     string;
  accountName:   string;
  adsetId:       string;
  adsetName:     string;
  campaignName:  string;
  status:        string;
  currentBudget: number;  // KRW (원)
  spend7d:       number;  // KRW
  roas7d:        number;
}

export interface BudgetRecommendation extends AdsetSnapshot {
  recommendedBudget: number; // KRW
  deltaPct:          number; // e.g. 15, -15, 0
  action:            AutoBudgetAction;
  reason:            AutoBudgetReason;
}

/**
 * 단일 광고세트 → 추천. 순수 함수 (테스트 가능).
 */
export function recommendForAdset(snap: AdsetSnapshot): BudgetRecommendation {
  // 광고세트 단위 daily_budget이 없는 경우 (CBO=캠페인 단위 예산) → 손대지 않음
  if (!snap.currentBudget || snap.currentBudget <= 0) {
    return {
      ...snap,
      recommendedBudget: snap.currentBudget,
      deltaPct: 0,
      action: "skipped",
      reason: "no_budget",
    };
  }

  // 7일 지출이 너무 적으면 ROAS 노이즈 큼 → 건너뜀
  if (snap.spend7d < POLICY.MIN_SPEND_KRW) {
    return {
      ...snap,
      recommendedBudget: snap.currentBudget,
      deltaPct: 0,
      action: "skipped",
      reason: "low_spend",
    };
  }

  // ROAS=0은 conversion 없음 → 데이터 없음으로 분류 (감액 금지)
  if (snap.roas7d <= 0) {
    return {
      ...snap,
      recommendedBudget: snap.currentBudget,
      deltaPct: 0,
      action: "skipped",
      reason: "no_data",
    };
  }

  let action: AutoBudgetAction = "maintain";
  let reason: AutoBudgetReason = "roas_neutral";
  let deltaPct = 0;

  if (snap.roas7d >= POLICY.ROAS_HIGH) {
    action = "increase";
    reason = "roas_high";
    deltaPct = POLICY.DELTA_PCT;
  } else if (snap.roas7d <= POLICY.ROAS_LOW) {
    action = "decrease";
    reason = "roas_low";
    deltaPct = -POLICY.DELTA_PCT;
  }

  // KRW 원 단위. 100원 단위로 반올림 (Meta는 1원 단위 받지만 깔끔하게).
  const raw = Math.round(snap.currentBudget * (1 + deltaPct / 100));
  let recommended = Math.round(raw / 100) * 100;
  if (recommended < POLICY.MIN_BUDGET_KRW) {
    recommended = POLICY.MIN_BUDGET_KRW;
  }

  // 클램프 후 변화 없으면 maintain으로 강등
  if (recommended === snap.currentBudget) {
    action = "maintain";
    if (reason === "roas_high" || reason === "roas_low") reason = "roas_neutral";
    deltaPct = 0;
  }

  return {
    ...snap,
    recommendedBudget: recommended,
    deltaPct,
    action,
    reason,
  };
}

/**
 * Meta API: 한 광고 계정의 모든 활성 광고세트를 7일 인사이트와 함께 가져옴.
 */
export async function fetchAdsetsWith7dInsights(
  token: string,
  accountId: string,
  accountName: string
): Promise<AdsetSnapshot[]> {
  const data = await metaGet(`/${accountId}/adsets`, token, {
    fields: [
      "id",
      "name",
      "status",
      "campaign{name}",
      "daily_budget",
      "insights.date_preset(last_7d){spend,purchase_roas}",
    ].join(","),
    effective_status: JSON.stringify(["ACTIVE"]),
    limit: "200",
  });

  const out: AdsetSnapshot[] = [];
  for (const s of data.data ?? []) {
    const ins = s.insights?.data?.[0] ?? {};
    const spend7d = parseFloat(ins.spend ?? "0");
    let roas7d = 0;
    if (Array.isArray(ins.purchase_roas) && ins.purchase_roas.length > 0) {
      roas7d = parseFloat(ins.purchase_roas[0].value ?? "0");
    }
    out.push({
      accountId,
      accountName,
      adsetId:       s.id,
      adsetName:     s.name ?? "",
      campaignName:  s.campaign?.name ?? "",
      status:        s.status ?? "",
      currentBudget: parseInt(s.daily_budget ?? "0", 10),
      spend7d,
      roas7d,
    });
  }
  return out;
}

export const ACTION_LABEL_KO: Record<AutoBudgetAction, string> = {
  increase: "증액",
  decrease: "감액",
  maintain: "유지",
  skipped:  "제외",
};

export const REASON_LABEL_KO: Record<AutoBudgetReason, string> = {
  roas_high:    "ROAS ≥ 2.5 → 증액",
  roas_low:     "ROAS ≤ 1.5 → 감액",
  roas_neutral: "ROAS 1.5~2.5 → 유지",
  low_spend:    "7일 지출 < 10만원 (노이즈)",
  no_budget:    "광고세트 일 예산 없음 (CBO)",
  no_data:      "구매 데이터 부족",
};
