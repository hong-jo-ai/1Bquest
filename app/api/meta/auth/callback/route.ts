import { exchangeMetaCode, getLongLivedToken } from "@/lib/metaClient";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  const code  = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");
  const errorDesc = req.nextUrl.searchParams.get("error_description");

  if (error || !code) {
    const msg = encodeURIComponent(errorDesc ?? error ?? "no_code");
    redirect(`/ads?error=${msg}`);
  }

  // ── 1. 단기 토큰 교환 ──────────────────────────────────────────────
  let shortAccessToken: string;
  try {
    const shortToken = await exchangeMetaCode(code!);
    shortAccessToken = shortToken.access_token;
  } catch (e: any) {
    const msg = encodeURIComponent(`코드 교환 실패: ${e.message}`);
    redirect(`/ads?error=${msg}`);
  }

  // ── 2. 장기 토큰 업그레이드 (60일) ────────────────────────────────
  let finalToken: string;
  try {
    const longToken = await getLongLivedToken(shortAccessToken!);
    finalToken = longToken.access_token;
  } catch (e: any) {
    // 장기 토큰 교환 실패 시 단기 토큰이라도 사용
    console.warn("[Meta OAuth] 장기 토큰 교환 실패, 단기 토큰 사용:", e.message);
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

  redirect("/ads");
}
