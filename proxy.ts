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
  "/.well-known/",     // OAuth 디스커버리 등 — /login 리다이렉트 금지(404 반환). claude.ai 커넥터가 로그인서비스로 오인해 OAuth 등록 시도하던 문제 해소
  "/api/marketplace/", // 로컬 마켓플레이스 에이전트 (x-agent-token = PAULWISE_MCP_TOKEN)
  "/api/threads/webhook/", // Threads webhook
  "/api/cs/ingest/",   // CS 인박스 외부 ingestion
  "/api/cs/webchat/",  // PAULVICE 웹사이트 자체 상담 위젯 (익명 고객 접근)
  "/api/finance/card-sms", // 우리카드 SMS 자동수집 에이전트 (x-agent-token = PAULWISE_MCP_TOKEN)
  "/api/finance/enrich-npay", // 네이버페이 메일 카드내역 보강 에이전트 (x-agent-token / CRON_SECRET)
  "/api/cs/notify",    // CS 알림 cron (텔레그램/이메일/stale) — CRON_SECRET 헤더로 인증
  "/api/alba/",        // 알바 출퇴근 질문/급여명세서 cron — CRON_SECRET 헤더로 인증
  "/api/parking/",     // 주차할인 등록 요청 폴링 (x-agent-token = PAULWISE_MCP_TOKEN)
  "/api/mads/targeting", // 광고세트 타겟팅 조회 — 읽기 전용 (x-agent-token = PAULWISE_MCP_TOKEN)
  "/api/cs/webhook/",  // CS 실시간 webhook (Crisp / Instagram DM)
  "/api/instagram/webhook", // Meta Instagram webhook (검증 + 이벤트)
  "/api/cafe24/",      // Cafe24 webhook
  "/api/meta/webhook", // Meta webhook
  "/review/",          // 고객 리뷰 작성 페이지 (토큰링크, 익명 접근)
  "/r/",               // 리뷰 짧은 링크 (/r/<code> → 리뷰 작성, 익명 접근)
  "/c/",               // 캠페인 짧은 링크 (/c/<code> → 클릭기록 후 상품페이지 리다이렉트, 익명)
  "/care",             // PAULVICE CARE 구매자 케어 등록 (동봉 카드 QR → 고객 직접 접근)
  "/api/care/",        // CARE 등록 API (본인확인·제품목록·등록, 익명 공개)
  "/moon",             // 해리엇 '그날의 달' 공개 인터랙티브 페이지
  "/api/reviews/submit",  // 리뷰 제출 (익명, 토큰검증)
  "/api/reviews/upload",  // 리뷰 미디어 업로드 (익명, 토큰검증) — /upload-url 도 이 프리픽스로 커버
  "/api/reviews/widget",  // 스토어프론트 리뷰 위젯 데이터 (공개 읽기, CORS)
  "/api/reviews/counts",  // 상품별 리뷰수 맵 (watchshop 타일 등, 공개 읽기, CORS)
  "/pv-reviews.js",       // 스토어프론트 리뷰 위젯 스크립트 (공개 정적파일)
  "/api/tryon",           // 착용해보기 위젯 데이터 (공개 읽기, CORS)
  "/pv-tryon.js",         // 착용해보기 위젯 스크립트 (공개 정적파일)
  "/api/crm/cart-event",  // 장바구니 담기 이벤트 수집 (자사몰 스크립트, 교차출처 CORS)
  "/pv-cart.js",          // 장바구니 이탈 추적 스크립트 (공개 정적파일)
  "/pv-hesitate.js",      // 망설임 팝업 스크립트 (공개 정적파일)
  "/api/storefront/",     // 스토어프론트 팝업 설정·이벤트 (익명 공개, 교차출처 CORS)
  "/api/harriot/waitlist", // 설월 출시 대기명단 수집 (인트로 페이지, 익명 · 교차출처 CORS)
  "/api/app-icons/",   // 홈화면/PWA 아이콘은 로그인 전에도 브라우저가 가져갈 수 있어야 함
  "/_next/",
  "/manifest-",
  "/manifest.webmanifest",
  "/manifest.json",
];

function isAllowed(pathname: string): boolean {
  return ALLOW_PREFIX.some((p) => pathname.startsWith(p));
}

// 아침 업무 보드 전용 도메인 — 루트 접속을 /today 로 재작성 (폰 홈화면에서 한 번에 열려고)
const TODAY_HOSTS = new Set([
  "today.harriotwatches.com",
]);

// 해리엇 '그날의 달' 전용 도메인 — 루트 접속을 /moon 으로 재작성 (고객에게 대시보드 로그인 노출 방지)
const MOON_HOSTS = new Set([
  "harriot-moon.vercel.app",
  "moon.harriotwatches.com",
  "moon.harriotwatches.co.kr",
]);

// PAULVICE CARE 전용 도메인 — 동봉 카드 QR 이 가리키는 주소.
// 인쇄물에 vercel.app 이 박히면 브랜드가 깨지고, 한 번 찍으면 되돌릴 수 없다.
const CARE_HOSTS = new Set([
  "care.paulvice.co.kr",
]);

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const host = (req.headers.get("host") ?? "").toLowerCase();
  if (MOON_HOSTS.has(host) && pathname === "/") {
    const url = req.nextUrl.clone();
    url.pathname = "/moon";
    return NextResponse.rewrite(url);
  }
  // care.paulvice.co.kr/ → /care (쿼리스트링 ?s=card 는 그대로 유지된다)
  if (CARE_HOSTS.has(host) && pathname === "/") {
    const url = req.nextUrl.clone();
    url.pathname = "/care";
    return NextResponse.rewrite(url);
  }
  // 업무 화면이라 인증을 반드시 태운다. moon 처럼 여기서 바로 rewrite 를 반환하면
  // 아래 로그인 검사를 통째로 건너뛰어 보드가 무인증으로 공개된다(실측 사고 2026-08-28).
  // 그래서 목적지만 기억해두고, 인증을 통과한 뒤 맨 아래에서 rewrite 한다.
  const rewriteToToday = TODAY_HOSTS.has(host) && pathname === "/";

  // ── (1) 앱 자체 로그인 검증 ────────────────────────────────────────
  const authBypass = isAllowed(rewriteToToday ? "/today" : pathname);
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
      loginUrl.search = `?next=${encodeURIComponent((rewriteToToday ? "/today" : pathname) + req.nextUrl.search)}`;
      return NextResponse.redirect(loginUrl);
    }
  }

  // (구) Cafe24 쿠키 기반 토큰 자동갱신 블록 제거 — refresh_token 회전과 SSOT(cafe24TokenStore)가
  // 경쟁해 토큰 소실 사고를 낸 원인 코드 (2026-07-02 감사 조치). 토큰 갱신은 cafe24TokenStore 단일 경로.

  if (rewriteToToday) {
    const url = req.nextUrl.clone();
    url.pathname = "/today";
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // 정적 파일 + Next 내부 자원 제외
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)).*)",
  ],
};
