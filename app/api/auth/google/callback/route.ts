import { type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { saveGoogleRefreshToken } from "@/lib/googleTokenStore";

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";
const REDIRECT_URI  = process.env.GOOGLE_REDIRECT_URI ?? "";

export async function GET(req: NextRequest) {
  const code  = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");

  if (error || !code) {
    redirect(`/analytics?error=${encodeURIComponent(error ?? "cancelled")}`);
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
      // Supabase에 저장 (Cron에서 Gmail 발송용)
      await saveGoogleRefreshToken(json.refresh_token).catch((e) =>
        console.error("[Google OAuth] token store failed:", e)
      );
    }

    redirect("/analytics");
  } catch (e: any) {
    // redirect()는 내부적으로 에러를 throw하므로, 실제 에러만 여기에 도달
    if (e.message === "NEXT_REDIRECT") throw e;
    console.error("[Google OAuth] callback error:", e);
    redirect(`/analytics?error=${encodeURIComponent(e.message)}`);
  }
}
