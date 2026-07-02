/**
 * 상품별 리뷰수 조회 (공개, CORS) — review-counts 크론이 만든 kv 맵 반환.
 * watchshop 타일·기타 리스트 UI가 위젯과 동일 기준 카운트를 싸게 가져가는 용도.
 * GET /api/reviews/counts?mall=paulvice → { ok, counts: { "195": 120, ... }, updatedAt }
 */
import { type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600",
};

export async function GET(req: NextRequest) {
  const mall = req.nextUrl.searchParams.get("mall") === "harriot" ? "harriot" : "paulvice";
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return Response.json({ ok: false, counts: {} }, { headers: CORS });
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { data } = await sb.from("kv_store").select("data,updated_at").eq("key", `review_counts:${mall}`).maybeSingle();
  return Response.json(
    { ok: true, counts: data?.data ?? {}, updatedAt: data?.updated_at ?? null },
    { headers: CORS },
  );
}
