/**
 * 앱 게이트키퍼 — paulwise_session 쿠키가 유효해야 통과.
 * 미인증이면 /login 으로 리다이렉트하면서 원래 가려던 경로를 ?next= 로 보존.
 *
 * 외부 통합 (Telegram webhook, MCP, Cron, OAuth 콜백 등)은 자체 토큰 인증을
 * 가지고 있으므로 ALLOW_PREFIX 로 우회.
 */
import { NextResponse, type NextRequest } from "next/server";
import { verifySession, SESSION_COOKIE } from "@/lib/appAuth";

// 세션 검증 없이 통과시킬 경로 prefix (자체 토큰 또는 익명 접근 필요)
const ALLOW_PREFIX = [
  "/login",
  "/api/auth/",        // 모든 OAuth 흐름 (sign-in, callback, share-token, kakao 등)
  "/api/cron/",        // Vercel cron (CRON_SECRET 헤더로 인증)
  "/api/telegram/",    // Telegram webhook (secret_token 헤더)
  "/api/mcp",          // MCP server (PAULWISE_MCP_TOKEN)
  "/api/threads/webhook/", // Threads webhook
  "/api/cs/ingest/",   // CS 인박스 외부 ingestion
  "/api/cafe24/",      // Cafe24 webhook
  "/api/meta/webhook", // Meta webhook
  "/_next/",
];

function isAllowed(pathname: string): boolean {
  return ALLOW_PREFIX.some((p) => pathname.startsWith(p));
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isAllowed(pathname)) return NextResponse.next();

  const secret = process.env.APP_AUTH_SECRET;
  // env 미설정이면 보호 비활성화 (배포 직후 일시적 통과 — env 추가하면 즉시 활성)
  if (!secret) return NextResponse.next();

  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  if (cookie) {
    const session = await verifySession(cookie, secret);
    if (session) return NextResponse.next();
  }

  // 미인증 → 로그인 페이지로 리다이렉트, 원래 경로 보존
  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = `?next=${encodeURIComponent(pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // 정적 파일 + Next 내부 자원은 매처에서 제외
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)).*)",
  ],
};
