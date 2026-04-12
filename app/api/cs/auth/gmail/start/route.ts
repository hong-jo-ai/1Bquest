import { type NextRequest } from "next/server";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";

/**
 * GET /api/cs/auth/gmail/start?brand=paulvice
 * Google OAuth 동의 화면으로 리다이렉트.
 * state에 브랜드를 담아 콜백에서 구분.
 */
export async function GET(req: NextRequest) {
  const brand = req.nextUrl.searchParams.get("brand") ?? "";
  if (brand !== "paulvice" && brand !== "harriot") {
    return Response.json(
      { error: "brand must be paulvice or harriot" },
      { status: 400 }
    );
  }

  // 콜백 URI는 현재 요청의 origin 기준으로 구성 (로컬/프로덕션 공용)
  const origin = req.nextUrl.origin;
  const redirectUri = `${origin}/api/cs/auth/gmail/callback`;

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: [
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/userinfo.email",
      "openid",
    ].join(" "),
    access_type: "offline",
    prompt: "consent",
    state: `cs_gmail_${brand}`,
    include_granted_scopes: "true",
  });

  return Response.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params}`
  );
}
