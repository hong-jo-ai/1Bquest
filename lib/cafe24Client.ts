import { getAccessTokenFromStore } from "./cafe24TokenStore";

// ── 멀티몰 ───────────────────────────────────────────────────────────────────
// 폴바이스(icaruse2000)·해리엇(harriotkorea) 두 카페24 몰을 한 대시보드에서 운영.
// 기존 호출부는 mall 인자를 생략 → 기본값 paulvice 로 동작(완전 후방호환).
export type MallId = "paulvice" | "harriot";
export const DEFAULT_MALL: MallId = "paulvice";

interface MallConfig {
  mallId: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tokenKey: string; // Supabase kv_store refresh token 키
  state: string; // OAuth state — 콜백에서 몰 식별
}

function cfg(mall: MallId): MallConfig {
  if (mall === "harriot") {
    const mallId = process.env.HARRIOT_CAFE24_MALL_ID;
    const clientId = process.env.HARRIOT_CAFE24_CLIENT_ID;
    const clientSecret = process.env.HARRIOT_CAFE24_CLIENT_SECRET;
    if (!mallId || !clientId || !clientSecret) {
      throw new Error("HARRIOT_CAFE24_* 환경변수 미설정 (MALL_ID/CLIENT_ID/CLIENT_SECRET)");
    }
    return {
      mallId,
      clientId,
      clientSecret,
      redirectUri: process.env.HARRIOT_CAFE24_REDIRECT_URI || process.env.CAFE24_REDIRECT_URI || "",
      tokenKey: "cafe24_refresh_token:harriot",
      state: "harriot_dashboard",
    };
  }
  return {
    mallId: process.env.CAFE24_MALL_ID || "",
    clientId: process.env.CAFE24_CLIENT_ID || "",
    clientSecret: process.env.CAFE24_CLIENT_SECRET || "",
    redirectUri: process.env.CAFE24_REDIRECT_URI || "",
    tokenKey: "cafe24_refresh_token",
    state: "paulvice_dashboard",
  };
}

function baseUrlFor(mall: MallId): string {
  return `https://${cfg(mall).mallId}.cafe24api.com`;
}

/** OAuth state → 몰 식별 (콜백에서 사용). */
export function mallFromState(state: string | null | undefined): MallId {
  return state === "harriot_dashboard" ? "harriot" : "paulvice";
}

/** 몰별 refresh token kv 키 (토큰 스토어에서 사용). */
export function tokenKeyForMall(mall: MallId): string {
  return cfg(mall).tokenKey;
}

const API_VERSION = "2026-03-01";

// 두 몰 공통 기본 스코프(원래 검증된 세트).
const BASE_SCOPES = [
  "mall.read_order",
  "mall.write_order",
  "mall.write_shipping",
  "mall.read_product",
  "mall.write_product",
  "mall.read_category",
  "mall.write_category",
  "mall.read_analytics",
  "mall.read_community",
  "mall.write_community",
  "mall.read_application",
  "mall.write_application",
];

// 적립금(mileage)·회원(customer) 추가 스코프 — 리뷰 보상 자동지급 + 회원 매칭.
// mileage 는 앱별 승인제(개발자센터). 해리엇 앱(2026-06-25)·폴바이스 앱(2026-06-30) 둘 다 승인 완료 → 양쪽 요청.
const EXTRA_SCOPES = [
  "mall.read_customer",
  "mall.write_customer",
  "mall.read_mileage",
  "mall.write_mileage",
];

/** OAuth 스코프 문자열. 두 몰 모두 적립금/회원 스코프 승인 완료 → 동일하게 요청. */
function scopesFor(_mall: MallId): string {
  return [...BASE_SCOPES, ...EXTRA_SCOPES].join(" ");
}

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
  init: RequestInit = {},
  mall: MallId = DEFAULT_MALL
): Promise<Response> {
  const baseHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Cafe24-Api-Version": API_VERSION,
  };

  const base = baseUrlFor(mall);
  const doFetch = (token: string) => fetch(`${base}${path}`, {
    cache: "no-store",
    ...init,
    headers: { ...baseHeaders, ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` },
  });

  const res = await doFetch(accessToken);
  if (res.status !== 401) return res;

  // 401 → SSOT에서 새 토큰 받아 재시도 (해당 몰의 토큰)
  const newToken = await getAccessTokenFromStore(mall);
  if (!newToken || newToken === accessToken) return res;

  // body 있는 요청은 stream 한 번 소비 후 재시도 시 다시 사용 가능해야 함
  // → init.body가 string이면 안전. 우리는 JSON.stringify된 string만 사용.
  return doFetch(newToken);
}

// ── OAuth ──────────────────────────────────────────────────────────────────

export function getAuthUrl(mall: MallId = DEFAULT_MALL): string {
  const c = cfg(mall);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: c.clientId,
    state: c.state,
    redirect_uri: c.redirectUri,
    scope: scopesFor(mall),
  });
  return `${baseUrlFor(mall)}/api/v2/oauth/authorize?${params}`;
}

function basicAuth(mall: MallId) {
  const c = cfg(mall);
  return "Basic " + Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64");
}

export async function exchangeCode(code: string, mall: MallId = DEFAULT_MALL) {
  const c = cfg(mall);
  const res = await fetch(`${baseUrlFor(mall)}/api/v2/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: basicAuth(mall),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: c.redirectUri,
    }),
  });
  if (!res.ok) throw new Error(`코드 교환 실패: ${await res.text()}`);
  return res.json() as Promise<TokenResponse>;
}

export async function doRefresh(refreshToken: string, mall: MallId = DEFAULT_MALL) {
  const res = await fetch(`${baseUrlFor(mall)}/api/v2/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: basicAuth(mall),
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

export async function cafe24Get(path: string, accessToken: string, mall: MallId = DEFAULT_MALL) {
  const res = await cafe24Fetch(path, accessToken, {}, mall);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Cafe24 API [${res.status}]: ${body}`);
  }
  return res.json();
}

export async function cafe24Post(
  path: string,
  accessToken: string,
  body: unknown,
  mall: MallId = DEFAULT_MALL
) {
  const res = await cafe24Fetch(path, accessToken, {
    method: "POST",
    body: JSON.stringify(body),
  }, mall);
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
  /** 상품 게시판인 경우 — 어떤 상품에 대한 문의/리뷰인지 */
  product_no?: number | null;
}

/** 게시판 글의 댓글 — CS 게시판에서 운영자↔고객 대화가 댓글로 이뤄짐. */
export interface Cafe24Comment {
  comment_no: number;
  board_no: number;
  article_no: number;
  content?: string;
  writer?: string;
  member_id?: string | null;
  created_date: string;
  parent_comment_no?: number | null;
  input_channel?: string | null;
  secret?: "T" | "F";
  attach_file_urls?: string[] | null;
}

/** 몰의 운영자(관리자) 계정 id — 게시판 댓글이 운영자 작성인지 판별에 사용(예: icaruse2000). */
export function getMallOperatorId(mall: MallId = DEFAULT_MALL): string {
  return cfg(mall).mallId;
}

export interface Cafe24Product {
  product_no:    number;
  product_name?: string;
  product_code?: string;
  /** 상세 이미지 URL */
  detail_image?: string | null;
  /** 목록 이미지 URL */
  list_image?:   string | null;
  /** 작은 이미지 URL */
  tiny_image?:   string | null;
  price?:        string;
  retail_price?: string;
}

/** 상품 단건 조회 — 게시판 문의에 product_no 가 있으면 부가 정보 채울 때 사용. */
export async function fetchProduct(
  accessToken: string,
  productNo: number,
  mall: MallId = DEFAULT_MALL,
): Promise<Cafe24Product | null> {
  try {
    const json = (await cafe24Get(
      `/api/v2/admin/products/${productNo}`,
      accessToken,
      mall,
    )) as { product?: Cafe24Product };
    return json.product ?? null;
  } catch {
    return null;
  }
}

export async function fetchBoards(accessToken: string, mall: MallId = DEFAULT_MALL): Promise<Cafe24Board[]> {
  const json = (await cafe24Get(
    `/api/v2/admin/boards?limit=100`,
    accessToken,
    mall
  )) as { boards?: Cafe24Board[] };
  return (json.boards ?? []).filter((b) => b.use_board === "T");
}

export async function fetchBoardArticles(
  accessToken: string,
  boardNo: number,
  opts: { limit?: number; sinceDate?: Date } = {},
  mall: MallId = DEFAULT_MALL
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
    accessToken,
    mall
  )) as { articles?: Cafe24Article[] };
  return json.articles ?? [];
}

/** 게시판 글의 댓글 목록 — CS 대화(운영자 답변·고객 재답글)가 여기에 쌓인다. */
export async function fetchArticleComments(
  accessToken: string,
  boardNo: number,
  articleNo: number,
  mall: MallId = DEFAULT_MALL,
): Promise<Cafe24Comment[]> {
  try {
    const json = (await cafe24Get(
      `/api/v2/admin/boards/${boardNo}/articles/${articleNo}/comments?limit=100`,
      accessToken,
      mall,
    )) as { comments?: Cafe24Comment[] };
    // 오래된 → 최신 순 정렬(comment_no 오름차순)
    return (json.comments ?? []).slice().sort((a, b) => a.comment_no - b.comment_no);
  } catch {
    return [];
  }
}

export async function cafe24Put(path: string, accessToken: string, body: unknown, mall: MallId = DEFAULT_MALL) {
  const res = await cafe24Fetch(path, accessToken, {
    method: "PUT",
    body: JSON.stringify(body),
  }, mall);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Cafe24 PUT [${res.status}]: ${text}`);
  }
  return res.json();
}
