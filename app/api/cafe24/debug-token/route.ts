/**
 * Cafe24 토큰 진단 — 현재 발급받은 access_token 의 scope 확인.
 */
import { createClient } from "@supabase/supabase-js";
import { doRefresh } from "@/lib/cafe24Client";

export const dynamic = "force-dynamic";

export async function GET() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return Response.json({ ok: false, error: "Supabase 미설정" }, { status: 500 });
  const db = createClient(url, key);

  const { data } = await db.from("kv_store").select("data").eq("key", "cafe24_refresh_token").maybeSingle();
  const stored = data?.data ?? null;

  if (!stored) return Response.json({ ok: false, error: "토큰 없음 — Cafe24 미연결" });

  const refreshToken = typeof stored === "string" ? stored : (stored as { refresh_token?: string }).refresh_token;
  if (!refreshToken) return Response.json({ ok: false, error: "refresh_token 없음" });

  try {
    // 강제 refresh 해서 새 토큰 + scope 확인
    const tr = await doRefresh(refreshToken);
    return Response.json({
      ok:           true,
      scope:        tr.scope,                              // 실제 부여된 scope
      hasWrite:     /mall\.write_product/.test(tr.scope),
      hasWriteCat:  /mall\.write_category/.test(tr.scope),
      mall_id:      tr.mall_id,
      shop_no:      tr.shop_no,
      expires_in:   tr.expires_in,
    });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
