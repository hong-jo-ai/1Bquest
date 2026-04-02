import { type NextRequest } from "next/server";

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID ?? "";
const REDIRECT_URI  = process.env.GOOGLE_REDIRECT_URI ?? "";

export async function GET(_req: NextRequest) {
  const params = new URLSearchParams({
    client_id:     CLIENT_ID,
    redirect_uri:  REDIRECT_URI,
    response_type: "code",
    scope: [
      "https://www.googleapis.com/auth/analytics.readonly",
      "openid",
      "email",
    ].join(" "),
    access_type:   "offline",
    prompt:        "consent",
    state:         "paulvice_ga",
  });

  return Response.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params}`
  );
}
