/**
 * 추천 의사결정 공용 로직 — /api/mads/decide(대시보드)와 텔레그램 확인카드(웹훅)가 공유.
 * (감사 조치: 추천이 매일 생성→미결정 소멸되던 병목을 텔레그램 1탭 승인으로 해소)
 */
import { applyRecommendationAction } from "./orchestrator";
import { insertDecisionLog, listRecommendations, setRecommendationStatus } from "./dbStore";
import { getManualActionCount24h } from "./wobbleDetector";
import type { Recommendation } from "./types";

export type Decision = "accept" | "reject" | "ignore";

export interface DecideResult {
  ok: boolean;
  status: number;          // HTTP 응답용
  error?: string;
  applied?: unknown;
  summary?: string;        // 텔레그램 회신용 한 줄
}

export async function decideRecommendation(
  recommendationId: string,
  decision: Decision,
  note?: string,
): Promise<DecideResult> {
  const all = await listRecommendations(undefined, 500);
  const rec = all.find((r) => r.id === recommendationId);
  if (!rec) return { ok: false, status: 404, error: "추천 없음" };
  if (rec.status !== "pending") return { ok: false, status: 409, error: `이미 처리됨 (${rec.status})` };

  const manualCount24h = await getManualActionCount24h(rec.metaAdsetId);
  await insertDecisionLog(recommendationId, decision, manualCount24h, note);

  if (decision === "accept") {
    if (!rec.adset || !rec.trust) {
      return { ok: false, status: 500, error: "광고세트/신뢰등급 데이터 없음" };
    }
    const recForApply: Recommendation & { metaAdsetId: string } = {
      metaAdsetId:       rec.metaAdsetId,
      actionType:        rec.actionType,
      currentBudget:     rec.currentBudget,
      recommendedBudget: rec.recommendedBudget,
      deltaPct:          rec.deltaPct,
      reason:            rec.reason,
      warnings:          rec.warnings,
      trust: {
        level:              rec.trust.level,
        conversions7d:      rec.trust.conversions7d,
        spend7d:            rec.trust.spend7d,
        revenue7d:          0,
        roas7d:             rec.trust.roas7d,
        roas3d:             0,
        adjustedRoas7d:     rec.trust.adjustedRoas7d,
        largestOrderShare:  0,
        prevRoas7d:         null,
        reason:             "",
      },
    };
    const apply = await applyRecommendationAction(recForApply);
    await setRecommendationStatus(recommendationId, "accepted", apply);
    const budgetTxt = rec.currentBudget && rec.recommendedBudget
      ? ` (${Math.round(rec.currentBudget).toLocaleString()}→${Math.round(rec.recommendedBudget).toLocaleString()}원)`
      : "";
    return {
      ok: apply.ok, status: apply.ok ? 200 : 500, applied: apply,
      summary: apply.ok ? `${rec.actionType}${budgetTxt} 적용 완료` : `Meta 적용 실패`,
      error: apply.ok ? undefined : "Meta 적용 실패",
    };
  }

  await setRecommendationStatus(recommendationId, decision === "reject" ? "rejected" : "ignored");
  return { ok: true, status: 200, summary: decision === "reject" ? "거절 처리" : "보류 처리" };
}
