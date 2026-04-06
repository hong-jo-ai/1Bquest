import { exchangeMetaCode, getLongLivedToken } from "@/lib/metaClient";
import { saveMetaToken } from "@/lib/metaTokenStore";
import { cookies } from "next/headers";
import { type NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  const code     = req.nextUrl.searchParams.get("code");
  const error    = req.nextUrl.searchParams.get("error");
  const errorDesc = req.nextUrl.searchParams.get("error_description");

  if (error || !code) {
    const msg = encodeURIComponent(errorDesc ?? error ?? "no_code");
    return Response.redirect(new URL(`/ads?error=${msg}`, req.url));
  }

  // ── 1. 단기 토큰 교환 ──────────────────────────────────────────────
  let shortAccessToken: string;
  try {
    const shortToken = await exchangeMetaCode(code!);
    shortAccessToken = shortToken.access_token;
  } catch (e: any) {
    console.error("[Meta callback] 코드 교환 실패:", e.message);
    const msg = encodeURIComponent(`코드 교환 실패: ${e.message}`);
    return Response.redirect(new URL(`/ads?error=${msg}`, req.url));
  }

  // ── 2. 장기 토큰 업그레이드 (60일) ────────────────────────────────
  let finalToken: string;
  try {
    const longToken = await getLongLivedToken(shortAccessToken!);
    finalToken = longToken.access_token;
    console.log("[Meta callback] 장기 토큰 발급 성공, expires_in:", longToken.expires_in);
  } catch (e: any) {
    console.warn("[Meta callback] 장기 토큰 교환 실패, 단기 토큰 사용:", e.message);
    finalToken = shortAccessToken!;
  }

  // ── 3. 쿠키 저장 ──────────────────────────────────────────────────
  const cookieStore = await cookies();
  cookieStore.set("meta_at", finalToken, {
    httpOnly: true,
    secure:   true,
    maxAge:   55 * 24 * 60 * 60,
    path:     "/",
    sameSite: "lax",
  });

  // ── 4. Supabase에 토큰 저장 (Cron용) ─────────────────────────────
  await saveMetaToken(finalToken).catch((e) =>
    console.error("[Meta callback] token store failed:", e)
  );

  // state에서 returnTo 경로 추출
  const state = req.nextUrl.searchParams.get("state") ?? "";
  const returnTo = state.includes("|") ? state.split("|")[1] : "/ads";
  const safePath = returnTo.startsWith("/") ? returnTo : "/ads";
  return Response.redirect(new URL(safePath, req.url));
}
