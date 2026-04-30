/**
 * 카카오선물하기 발주서 전용 Gmail OAuth 시작.
 * plvekorea@gmail.com 으로 로그인하면 별도 kv 키에 토큰 저장됨 (shong@ 토큰 안 건드림).
 *
 * 콜백은 기존 /api/auth/google/callback 재사용. state 로 분기.
 */
import { type NextRequest } from "next/server";

const CLIENT_ID    = process.env.GOOGLE_CLIENT_ID ?? "";
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI ?? "";

export async function GET(_req: NextRequest) {
  const params = new URLSearchParams({
    client_id:     CLIENT_ID,
    redirect_uri:  REDIRECT_URI,
    response_type: "code",
    scope: [
      "https://www.googleapis.com/auth/gmail.modify", // 카카오 PO 메일 + 라벨 마킹
      "openid",
      "email",
    ].join(" "),
    access_type:   "offline",
    prompt:        "consent",
    state:         "kakao_gift_gmail",
    login_hint:    "plvekorea@gmail.com",
  });

  return Response.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
  );
}
