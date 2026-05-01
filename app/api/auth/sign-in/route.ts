/**
 * 앱 로그인 시작 — Google OAuth 흐름.
 * 콜백은 기존 /api/auth/google/callback 의 state="app_login:..." 분기에서 처리.
 */
import { type NextRequest } from "next/server";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI ?? "";

export async function GET(req: NextRequest) {
  const next = req.nextUrl.searchParams.get("next") || "/";

  // state 에 next 인코딩하여 콜백에서 복원
  const state = `app_login:${encodeURIComponent(next)}`;

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: "openid email",
    state,
    prompt: "select_account",
  });

  return Response.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
  );
}
