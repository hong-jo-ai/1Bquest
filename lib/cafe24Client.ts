const MALL_ID = process.env.CAFE24_MALL_ID!;
const CLIENT_ID = process.env.CAFE24_CLIENT_ID!;
const CLIENT_SECRET = process.env.CAFE24_CLIENT_SECRET!;
const REDIRECT_URI = process.env.CAFE24_REDIRECT_URI!;

export const BASE_URL = `https://${MALL_ID}.cafe24api.com`;
const API_VERSION = "2026-03-01";
const SCOPES = "mall.read_order mall.read_product mall.read_analytics";

// ── OAuth ──────────────────────────────────────────────────────────────────

export function getAuthUrl(): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    state: "paulvice_dashboard",
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
  });
  return `${BASE_URL}/api/v2/oauth/authorize?${params}`;
}

function basicAuth() {
  return "Basic " + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
}

export async function exchangeCode(code: string) {
  const res = await fetch(`${BASE_URL}/api/v2/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: basicAuth(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
    }),
  });
  if (!res.ok) throw new Error(`코드 교환 실패: ${await res.text()}`);
  return res.json() as Promise<TokenResponse>;
}

export async function doRefresh(refreshToken: string) {
  const res = await fetch(`${BASE_URL}/api/v2/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: basicAuth(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) throw new Error(`토큰 갱신 실패: ${await res.text()}`);
  return res.json() as Promise<TokenResponse>;
}

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  token_type: string;
  scope: string;
  mall_id: string;
  shop_no: number;
}

// ── API 호출 ───────────────────────────────────────────────────────────────

export async function cafe24Get(path: string, accessToken: string) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Cafe24-Api-Version": API_VERSION,
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Cafe24 API [${res.status}]: ${body}`);
  }
  return res.json();
}
