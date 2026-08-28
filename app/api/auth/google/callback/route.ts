import { type NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { saveGoogleRefreshToken } from "@/lib/googleTokenStore";
import { saveKakaoGiftGmailRefreshToken } from "@/lib/finance/kakaoGiftGmailToken";
import {
  signSession,
  isEmailAllowed,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SEC,
} from "@/lib/appAuth";

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";
import { redirectUriFor } from "@/lib/authRedirect";

export async function GET(req: NextRequest) {
  const code  = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");
  const state = req.nextUrl.searchParams.get("state") ?? "";

  // ── 분기: app_login (앱 자체 로그인) ───────────────────────────────────
  if (state.startsWith("app_login")) {
    if (error || !code) {
      return NextResponse.redirect(
        new URL(`/login?error=oauth_failed`, req.url),
      );
    }
    try {
      // 1. 코드 → 토큰
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          redirect_uri: redirectUriFor(req),
          grant_type: "authorization_code",
        }),
      });
      if (!tokenRes.ok) throw new Error(await tokenRes.text());
      const tokenJson = (await tokenRes.json()) as { access_token: string };

      // 2. userinfo 로 이메일 확인
      const userRes = await fetch(
        "https://www.googleapis.com/oauth2/v3/userinfo",
        { headers: { Authorization: `Bearer ${tokenJson.access_token}` } },
      );
      if (!userRes.ok) throw new Error("userinfo fetch failed");
      const user = (await userRes.json()) as {
        email?: string;
        email_verified?: boolean;
      };

      if (!user.email || !user.email_verified || !isEmailAllowed(user.email)) {
        return NextResponse.redirect(
          new URL(`/login?error=unauthorized`, req.url),
        );
      }

      // 3. 세션 토큰 발급 + 쿠키
      const secret = process.env.APP_AUTH_SECRET;
      if (!secret) throw new Error("APP_AUTH_SECRET 미설정");
      const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SEC;
      const sessionToken = await signSession({ email: user.email, exp }, secret);

      // 4. 원래 가려던 경로로 리다이렉트
      const nextRaw = state.slice("app_login:".length);
      const nextPath = decodeURIComponent(nextRaw || "/") || "/";
      const safeNext = nextPath.startsWith("/") ? nextPath : "/";

      const response = NextResponse.redirect(new URL(safeNext, req.url));
      response.cookies.set(SESSION_COOKIE, sessionToken, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        maxAge: SESSION_MAX_AGE_SEC,
        path: "/",
      });
      return response;
    } catch (e) {
      console.error("[app_login] callback error:", e);
      return NextResponse.redirect(
        new URL(`/login?error=oauth_failed`, req.url),
      );
    }
  }

  // ── 분기: 기존 (Gmail/Calendar/Analytics 토큰 + kakao_gift_gmail) ───
  const isKakaoGift = state === "kakao_gift_gmail";
  const successPath = isKakaoGift ? "/?kakao_gift_gmail=connected" : "/analytics";
  const errorPath   = isKakaoGift ? "/?kakao_gift_gmail_error=" : "/analytics?error=";

  if (error || !code) {
    redirect(`${errorPath}${encodeURIComponent(error ?? "cancelled")}`);
  }

  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri:  redirectUriFor(req),
        grant_type:    "authorization_code",
      }),
    });

    if (!res.ok) throw new Error(await res.text());
    const json = await res.json() as {
      access_token:  string;
      refresh_token?: string;
      expires_in:    number;
    };

    if (isKakaoGift) {
      // 카카오선물하기 발주서 전용 — 별도 kv 키에 저장. shong@ 토큰 안 건드림.
      if (json.refresh_token) {
        await saveKakaoGiftGmailRefreshToken(json.refresh_token).catch((e) =>
          console.error("[kakao-gift-gmail] token save failed:", e),
        );
      }
      redirect(successPath);
      return;
    }

    // 일반 (analytics / calendar / inbox 분류용 shong@ 토큰)
    const cookieStore = await cookies();
    cookieStore.set("ga_at", json.access_token, {
      httpOnly: true,
      secure: true,
      maxAge: json.expires_in,
      path: "/",
      sameSite: "lax",
    });
    if (json.refresh_token) {
      cookieStore.set("ga_rt", json.refresh_token, {
        httpOnly: true,
        secure: true,
        maxAge: 60 * 60 * 24 * 60,
        path: "/",
        sameSite: "lax",
      });
      await saveGoogleRefreshToken(json.refresh_token).catch((e) =>
        console.error("[Google OAuth] token store failed:", e)
      );
    }

    redirect(successPath);
  } catch (e: unknown) {
    if (e instanceof Error && e.message === "NEXT_REDIRECT") throw e;
    console.error("[Google OAuth] callback error:", e);
    redirect(`${errorPath}${encodeURIComponent(e instanceof Error ? e.message : String(e))}`);
  }
}
