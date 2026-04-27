/**
 * 추천 의사결정 처리.
 *
 *   POST { recommendationId, decision: 'accept' | 'reject' | 'ignore', note? }
 *
 *   - accept: Meta API에 실제 적용 + 의사결정 로그 + 추천 status='accepted'
 *   - reject: 적용 안 함 + 의사결정 로그 + status='rejected'
 *   - ignore: 적용 안 함 + 로그만 + status='ignored' (시간 부족 등)
 */
import { applyRecommendationAction } from "@/lib/mads/orchestrator";
import {
  insertDecisionLog,
  listRecommendations,
  setRecommendationStatus,
} from "@/lib/mads/dbStore";
import { getManualActionCount24h } from "@/lib/mads/wobbleDetector";
import type { Recommendation } from "@/lib/mads/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  let body: { recommendationId?: string; decision?: string; note?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "잘못된 JSON" }, { status: 400 });
  }

  const { recommendationId, decision, note } = body;
  if (!recommendationId || !decision) {
    return Response.json(
      { ok: false, error: "recommendationId, decision 필수" },
      { status: 400 },
    );
  }
  if (!["accept", "reject", "ignore"].includes(decision)) {
    return Response.json(
      { ok: false, error: "decision은 accept|reject|ignore 중 하나" },
      { status: 400 },
    );
  }

  // 추천 조회 (전체에서 id로 1건 찾기)
  const all = await listRecommendations(undefined, 500);
  const rec = all.find((r) => r.id === recommendationId);
  if (!rec) return Response.json({ ok: false, error: "추천 없음" }, { status: 404 });
  if (rec.status !== "pending") {
    return Response.json(
      { ok: false, error: `이미 처리됨 (${rec.status})` },
      { status: 409 },
    );
  }

  const manualCount24h = await getManualActionCount24h(rec.metaAdsetId);
  await insertDecisionLog(recommendationId, decision, manualCount24h, note);

  if (decision === "accept") {
    if (!rec.adset || !rec.trust) {
      return Response.json(
        { ok: false, error: "광고세트/신뢰등급 데이터 없음" },
        { status: 500 },
      );
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
    return Response.json({ ok: apply.ok, applied: apply });
  }

  await setRecommendationStatus(recommendationId, decision === "reject" ? "rejected" : "ignored");
  return Response.json({ ok: true });
}
