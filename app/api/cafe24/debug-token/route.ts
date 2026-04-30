/**
 * Cafe24 토큰 진단 — 저장된 토큰의 scope 확인 (refresh 자동 처리, race-safe).
 */
import { createClient } from "@supabase/supabase-js";
import { refreshCafe24Token, getAccessTokenFromStore } from "@/lib/cafe24TokenStore";

export const dynamic = "force-dynamic";

export async function GET() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return Response.json({ ok: false, error: "Supabase 미설정" }, { status: 500 });
  const db = createClient(url, key);

  const { data } = await db.from("kv_store").select("data").eq("key", "cafe24_refresh_token").maybeSingle();
  const stored = data?.data ?? null;

  if (!stored) return Response.json({ ok: false, error: "토큰 없음 — Cafe24 미연결" });

  // 캐시 객체 형태인지 확인
  const isObject = typeof stored === "object" && stored !== null;
  const refreshToken = isObject
    ? (stored as { refresh_token?: string }).refresh_token
    : (typeof stored === "string" ? stored : null);

  if (!refreshToken) return Response.json({ ok: false, error: "refresh_token 없음", stored });

  try {
    // refreshCafe24Token 은 자동으로 새 토큰 저장 (race-safe)
    const tr = await refreshCafe24Token(refreshToken);
    const scope = String(tr.scope ?? "");
    return Response.json({
      ok:               true,
      scopeRaw:         scope,
      scopeArray:       scope.split(/[\s,]+/).filter(Boolean),
      hasWrite:         /mall\.write_product/.test(scope),
      hasWriteCat:      /mall\.write_category/.test(scope),
      mall_id:          tr.mall_id,
      expires_in:       tr.expires_in,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json(
      {
        ok: false,
        error: msg,
        hint: msg.includes("invalid_grant")
          ? "refresh_token 만료/무효 — /api/auth/login 으로 재연결 필요"
          : undefined,
      },
      { status: 500 },
    );
  }
}
