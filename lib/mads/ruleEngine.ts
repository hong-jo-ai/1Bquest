/**
 * 룰 엔진 — TrustEvaluation + AdSet + 임계값 → Recommendation.
 *
 * 우선순위 (먼저 매칭되는 액션이 채택):
 *   1. 변경 락 (직전 변경 후 N시간 내) → hold
 *   2. 큰 주문 왜곡 + adjustedRoas7d < 1.5 → 보수적 처리 (hold + 경고)
 *   3. 명백한 죽은 광고 (어떤 등급이든): roas7d < ROAS_LOW + spend7d ≥ pauseMin → pause
 *   4. untrusted: hold (3번 빼고)
 *   5. decaying: creative_refresh
 *   6. learning: ROAS_HIGH 초과 시만 보수적 +20%
 *   7. trusted: ROAS_HIGH → +incrPctHigh, BASE → +incrPctBase 또는 duplicate
 *   8. trusted + 그 사이: hold (현상 유지)
 */
import type { Recommendation, TrustEvaluation, Warning } from "./types";
import type { AdSetSummary } from "./types";
import type { ResolvedThresholds } from "./marginConfig";

export interface RuleInput {
  adSet: AdSetSummary;
  trust: TrustEvaluation;
  thresholds: ResolvedThresholds;
  warnings: Warning[];
}

function clampBudget(raw: number, minBudget: number): number {
  const rounded = Math.round(raw / 100) * 100;
  return Math.max(rounded, minBudget);
}

export function generateRecommendation(input: RuleInput): Recommendation {
  const { adSet, trust, thresholds, warnings } = input;
  const { roasLow, roasBase, roasHigh, policy } = thresholds;
  const cur = adSet.dailyBudget;

  const lockedByChange = warnings.some((w) => w.code === "recent_budget_change");
  const wobbling       = warnings.some((w) => w.code === "wobble");

  // ── 1. 변경 락 ────────────────────────────────────────────
  if (lockedByChange) {
    return {
      actionType: "hold",
      currentBudget: cur,
      recommendedBudget: cur,
      deltaPct: 0,
      reason: `예산 변경 락 (${policy.changeLockHours}h 미경과). Meta 학습 보호.`,
      warnings,
      trust,
    };
  }

  // ── 2. 흔들림 → 보류 ──────────────────────────────────────
  if (wobbling) {
    return {
      actionType: "hold",
      currentBudget: cur,
      recommendedBudget: cur,
      deltaPct: 0,
      reason: "흔들림 감지 — 결정 보류. 24h 후 재평가.",
      warnings,
      trust,
    };
  }

  // ── 3. 명백한 죽은 광고 (등급 무관) ─────────────────────────
  //   ROAS_LOW(BE×0.95) 미만 + 7d 누적 지출 ≥ pauseMin → pause
  if (
    trust.spend7d >= policy.pauseMinSpendKrw &&
    trust.adjustedRoas7d < roasLow &&
    trust.roas7d < roasLow
  ) {
    return {
      actionType: "pause",
      currentBudget: cur,
      recommendedBudget: null,
      deltaPct: null,
      reason:
        `7일 ROAS ${trust.roas7d.toFixed(2)} (보정 ${trust.adjustedRoas7d.toFixed(2)}) < BE 임계 ${roasLow}. ` +
        `누적 지출 ${trust.spend7d.toLocaleString("ko-KR")}원. 적자 확정 → 종료.`,
      warnings,
      trust,
    };
  }

  // CBO(예산 없음)면 이후 액션 의미 없음
  if (cur === null || cur <= 0) {
    return {
      actionType: "hold",
      currentBudget: cur,
      recommendedBudget: null,
      deltaPct: 0,
      reason: "광고세트 일 예산 없음 (CBO). 캠페인 단위 예산 운영 중.",
      warnings,
      trust,
    };
  }

  // ── 4. untrusted ──────────────────────────────────────────
  if (trust.level === "untrusted") {
    return {
      actionType: "hold",
      currentBudget: cur,
      recommendedBudget: cur,
      deltaPct: 0,
      reason: trust.reason + " 데이터 더 쌓일 때까지 변경 보류.",
      warnings,
      trust,
    };
  }

  // ── 5. decaying ───────────────────────────────────────────
  if (trust.level === "decaying") {
    return {
      actionType: "creative_refresh",
      currentBudget: cur,
      recommendedBudget: cur,
      deltaPct: 0,
      reason: trust.reason + " 새 크리에이티브 투입 권장.",
      warnings,
      trust,
    };
  }

  // ── 6. learning: HIGH 초과 시만 보수적 +20% ────────────────
  if (trust.level === "learning") {
    if (trust.roas7d >= roasHigh && trust.roas3d >= roasHigh - 0.5) {
      const recommended = clampBudget(cur * 1.2, policy.minBudgetKrw);
      if (recommended !== cur) {
        return {
          actionType: "increase",
          currentBudget: cur,
          recommendedBudget: recommended,
          deltaPct: 20,
          reason: `Learning 단계 + 7일 ROAS ${trust.roas7d.toFixed(2)} ≥ ${roasHigh}. 보수적 +20% 증액.`,
          warnings,
          trust,
        };
      }
    }
    return {
      actionType: "hold",
      currentBudget: cur,
      recommendedBudget: cur,
      deltaPct: 0,
      reason: trust.reason + " 학습 진행 중 — 큰 변경 금지.",
      warnings,
      trust,
    };
  }

  // ── 7. trusted ────────────────────────────────────────────
  // HIGH 충족 + 3일 ROAS도 따라올 때 → 공격 증액 (또는 복제)
  if (trust.roas7d >= roasHigh && trust.roas3d >= roasHigh - 0.5) {
    if (cur >= policy.duplicateBudgetKrw) {
      return {
        actionType: "duplicate",
        currentBudget: cur,
        recommendedBudget: cur,
        deltaPct: 0,
        reason:
          `7일 ROAS ${trust.roas7d.toFixed(2)} ≥ ${roasHigh}, 일예산 ${cur.toLocaleString("ko-KR")}원 도달. ` +
          `단일 세트 무한 증액 대신 복제 권장 (오디언스/배치 분리).`,
        warnings,
        trust,
      };
    }
    const recommended = clampBudget(cur * (1 + policy.incrPctHigh / 100), policy.minBudgetKrw);
    return {
      actionType: "increase",
      currentBudget: cur,
      recommendedBudget: recommended,
      deltaPct: policy.incrPctHigh,
      reason: `Trusted + 7일 ROAS ${trust.roas7d.toFixed(2)} (3일 ${trust.roas3d.toFixed(2)}) ≥ HIGH ${roasHigh}. +${policy.incrPctHigh}% 증액.`,
      warnings,
      trust,
    };
  }

  // BASE 충족 → +30% 또는 복제
  if (trust.roas7d >= roasBase && trust.roas3d >= roasBase - 0.5) {
    if (cur >= policy.duplicateBudgetKrw) {
      return {
        actionType: "duplicate",
        currentBudget: cur,
        recommendedBudget: cur,
        deltaPct: 0,
        reason:
          `일예산 ${cur.toLocaleString("ko-KR")}원, ROAS ${trust.roas7d.toFixed(2)} 유지. ` +
          `단일 세트 천장 — 복제 확장 권장.`,
        warnings,
        trust,
      };
    }
    const recommended = clampBudget(cur * (1 + policy.incrPctBase / 100), policy.minBudgetKrw);
    return {
      actionType: "increase",
      currentBudget: cur,
      recommendedBudget: recommended,
      deltaPct: policy.incrPctBase,
      reason: `Trusted + 7일 ROAS ${trust.roas7d.toFixed(2)} ≥ BASE ${roasBase}. +${policy.incrPctBase}% 증액.`,
      warnings,
      trust,
    };
  }

  // 그 사이 → 유지
  return {
    actionType: "hold",
    currentBudget: cur,
    recommendedBudget: cur,
    deltaPct: 0,
    reason: `Trusted, 7일 ROAS ${trust.roas7d.toFixed(2)} (BE ${thresholds.beRoas} ~ BASE ${roasBase}). 현상 유지.`,
    warnings,
    trust,
  };
}

// ── 라벨 ──────────────────────────────────────────────────────
export const ACTION_LABEL_KO: Record<Recommendation["actionType"], string> = {
  increase:         "증액",
  decrease:         "감액",
  pause:            "일시중지",
  duplicate:        "복제 확장",
  creative_refresh: "크리에이티브 교체",
  hold:             "보류",
};

export const TRUST_LABEL_KO: Record<TrustEvaluation["level"], string> = {
  untrusted: "데이터 부족",
  learning:  "학습 중",
  trusted:   "신뢰 OK",
  decaying:  "성과 하락",
};
