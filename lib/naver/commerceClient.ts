/**
 * 네이버 커머스 API(스마트스토어) 클라이언트 — 해리엇 와치스 스토어.
 *
 * 인증이 특이하다: client_secret 을 **bcrypt salt 로 써서** `{clientId}_{timestamp}` 를 해싱한 값이
 * 서명이다. 일반적인 HMAC 이 아니라서 직접 구현한다.
 *
 * 토큰은 만료가 짧아(기본 3시간) 모듈 안에서 캐시하고, 만료 1분 전에 새로 받는다.
 * local-agent 쪽 동기화 스크립트(`runSmartstoreSync.js`)와 같은 자격증명을 쓴다.
 */
import bcrypt from "bcryptjs";

const API_BASE = "https://api.commerce.naver.com/external";

let cached: { token: string; expiresAt: number } | null = null;

function credentials(): { id: string; secret: string } {
  const id = process.env.NAVER_COMMERCE_CLIENT_ID;
  const secret = process.env.NAVER_COMMERCE_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error("NAVER_COMMERCE_CLIENT_ID / NAVER_COMMERCE_CLIENT_SECRET 환경변수 누락");
  }
  return { id, secret };
}

export async function getCommerceToken(): Promise<string> {
  if (cached && Date.now() < cached.expiresAt) return cached.token;

  const { id, secret } = credentials();
  const timestamp = Date.now();
  const sign = Buffer.from(bcrypt.hashSync(`${id}_${timestamp}`, secret)).toString("base64");

  const res = await fetch(`${API_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: id,
      timestamp: String(timestamp),
      client_secret_sign: sign,
      grant_type: "client_credentials",
      type: "SELF",
    }),
  });
  if (!res.ok) {
    throw new Error(`커머스 API 토큰 실패 ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in?: number };
  const ttlMs = (json.expires_in ?? 10800) * 1000;
  cached = { token: json.access_token, expiresAt: Date.now() + ttlMs - 60_000 };
  return json.access_token;
}

export async function commerceApi<T = unknown>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const token = await getCommerceToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`커머스 API ${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
  }
  return (text ? JSON.parse(text) : null) as T;
}

/** 고객 문의(1:1). 페이지 크기는 10 미만이면 400 이 난다(실측). */
export interface NaverInquiry {
  inquiryNo: number;
  category?: string;
  title?: string;
  inquiryContent?: string;
  inquiryRegistrationDateTime?: string;
  customerId?: string;
  customerName?: string;
  answered?: boolean;
  answerContent?: string;
  answerRegistrationDateTime?: string;
  productNo?: number;
  productName?: string;
  productOrderId?: string;
  orderId?: string;
}

export async function listInquiries(opts: {
  startDate: string;   // yyyy-MM-dd
  endDate: string;     // yyyy-MM-dd
  answered?: boolean;
  page?: number;
  size?: number;
}): Promise<{ content: NaverInquiry[]; totalElements: number; last: boolean }> {
  const q = new URLSearchParams({
    startSearchDate: opts.startDate,
    endSearchDate: opts.endDate,
    page: String(opts.page ?? 1),
    size: String(Math.max(10, opts.size ?? 50)),
  });
  if (opts.answered !== undefined) q.set("answered", String(opts.answered));
  return commerceApi("GET", `/v1/pay-user/inquiries?${q.toString()}`);
}

/**
 * 고객 문의 답변 등록.
 * ⚠️ 조회는 `/v1/pay-user/`, 답변은 `/v1/pay-merchant/` 로 **접두어가 다르다**.
 */
export async function answerInquiry(inquiryNo: number, content: string): Promise<unknown> {
  return commerceApi("POST", `/v1/pay-merchant/inquiries/${inquiryNo}/answer`, {
    answerContent: content,
  });
}
