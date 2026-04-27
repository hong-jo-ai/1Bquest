import { getAccessTokenFromStore } from "./cafe24TokenStore";

const MALL_ID = process.env.CAFE24_MALL_ID!;
const CLIENT_ID = process.env.CAFE24_CLIENT_ID!;
const CLIENT_SECRET = process.env.CAFE24_CLIENT_SECRET!;
const REDIRECT_URI = process.env.CAFE24_REDIRECT_URI!;

export const BASE_URL = `https://${MALL_ID}.cafe24api.com`;
const API_VERSION = "2026-03-01";
const SCOPES = "mall.read_order mall.read_product mall.write_product mall.read_analytics mall.read_community mall.write_community";

/**
 * Cafe24 API fetch + 401 자동 재시도.
 *
 * access token이 만료 직전이거나 다른 인스턴스에서 refresh되어 무효화된 경우
 * 호출자가 들고 있던 토큰으로 401을 받음 → SSOT에서 새 토큰 받아 1회 재시도.
 *
 * 재시도도 실패하면 원본 응답을 그대로 반환 → 호출자가 정상적으로 throw.
 * 재시도가 시도조차 못 된 경우(SSOT에 refresh token도 없음)도 원본 반환.
 */
async function cafe24Fetch(
  path: string,
  accessToken: string,
  init: RequestInit = {}
): Promise<Response> {
  const baseHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Cafe24-Api-Version": API_VERSION,
  };

  const doFetch = (token: string) => fetch(`${BASE_URL}${path}`, {
    cache: "no-store",
    ...init,
    headers: { ...baseHeaders, ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` },
  });

  const res = await doFetch(accessToken);
  if (res.status !== 401) return res;

  // 401 → SSOT에서 새 토큰 받아 재시도
  const newToken = await getAccessTokenFromStore();
  if (!newToken || newToken === accessToken) return res;

  // body 있는 요청은 stream 한 번 소비 후 재시도 시 다시 사용 가능해야 함
  // → init.body가 string이면 안전. 우리는 JSON.stringify된 string만 사용.
  return doFetch(newToken);
}

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
  const res = await cafe24Fetch(path, accessToken);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Cafe24 API [${res.status}]: ${body}`);
  }
  return res.json();
}

export async function cafe24Post(
  path: string,
  accessToken: string,
  body: unknown
) {
  const res = await cafe24Fetch(path, accessToken, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Cafe24 POST [${res.status}]: ${text}`);
  }
  return res.json();
}

// ── 게시판 조회 (CS 인박스용) ──────────────────────────────────

export interface Cafe24Board {
  board_no: number;
  board_name: string;
  board_type: number;
  use_board: "T" | "F";
  use_display?: "T" | "F";
}

export interface Cafe24Article {
  article_no: number;
  parent_article_no?: number | null;
  board_no: number;
  title: string;
  content?: string;
  writer?: string;
  writer_email?: string | null;
  member_id?: string;
  created_date: string;
  // Cafe24 API: 'reply'는 "T"/"F" 플래그 (답글 존재 여부)
  reply?: "T" | "F";
  reply_user_id?: string | null;
  reply_status?: string | null;
  secret?: "T" | "F";
  rating?: number;
  sales_channel?: string | null;
  deleted?: "T" | "F";
}

export async function fetchBoards(accessToken: string): Promise<Cafe24Board[]> {
  const json = (await cafe24Get(
    `/api/v2/admin/boards?limit=100`,
    accessToken
  )) as { boards?: Cafe24Board[] };
  return (json.boards ?? []).filter((b) => b.use_board === "T");
}

export async function fetchBoardArticles(
  accessToken: string,
  boardNo: number,
  opts: { limit?: number; sinceDate?: Date } = {}
): Promise<Cafe24Article[]> {
  const limit = opts.limit ?? 30;
  const params = new URLSearchParams({
    limit: String(limit),
  });
  if (opts.sinceDate) {
    // Cafe24 API: start_date와 end_date는 한 쌍으로만 허용됨
    const start = opts.sinceDate.toISOString().slice(0, 10);
    const end = new Date().toISOString().slice(0, 10);
    params.set("start_date", start);
    params.set("end_date", end);
  }
  const json = (await cafe24Get(
    `/api/v2/admin/boards/${boardNo}/articles?${params}`,
    accessToken
  )) as { articles?: Cafe24Article[] };
  return json.articles ?? [];
}

export async function cafe24Put(path: string, accessToken: string, body: unknown) {
  const res = await cafe24Fetch(path, accessToken, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Cafe24 PUT [${res.status}]: ${text}`);
  }
  return res.json();
}
