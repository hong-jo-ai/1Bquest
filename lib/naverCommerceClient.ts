/**
 * 네이버 커머스 API 클라이언트.
 *
 * 인증: client_credentials + bcrypt 서명 (3시간 토큰)
 * 사용처: 스마트스토어 상품 Q&A 수집/답변 (CS 인박스 채널 = naver_qna)
 *
 * 서명 방식 (네이버 커머스 API 표준):
 *   password = `${client_id}_${timestamp}`
 *   salt     = client_secret  (자체가 bcrypt salt 형식: $2a$...)
 *   sign     = base64( bcrypt.hashpw(password, salt) )
 */
import bcrypt from "bcryptjs";

const BASE = "https://api.commerce.naver.com/external";

const CLIENT_ID = process.env.NAVER_COMMERCE_CLIENT_ID;
const CLIENT_SECRET = process.env.NAVER_COMMERCE_CLIENT_SECRET;

interface TokenResponse {
  access_token: string;
  expires_in: number; // seconds
  token_type: string;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

function signClientSecret(timestamp: number): string {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error(
      "NAVER_COMMERCE_CLIENT_ID / NAVER_COMMERCE_CLIENT_SECRET 환경변수 누락"
    );
  }
  const password = `${CLIENT_ID}_${timestamp}`;
  const hashed = bcrypt.hashSync(password, CLIENT_SECRET);
  return Buffer.from(hashed, "utf-8").toString("base64");
}

export async function getNaverAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error(
      "NAVER_COMMERCE_CLIENT_ID / NAVER_COMMERCE_CLIENT_SECRET 환경변수 누락"
    );
  }

  const timestamp = Date.now();
  const sign = signClientSecret(timestamp);

  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    timestamp: String(timestamp),
    client_secret_sign: sign,
    grant_type: "client_credentials",
    type: "SELF",
  });

  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`네이버 커머스 토큰 발급 실패 [${res.status}]: ${await res.text()}`);
  }
  const json = (await res.json()) as TokenResponse;
  cachedToken = {
    token: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  return json.access_token;
}

async function naverGet<T>(path: string, params?: Record<string, string | number>): Promise<T> {
  const token = await getNaverAccessToken();
  const url = new URL(`${BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Naver API GET ${path} [${res.status}]: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

async function naverPost<T>(path: string, body: unknown): Promise<T> {
  const token = await getNaverAccessToken();
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Naver API POST ${path} [${res.status}]: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

// ── 상품 Q&A ───────────────────────────────────────────────────────────────

export interface NaverQna {
  inquiryNo: number;
  inquiryTitle?: string;
  inquiryContent: string;
  inquiryRegistrationDateTime: string; // ISO
  answered: boolean;
  answerContent?: string | null;
  answerRegistrationDateTime?: string | null;
  productOrderId?: string | null;
  productNo?: number | null;
  productName?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  inquiryCategory?: string | null;
}

interface QnaListResponse {
  contents: NaverQna[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

/**
 * 상품 Q&A 목록 조회.
 * @param sinceDays 며칠 전부터 조회할지 (기본 14일)
 * @param answered  true=답변완료만, false=미답변만, undefined=전체
 */
export async function fetchNaverQnas(opts: {
  sinceDays?: number;
  answered?: boolean;
  size?: number;
} = {}): Promise<NaverQna[]> {
  const sinceDays = opts.sinceDays ?? 14;
  const size = opts.size ?? 50;
  const end = new Date();
  const start = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

  const params: Record<string, string | number> = {
    inquiryStartSearchDate: start.toISOString().slice(0, 10),
    inquiryEndSearchDate: end.toISOString().slice(0, 10),
    size,
    page: 1,
  };
  if (opts.answered !== undefined) {
    params.answered = String(opts.answered);
  }

  const all: NaverQna[] = [];
  let page = 1;
  while (true) {
    params.page = page;
    const res = await naverGet<QnaListResponse>("/v1/contents/qnas", params);
    all.push(...(res.contents ?? []));
    if (page >= (res.totalPages ?? 1)) break;
    page += 1;
    if (page > 20) break; // 안전장치
  }
  return all;
}

/**
 * 상품 Q&A 답변 등록.
 * 운영자가 대시보드에서 답변을 보낼 때 호출.
 */
export async function answerNaverQna(inquiryNo: number, content: string): Promise<void> {
  await naverPost(`/v1/contents/qnas/${inquiryNo}/answer`, { content });
}
