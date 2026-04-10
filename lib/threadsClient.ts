/**
 * Threads API 클라이언트
 * 브랜드별 별도 앱 자격증명 지원
 */
import type { BrandId } from "./threadsBrands";

const THREADS_REDIRECT = (process.env.THREADS_REDIRECT_URI ?? "").trim();
const THREADS_BASE = "https://graph.threads.net";

function getAppCredentials(brand: BrandId) {
  switch (brand) {
    case "harriot":
      return {
        appId:     (process.env.THREADS_APP_ID_HARRIOT     ?? "").trim(),
        appSecret: (process.env.THREADS_APP_SECRET_HARRIOT ?? "").trim(),
      };
    case "hongsungjo":
      return {
        appId:     (process.env.THREADS_APP_ID_HONGSUNGJO     ?? "").trim(),
        appSecret: (process.env.THREADS_APP_SECRET_HONGSUNGJO ?? "").trim(),
      };
    default: // paulvice
      return {
        appId:     (process.env.THREADS_APP_ID     ?? "").trim(),
        appSecret: (process.env.THREADS_APP_SECRET ?? "").trim(),
      };
  }
}

export function getThreadsAuthUrl(brand: string = "paulvice"): string {
  const { appId } = getAppCredentials(brand as BrandId);
  const params = new URLSearchParams({
    client_id:     appId,
    redirect_uri:  THREADS_REDIRECT,
    scope:         "threads_basic,threads_content_publish,threads_read_replies,threads_manage_replies",
    response_type: "code",
    state:         brand,
  });
  return `https://threads.net/oauth/authorize?${params}`;
}

export async function exchangeThreadsCode(code: string, brand: BrandId = "paulvice") {
  const { appId, appSecret } = getAppCredentials(brand);
  const res = await fetch(`${THREADS_BASE}/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     appId,
      client_secret: appSecret,
      grant_type:    "authorization_code",
      redirect_uri:  THREADS_REDIRECT,
      code,
    }),
  });
  if (!res.ok) throw new Error(`Threads 코드 교환 실패: ${await res.text()}`);
  return res.json() as Promise<{ access_token: string; user_id: string }>;
}

export async function getLongLivedThreadsToken(shortToken: string, brand: BrandId = "paulvice") {
  const { appSecret } = getAppCredentials(brand);
  const params = new URLSearchParams({
    grant_type:    "th_exchange_token",
    client_secret: appSecret,
    access_token:  shortToken,
  });
  const res = await fetch(`${THREADS_BASE}/access_token?${params}`);
  if (!res.ok) throw new Error(`Threads 장기 토큰 교환 실패: ${await res.text()}`);
  return res.json() as Promise<{ access_token: string; expires_in: number }>;
}
