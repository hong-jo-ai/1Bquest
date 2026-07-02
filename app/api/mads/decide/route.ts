/**
 * 추천 의사결정 처리 — 로직은 lib/mads/decide.ts 공용(텔레그램 확인카드와 공유).
 *
 *   POST { recommendationId, decision: 'accept' | 'reject' | 'ignore', note? }
 */
import { decideRecommendation, type Decision } from "@/lib/mads/decide";

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
    return Response.json({ ok: false, error: "recommendationId, decision 필수" }, { status: 400 });
  }
  if (!["accept", "reject", "ignore"].includes(decision)) {
    return Response.json({ ok: false, error: "decision은 accept|reject|ignore 중 하나" }, { status: 400 });
  }
  const res = await decideRecommendation(recommendationId, decision as Decision, note);
  return Response.json({ ok: res.ok, error: res.error, applied: res.applied }, { status: res.status });
}
