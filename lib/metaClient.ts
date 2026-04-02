const APP_ID       = (process.env.META_APP_ID       ?? "").trim();
const APP_SECRET   = (process.env.META_APP_SECRET   ?? "").trim();
const REDIRECT_URI = (process.env.META_REDIRECT_URI ?? "").trim();
const API_VERSION  = "v22.0";

export const META_BASE = `https://graph.facebook.com/${API_VERSION}`;

// ── OAuth ──────────────────────────────────────────────────────────────────

export function getMetaAuthUrl(): string {
  const params = new URLSearchParams({
    client_id:     APP_ID,
    redirect_uri:  REDIRECT_URI,
    scope:         "ads_read,read_insights",
    response_type: "code",
    state:         "paulvice_meta",
  });
  return `https://www.facebook.com/dialog/oauth?${params}`;
}

export async function exchangeMetaCode(code: string) {
  const params = new URLSearchParams({
    client_id:     APP_ID,
    redirect_uri:  REDIRECT_URI,
    client_secret: APP_SECRET,
    code,
  });
  const res = await fetch(`${META_BASE}/oauth/access_token?${params}`);
  if (!res.ok) throw new Error(`코드 교환 실패: ${await res.text()}`);
  return res.json() as Promise<{ access_token: string; token_type: string }>;
}

// 단기 토큰 → 장기 토큰 (60일)
export async function getLongLivedToken(shortToken: string) {
  const params = new URLSearchParams({
    grant_type:        "fb_exchange_token",
    client_id:         APP_ID,
    client_secret:     APP_SECRET,
    fb_exchange_token: shortToken,
  });
  const res = await fetch(`${META_BASE}/oauth/access_token?${params}`);
  if (!res.ok) throw new Error(`장기 토큰 교환 실패: ${await res.text()}`);
  return res.json() as Promise<{ access_token: string; expires_in: number }>;
}

// ── API 호출 ───────────────────────────────────────────────────────────────

export async function metaGet(
  path: string,
  token: string,
  params: Record<string, string> = {}
) {
  const qs = new URLSearchParams({ access_token: token, ...params });
  const res = await fetch(`${META_BASE}${path}?${qs}`, { cache: "no-store" });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Meta API [${res.status}]: ${body}`);
  }
  return res.json();
}

// 장기 토큰 연장 (60일 리셋)
export async function extendMetaToken(currentToken: string) {
  const params = new URLSearchParams({
    grant_type:        "fb_exchange_token",
    client_id:         APP_ID,
    client_secret:     APP_SECRET,
    fb_exchange_token: currentToken,
  });
  const res = await fetch(`${META_BASE}/oauth/access_token?${params}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`토큰 연장 실패: ${await res.text()}`);
  return res.json() as Promise<{ access_token: string; expires_in: number }>;
}
