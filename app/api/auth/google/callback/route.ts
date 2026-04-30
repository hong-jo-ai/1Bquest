import { type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { saveGoogleRefreshToken } from "@/lib/googleTokenStore";
import { saveKakaoGiftGmailRefreshToken } from "@/lib/finance/kakaoGiftGmailToken";

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";
const REDIRECT_URI  = process.env.GOOGLE_REDIRECT_URI ?? "";

export async function GET(req: NextRequest) {
  const code  = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");
  const state = req.nextUrl.searchParams.get("state") ?? "";

  // state 별로 redirect 경로 분기
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
        redirect_uri:  REDIRECT_URI,
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
  } catch (e: any) {
    if (e.message === "NEXT_REDIRECT") throw e;
    console.error("[Google OAuth] callback error:", e);
    redirect(`${errorPath}${encodeURIComponent(e.message)}`);
  }
}
