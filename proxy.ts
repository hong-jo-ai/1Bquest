import { NextRequest, NextResponse } from "next/server";

export async function proxy(req: NextRequest) {
  // API / 정적 파일은 통과
  if (req.nextUrl.pathname.startsWith("/api/") || req.nextUrl.pathname.startsWith("/_next/")) {
    return NextResponse.next();
  }

  const accessToken = req.cookies.get("c24_at")?.value;
  const refreshToken = req.cookies.get("c24_rt")?.value;

  // Access token이 없고 Refresh token이 있으면 자동 갱신
  if (!accessToken && refreshToken) {
    const mallId = process.env.CAFE24_MALL_ID;
    const clientId = process.env.CAFE24_CLIENT_ID;
    const clientSecret = process.env.CAFE24_CLIENT_SECRET;

    try {
      const basic = btoa(`${clientId}:${clientSecret}`);
      const res = await fetch(`https://${mallId}.cafe24api.com/api/v2/oauth/token`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        }),
      });

      if (res.ok) {
        const tokens = await res.json();
        const response = NextResponse.next();
        response.cookies.set("c24_at", tokens.access_token, {
          httpOnly: true,
          secure: true,
          maxAge: tokens.expires_in ?? 7200,
          path: "/",
          sameSite: "lax",
        });
        response.cookies.set("c24_rt", tokens.refresh_token, {
          httpOnly: true,
          secure: true,
          maxAge: 60 * 60 * 24 * 14,
          path: "/",
          sameSite: "lax",
        });
        return response;
      }
    } catch {
      // 갱신 실패 시 그냥 통과 (더미 데이터 표시)
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
