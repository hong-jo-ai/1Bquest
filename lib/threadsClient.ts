/**
 * Threads API 클라이언트
 * Threads는 Facebook Graph API와 별도의 OAuth 흐름 사용
 * Base: https://graph.threads.net
 */

const APP_ID       = (process.env.META_APP_ID         ?? "").trim();
const APP_SECRET   = (process.env.META_APP_SECRET     ?? "").trim();
const THREADS_REDIRECT = (process.env.THREADS_REDIRECT_URI ?? "").trim();

const THREADS_BASE = "https://graph.threads.net";

export function getThreadsAuthUrl(): string {
  const params = new URLSearchParams({
    client_id:     APP_ID,
    redirect_uri:  THREADS_REDIRECT,
    scope:         "threads_basic,threads_content_publish",
    response_type: "code",
    state:         "paulvice_threads",
  });
  return `https://threads.net/oauth/authorize?${params}`;
}

export async function exchangeThreadsCode(code: string) {
  const res = await fetch(`${THREADS_BASE}/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     APP_ID,
      client_secret: APP_SECRET,
      grant_type:    "authorization_code",
      redirect_uri:  THREADS_REDIRECT,
      code,
    }),
  });
  if (!res.ok) throw new Error(`Threads 코드 교환 실패: ${await res.text()}`);
  return res.json() as Promise<{ access_token: string; user_id: string }>;
}

export async function getLongLivedThreadsToken(shortToken: string) {
  const params = new URLSearchParams({
    grant_type:    "th_exchange_token",
    client_secret: APP_SECRET,
    access_token:  shortToken,
  });
  const res = await fetch(`${THREADS_BASE}/access_token?${params}`);
  if (!res.ok) throw new Error(`Threads 장기 토큰 교환 실패: ${await res.text()}`);
  return res.json() as Promise<{ access_token: string; expires_in: number }>;
}
