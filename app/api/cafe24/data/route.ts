import { getDashboardData } from "@/lib/cafe24Data";
import { doRefresh } from "@/lib/cafe24Client";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function GET() {
  const cookieStore = await cookies();
  let accessToken = cookieStore.get("c24_at")?.value;
  const refreshToken = cookieStore.get("c24_rt")?.value;

  // Access token 만료 → Refresh token으로 갱신
  if (!accessToken && refreshToken) {
    try {
      const newToken = await doRefresh(refreshToken);
      accessToken = newToken.access_token;
      cookieStore.set("c24_at", newToken.access_token, {
        httpOnly: true,
        secure: true,
        maxAge: newToken.expires_in ?? 7200,
        path: "/",
        sameSite: "lax",
      });
      cookieStore.set("c24_rt", newToken.refresh_token, {
        httpOnly: true,
        secure: true,
        maxAge: 60 * 60 * 24 * 14,
        path: "/",
        sameSite: "lax",
      });
    } catch {
      return NextResponse.json({ error: "refresh_failed" }, { status: 401 });
    }
  }

  if (!accessToken) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  try {
    const data = await getDashboardData(accessToken);
    return NextResponse.json(data);
  } catch (e: any) {
    console.error("[Cafe24] data fetch error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
