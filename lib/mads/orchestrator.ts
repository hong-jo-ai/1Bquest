/**
 * 평가 사이클 — 한 번에 모든 활성 광고세트를 평가하고 추천 생성.
 *
 * 매일 KST 09:00 cron + 사용자 수동 트리거에서 호출.
 *
 *   1. Meta에서 활성 계정/광고세트 fetch
 *   2. 광고세트 메타 upsert
 *   3. 각 광고세트의 14일 일별 메트릭 fetch + upsert
 *   4. trust 평가 + warnings 빌드 + 룰 엔진 → recommendation
 *   5. recommendation insert (이전 pending은 superseded)
 *   6. expired 정리
 */
import { getMetaTokenServer } from "../metaTokenStore";
import {
  fetchDailyMetrics,
  listActiveAccounts,
  listActiveAdSets,
} from "./metaAdsetClient";
import { evaluateTrust } from "./trustEvaluator";
import { generateRecommendation } from "./ruleEngine";
import { buildWarnings, getManualActionCount24h } from "./wobbleDetector";
import {
  expireOldPending,
  getRecentMetrics,
  insertRecommendation,
  insertTrustEval,
  upsertAdSets,
  upsertDailyMetrics,
} from "./dbStore";
import { getMarginConfig, resolveThresholds } from "./marginConfig";
import { getActiveSeasonModifier } from "./seasonModifier";
import type { Recommendation } from "./types";

export interface RunResult {
  ok: boolean;
  accounts: number;
  adsetsEvaluated: number;
  recommendations: number;
  expired: number;
  counts: Record<string, number>;
  errors: Array<{ scope: string; id?: string; error: string }>;
  thresholds: { beRoas: number; roasLow: number; roasBase: number; roasHigh: number };
}

export async function runEvaluationCycle(): Promise<RunResult> {
  const errors: RunResult["errors"] = [];
  const token = await getMetaTokenServer();
  if (!token) {
    return {
      ok: false, accounts: 0, adsetsEvaluated: 0, recommendations: 0, expired: 0,
      counts: {}, errors: [{ scope: "auth", error: "Meta 토큰 없음 — 미연결" }],
      thresholds: { beRoas: 0, roasLow: 0, roasBase: 0, roasHigh: 0 },
    };
  }

  const [marginCfg, seasonModifier, expired] = await Promise.all([
    getMarginConfig(),
    getActiveSeasonModifier(),
    expireOldPending(),
  ]);
  const thresholds = resolveThresholds(marginCfg, seasonModifier);

  // 1. 계정 → 광고세트
  let accounts: Array<{ id: string; name: string }> = [];
  try {
    accounts = await listActiveAccounts(token);
  } catch (e) {
    errors.push({ scope: "accounts", error: msg(e) });
    return {
      ok: false, accounts: 0, adsetsEvaluated: 0, recommendations: 0, expired,
      counts: {}, errors, thresholds: stripThresholds(thresholds),
    };
  }

  let totalEvaluated = 0;
  const counts: Record<string, number> = {};

  for (const acc of accounts) {
    let adsets;
    try {
      adsets = await listActiveAdSets(token, acc.id, acc.name);
    } catch (e) {
      errors.push({ scope: "adsets", id: acc.id, error: msg(e) });
      continue;
    }

    if (adsets.length === 0) continue;

    try {
      await upsertAdSets(adsets);
    } catch (e) {
      errors.push({ scope: "ad_sets_upsert", id: acc.id, error: msg(e) });
    }

    // 광고세트별 메트릭 + 평가
    for (const adset of adsets) {
      try {
        const metrics = await fetchDailyMetrics(token, adset.metaAdsetId, 14);
        if (metrics.length > 0) await upsertDailyMetrics(adset.metaAdsetId, metrics);

        const recentMetrics = metrics.length > 0
          ? metrics
          : await getRecentMetrics(adset.metaAdsetId, 14);

        const trust = evaluateTrust(recentMetrics, {
          largeOrderShareThreshold: marginCfg.policy.largeOrderShareThreshold,
        });

        const manualCount = await getManualActionCount24h(adset.metaAdsetId);
        const warnings = buildWarnings({
          metaAdsetId:              adset.metaAdsetId,
          metrics:                  recentMetrics,
          lastBudgetChangeAt:       adset.lastBudgetChangeAt,
          changeLockHours:          marginCfg.policy.changeLockHours,
          largeOrderShareThreshold: marginCfg.policy.largeOrderShareThreshold,
          manualActionCount24h:     manualCount,
        });

        const rec = generateRecommendation({ adSet: adset, trust, thresholds, warnings });
        const trustEvalId = await insertTrustEval(adset.metaAdsetId, trust);
        await insertRecommendation(adset.metaAdsetId, trustEvalId, rec);

        counts[rec.actionType] = (counts[rec.actionType] ?? 0) + 1;
        totalEvaluated++;
      } catch (e) {
        errors.push({ scope: "evaluate", id: adset.metaAdsetId, error: msg(e) });
      }
    }
  }

  return {
    ok: true,
    accounts: accounts.length,
    adsetsEvaluated: totalEvaluated,
    recommendations: totalEvaluated,
    expired,
    counts,
    errors,
    thresholds: stripThresholds(thresholds),
  };
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function stripThresholds(t: ReturnType<typeof resolveThresholds>): RunResult["thresholds"] {
  return { beRoas: t.beRoas, roasLow: t.roasLow, roasBase: t.roasBase, roasHigh: t.roasHigh };
}

// ── 액션 적용 ──────────────────────────────────────────────────────────
export type ApplyResult =
  | { ok: true; result: unknown }
  | { ok: false; error: string };

export async function applyRecommendationAction(
  recommendation: Recommendation & { metaAdsetId: string },
): Promise<ApplyResult> {
  const token = await getMetaTokenServer();
  if (!token) return { ok: false, error: "Meta 토큰 없음" };

  const { updateAdsetBudget, pauseAdset, duplicateAdset } = await import("./metaAdsetClient");
  const { logManualAction } = await import("./wobbleDetector");

  try {
    switch (recommendation.actionType) {
      case "increase":
      case "decrease": {
        if (recommendation.recommendedBudget === null) {
          return { ok: false, error: "추천 예산이 비어있음" };
        }
        const r = await updateAdsetBudget(token, recommendation.metaAdsetId, recommendation.recommendedBudget);
        await logManualAction(recommendation.metaAdsetId, "budget_change", "mads", {
          from: recommendation.currentBudget, to: recommendation.recommendedBudget,
        });
        return { ok: true, result: r };
      }
      case "pause": {
        const r = await pauseAdset(token, recommendation.metaAdsetId);
        await logManualAction(recommendation.metaAdsetId, "pause", "mads", {});
        return { ok: true, result: r };
      }
      case "duplicate": {
        const r = await duplicateAdset(token, recommendation.metaAdsetId);
        await logManualAction(recommendation.metaAdsetId, "duplicate", "mads", {});
        return { ok: true, result: r };
      }
      case "creative_refresh":
      case "hold":
      default:
        return { ok: false, error: `${recommendation.actionType}은 자동 적용 미지원 (수동 처리 필요)` };
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
