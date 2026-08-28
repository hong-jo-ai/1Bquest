/**
 * OAuth 콜백 주소를 요청 호스트에 맞춰 고른다.
 *
 * 예전에는 GOOGLE_REDIRECT_URI 고정값(paulvice-dashboard.vercel.app)만 썼다.
 * 그러면 어느 주소에서 로그인을 시작하든 콜백이 그 호스트로 떨어지고,
 * 세션 쿠키가 domain 없이(호스트 전용) 발급되므로 today.harriotwatches.com 에서는
 * 로그인 상태가 될 수 없었다 — 저장이 조용히 실패하던 실제 원인이다.
 *
 * 호스트를 그대로 신뢰하면 Host 헤더 위조로 인가 코드가 엉뚱한 데로 갈 수 있으므로
 * 허용 목록에 있는 호스트만 받는다. 목록에 없으면 기존 고정값으로 떨어진다.
 *
 * ⚠️ 여기에 호스트를 추가하면 Google Cloud Console 의 승인된 리디렉션 URI 에도
 *    같은 주소를 등록해야 한다. 안 하면 redirect_uri_mismatch 로 로그인이 막힌다.
 */
const ALLOWED_HOSTS = new Set([
  "today.harriotwatches.com",
  "dashboard.harriotwatches.com",
  "paulvice-dashboard.vercel.app",
]);

export const CALLBACK_PATH = "/api/auth/google/callback";

export function redirectUriFor(req: Request): string {
  const fallback = process.env.GOOGLE_REDIRECT_URI ?? "";
  try {
    const host = (req.headers.get("host") ?? "").toLowerCase();
    if (ALLOWED_HOSTS.has(host)) return `https://${host}${CALLBACK_PATH}`;
  } catch { /* 헤더가 이상하면 고정값으로 */ }
  return fallback;
}
