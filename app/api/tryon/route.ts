/**
 * 착용해보기(Try It On) 위젯 데이터 (공개 읽기).
 * kv `tryon:<mall>` = { "<product_no>": ["착용이미지url", ...] } 에서 상품별 착용 이미지 반환.
 * 스토어프론트 위젯 JS 가 cross-origin fetch → CORS 허용.
 *   GET /api/tryon?product_no=196&mall=paulvice
 */
import { type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "public, max-age=120, s-maxage=600, stale-while-revalidate=1200",
};

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const productNo = String(sp.get("product_no") || "");
  const mall = sp.get("mall") === "harriot" ? "harriot" : "paulvice";
  if (!productNo) {
    return Response.json({ ok: false, error: "product_no required", images: [] }, { status: 400, headers: CORS });
  }
  const url = process.env.SUPABASE_URL, skey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !skey) return Response.json({ ok: false, images: [] }, { status: 200, headers: CORS });
  const db = createClient(url, skey);
  const { data } = await db.from("kv_store").select("data").eq("key", `tryon:${mall}`).maybeSingle();
  const map = (data?.data ?? {}) as Record<string, unknown>;
  const entry = map[productNo];
  // 객체형 {caseW, caseH, case, images} 또는 (레거시) 이미지 배열 지원
  let caseW = 0, caseH = 0, caseMm = 0; let images: string[] = [];
  if (Array.isArray(entry)) {
    images = entry.filter((u): u is string => typeof u === "string" && !!u);
  } else if (entry && typeof entry === "object") {
    const e = entry as { caseW?: number; caseH?: number; case?: number; images?: string[] };
    caseW = Number(e.caseW) || 0;
    caseH = Number(e.caseH) || 0;
    caseMm = Number(e.case) || 0;
    // 원형만 설정된 경우 가로=세로로 채움
    if (!caseW && caseMm) caseW = caseMm;
    if (!caseH && caseMm) caseH = caseMm;
    images = Array.isArray(e.images) ? e.images.filter((u): u is string => typeof u === "string" && !!u) : [];
  }
  return Response.json({ ok: true, product_no: productNo, caseW, caseH, images }, { status: 200, headers: CORS });
}
