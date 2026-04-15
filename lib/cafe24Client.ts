const MALL_ID = process.env.CAFE24_MALL_ID!;
const CLIENT_ID = process.env.CAFE24_CLIENT_ID!;
const CLIENT_SECRET = process.env.CAFE24_CLIENT_SECRET!;
const REDIRECT_URI = process.env.CAFE24_REDIRECT_URI!;

export const BASE_URL = `https://${MALL_ID}.cafe24api.com`;
const API_VERSION = "2026-03-01";
const SCOPES = "mall.read_order mall.read_product mall.write_product mall.read_analytics mall.read_community mall.write_community";

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

export async function cafe24Post(
  path: string,
  accessToken: string,
  body: unknown
) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Cafe24-Api-Version": API_VERSION,
    },
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
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Cafe24-Api-Version": API_VERSION,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Cafe24 PUT [${res.status}]: ${text}`);
  }
  return res.json();
}
