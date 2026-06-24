import { type NextRequest } from "next/server";
import { reviewsDb, type MallId } from "@/lib/reviews/core";
import { payPendingRewards } from "@/lib/reviews/reward";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// 관리자 전용(게이트 보호). 우리 시스템 리뷰의 적립금 보상 지급.

/** 보상 현황 카운트. */
export async function GET(req: NextRequest) {
  const mall = (req.nextUrl.searchParams.get("mall") || "harriot_kr") as MallId;
  const sb = reviewsDb();
  const { data } = await sb.from("reviews").select("reward_status").eq("mall", mall);
  const counts: Record<string, number> = { pending: 0, paid: 0, skipped: 0, failed: 0 };
  for (const r of data || []) counts[r.reward_status as string] = (counts[r.reward_status as string] || 0) + 1;
  return Response.json({ ok: true, mall, counts });
}

/** 적립금 지급 실행. { mall, limit? } */
export async function POST(req: NextRequest) {
  let body: { mall?: string; limit?: number };
  try { body = await req.json(); } catch { return Response.json({ error: "bad json" }, { status: 400 }); }
  const mall = (body.mall || "harriot_kr") as MallId;
  try {
    const result = await payPendingRewards(mall, Math.min(200, Math.max(1, body.limit || 50)));
    return Response.json({ ok: true, ...result });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
