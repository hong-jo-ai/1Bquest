/**
 * Next.js proxy (구 middleware) — 모든 요청에 대해 실행.
 *
 * 두 가지 일을 함:
 *  1) 앱 자체 로그인 게이트키퍼 — paulwise_session 쿠키 검증, 미인증 시 /login 으로 리다이렉트.
 *     ALLOW_PREFIX 의 외부 통합 라우트는 우회.
 *  2) Cafe24 액세스 토큰 자동 갱신 — c24_at 만료 시 c24_rt로 재발급.
 */
import { NextRequest, NextResponse } from "next/server";
import { verifySession, SESSION_COOKIE } from "@/lib/appAuth";

// 앱 자체 로그인 우회 (자체 토큰 인증 또는 익명 접근 필요)
const ALLOW_PREFIX = [
  "/login",
  "/api/auth/",        // 모든 OAuth 흐름 (sign-in, callback, share-token, kakao 등)
  "/api/cron/",        // Vercel cron (CRON_SECRET 헤더로 인증)
  "/api/telegram/",    // Telegram webhook (secret_token 헤더)
  "/api/mcp",          // MCP server (PAULWISE_MCP_TOKEN)
  "/api/marketplace/", // 로컬 마켓플레이스 에이전트 (x-agent-token = PAULWISE_MCP_TOKEN)
  "/api/threads/webhook/", // Threads webhook
  "/api/cs/ingest/",   // CS 인박스 외부 ingestion
  "/api/cs/notify",    // CS 알림 cron (텔레그램/이메일/stale) — CRON_SECRET 헤더로 인증
  "/api/cs/webhook/",  // CS 실시간 webhook (Crisp / Instagram DM)
  "/api/instagram/webhook", // Meta Instagram webhook (검증 + 이벤트)
  "/api/cafe24/",      // Cafe24 webhook
  "/api/meta/webhook", // Meta webhook
  "/_next/",
];

function isAllowed(pathname: string): boolean {
  return ALLOW_PREFIX.some((p) => pathname.startsWith(p));
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ── (1) 앱 자체 로그인 검증 ────────────────────────────────────────
  const authBypass = isAllowed(pathname);
  const secret = process.env.APP_AUTH_SECRET;

  if (!authBypass && secret) {
    const cookie = req.cookies.get(SESSION_COOKIE)?.value;
    let sessionOk = false;
    if (cookie) {
      const session = await verifySession(cookie, secret);
      if (session) sessionOk = true;
    }

    if (!sessionOk) {
      const loginUrl = req.nextUrl.clone();
      loginUrl.pathname = "/login";
      loginUrl.search = `?next=${encodeURIComponent(pathname + req.nextUrl.search)}`;
      return NextResponse.redirect(loginUrl);
    }
  }

  // ── (2) Cafe24 토큰 자동 갱신 ─────────────────────────────────────
  // API / 정적 파일은 토큰 갱신 대상 아님
  if (pathname.startsWith("/api/") || pathname.startsWith("/_next/")) {
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
  matcher: [
    // 정적 파일 + Next 내부 자원 제외
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)).*)",
  ],
};
