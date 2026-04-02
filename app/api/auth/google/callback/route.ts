import { type NextRequest } from "next/server";
import { cookies } from "next/headers";

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";
const REDIRECT_URI  = process.env.GOOGLE_REDIRECT_URI ?? "";
const APP_URL       = process.env.NEXT_PUBLIC_APP_URL ?? "";

export async function GET(req: NextRequest) {
  const code  = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");

  if (error || !code) {
    return Response.redirect(`${APP_URL}/analytics?error=${encodeURIComponent(error ?? "cancelled")}`);
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

    const cookieStore = await cookies();
    cookieStore.set("ga_at", json.access_token, {
      httpOnly: true,
      secure: true,
      maxAge: json.expires_in,
      path: "/",
    });
    if (json.refresh_token) {
      cookieStore.set("ga_rt", json.refresh_token, {
        httpOnly: true,
        secure: true,
        maxAge: 60 * 60 * 24 * 60,   // 60일
        path: "/",
      });
    }

    return Response.redirect(`${APP_URL}/analytics`);
  } catch (e: any) {
    return Response.redirect(`${APP_URL}/analytics?error=${encodeURIComponent(e.message)}`);
  }
}
