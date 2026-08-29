/**
 * 리뷰요청 성과 — 대시보드 리뷰 섹션이 쓰는 집계.
 * 요청 → 도달 → 열람 → 작성 퍼널과 실패 사유를 한 번에 준다.
 */
import { type NextRequest } from "next/server";
import { reviewMetrics } from "@/lib/reviews/metrics";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const days = Math.min(90, Math.max(7, Number(req.nextUrl.searchParams.get("days")) || 30));
  try {
    const m = await reviewMetrics(days);
    if (!m) return Response.json({ ok: false, error: "KV 미설정" }, { status: 500 });
    return Response.json({ ok: true, ...m });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
