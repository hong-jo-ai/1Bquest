import { type NextRequest } from "next/server";

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID ?? "";
const REDIRECT_URI  = process.env.GOOGLE_REDIRECT_URI ?? "";

export async function GET(req: NextRequest) {
  // ?hint=email — Google 동의화면에서 그 계정 우선 선택 (없으면 평소대로 계정 선택 화면)
  const hint = req.nextUrl.searchParams.get("hint") ?? "";

  const params = new URLSearchParams({
    client_id:     CLIENT_ID,
    redirect_uri:  REDIRECT_URI,
    response_type: "code",
    scope: [
      "https://www.googleapis.com/auth/analytics.readonly",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/spreadsheets.readonly",
      "https://www.googleapis.com/auth/calendar.readonly",
      "openid",
      "email",
    ].join(" "),
    access_type:   "offline",
    prompt:        "consent",
    state:         "paulvice_ga",
  });
  if (hint) params.set("login_hint", hint);

  return Response.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params}`
  );
}
