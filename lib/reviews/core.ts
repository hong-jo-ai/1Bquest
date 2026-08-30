/**
 * 리뷰 관리 시스템 — 코어 (멀티몰)
 *
 * 해리엇 글로벌부터 시작해 해리엇 국내·폴바이스 국내/글로벌까지 확장 가능하도록
 * mall 차원을 1급 개념으로 둔다.
 *
 * 흐름: 요청메일/문자의 토큰링크 → 고객이 로그인 없이 별점/글/사진/동영상 제출
 *      → reviews 테이블에 status=published 로 자동 저장(사장님 선택: 자동게시+사후숨김)
 *      → (베스트에포트) 카페24 상품후기 게시판에 자동 게시
 *      → 관리자 화면에서 숨김/스팸 처리 + 데이터 소유.
 */
import crypto from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ── 멀티몰 설정 ──────────────────────────────────────────────
export type MallId =
  | "harriot_global"
  | "harriot_kr"
  | "paulvice_kr"
  | "paulvice_global";

export interface MallConfig {
  id: MallId;
  label: string;
  /** 카페24 토큰 스토어 몰 키 (cafe24Client 의 MallId) */
  cafe24Mall: "harriot" | "paulvice";
  shopNo: number;          // 카페24 shop_no (영문몰=2)
  reviewBoardNo: number;   // 상품후기 게시판 board_no
  boardCategoryNo: number;
  currency: "USD" | "KRW";
  /** 후기 유형별 적립 보상(표시·기록용; 실제 지급은 별도 단계) */
  reward: { text: number; photo: number; video: number };
}

export const MALLS: Record<MallId, MallConfig> = {
  harriot_global: {
    id: "harriot_global",
    label: "Harriot (Global)",
    cafe24Mall: "harriot",
    shopNo: 2,
    reviewBoardNo: 4,
    boardCategoryNo: 1,
    currency: "USD",
    reward: { text: 5000, photo: 15000, video: 25000 },
  },
  // 아래는 자리만 — 추후 board_no/shop_no 확정해 활성화
  harriot_kr: {
    id: "harriot_kr", label: "Harriot (KR)", cafe24Mall: "harriot",
    shopNo: 1, reviewBoardNo: 4, boardCategoryNo: 1, currency: "KRW",
    // 국내몰은 판매가가 글로벌과 달라 보상도 별도 — 글 3천/사진 7천/동영상 1만 적립금
    reward: { text: 3000, photo: 7000, video: 10000 },
  },
  paulvice_kr: {
    id: "paulvice_kr", label: "Paulvice (KR)", cafe24Mall: "paulvice",
    shopNo: 1, reviewBoardNo: 4, boardCategoryNo: 1, currency: "KRW",
    // 폴바이스는 판매단가가 낮아 적립금도 해리엇보다 낮게(사장님 2026-06-30): 글1500/사진3000/동영상5000
    reward: { text: 1500, photo: 3000, video: 5000 },
  },
  paulvice_global: {
    id: "paulvice_global", label: "Paulvice (Global)", cafe24Mall: "paulvice",
    shopNo: 2, reviewBoardNo: 4, boardCategoryNo: 1, currency: "USD",
    reward: { text: 3000, photo: 7000, video: 12000 },
  },
};

export function getMall(id: string): MallConfig | null {
  return (MALLS as Record<string, MallConfig>)[id] ?? null;
}

/** 메시지·발신 표기용 한글 브랜드명(브랜드별 분기). */
export function brandLabelKo(mall: MallConfig): string {
  return mall.cafe24Mall === "harriot" ? "해리엇" : "폴바이스";
}

/** 리뷰 페이지 브라우저 탭 제목(브랜드별). 앱 기본("Harriotwatches Dashboard") 대신 노출 — 고객 혼동 방지. */
export function reviewTitleFromToken(token: string | null): string {
  const tok = token ? verifyReviewToken(token) : null;
  const mall = tok ? getMall(tok.mall) : null;
  if (!mall) return "리뷰 작성";
  const brand = mall.cafe24Mall === "harriot" ? "HARRIOT" : "PAULVICE";
  return mall.currency === "KRW" ? `${brand} 리뷰` : `${brand} Review`;
}

/** 리뷰 페이지 base URL(브랜드별). 폴바이스는 전용 도메인(env), 미설정 시 해리엇 기본으로 폴백. */
export function reviewBaseUrl(mall: MallConfig): string {
  const harriot = (process.env.REVIEW_BASE_URL || "https://review.harriotwatches.co.kr").replace(/\/$/, "");
  if (mall.cafe24Mall === "paulvice") {
    return (process.env.REVIEW_BASE_URL_PAULVICE || harriot).replace(/\/$/, "");
  }
  return harriot;
}

/**
 * 카카오 알림톡 발송 설정(브랜드별). pfId(채널)·templateId(승인 템플릿)가 둘 다 env에 있어야 알림톡 사용.
 * 없으면 null → 리뷰요청은 기존 SMS/LMS로 폴백(무회귀).
 *   REVIEW_KAKAO_PFID_HARRIOT / REVIEW_KAKAO_TEMPLATE_HARRIOT
 *   REVIEW_KAKAO_PFID_PAULVICE / REVIEW_KAKAO_TEMPLATE_PAULVICE
 */
export interface KakaoReviewConfig { pfId: string; templateId: string; }
export function kakaoReviewConfig(mall: MallConfig): KakaoReviewConfig | null {
  const suffix = mall.cafe24Mall === "harriot" ? "HARRIOT" : "PAULVICE";
  const pfId = process.env[`REVIEW_KAKAO_PFID_${suffix}`];
  const templateId = process.env[`REVIEW_KAKAO_TEMPLATE_${suffix}`];
  return pfId && templateId ? { pfId, templateId } : null;
}

export type MediaType = "none" | "photo" | "video";
/**
 * 적립금 **비율제** — 실결제가에 비례한다(사장님 결정 2026-08-30).
 *
 * 왜 바꿨나: 브랜드별 정액이라 가격을 전혀 안 봤다. 그 결과 33,000원짜리 가죽밴드에
 * 7,000원(21%)이 나갔고, 실제로 한 건은 10,000원(30%)까지 지급됐다.
 * 같은 정액이 171,000원 시계에는 4% 였으니 상품 간 형평도 깨져 있었다.
 *
 * 하한을 두는 이유: 저가품이라고 몇백 원을 주면 후기를 쓸 이유가 안 된다.
 * 상한을 두는 이유: 고가 시계에서 비율이 그대로 커지면 마진이 감당 못 한다.
 */
export const REWARD_RATE: Record<MediaType, number> = { none: 0.02, photo: 0.04, video: 0.06 };
export const REWARD_MIN = 1000;
export const REWARD_CAP: Record<MediaType, number> = { none: 3000, photo: 6000, video: 10000 };

/**
 * @param paidAmount 그 상품의 **실결제가**. 정가가 아니다 —
 *   공홈은 평균 17.7% 상시할인이라 정가로 계산하면 실제보다 후하게 나간다.
 *   모르면(주문 조회 실패 등) null 을 넘긴다 → 종전 정액으로 안전하게 폴백한다.
 */
export function rewardFor(mall: MallConfig, type: MediaType, paidAmount?: number | null): number {
  if (!paidAmount || paidAmount <= 0) {
    // 폴백: 가격을 모르면 예전 정액. 보상이 0이 되어 고객이 손해보는 쪽으로는 실패하지 않는다.
    return type === "video" ? mall.reward.video : type === "photo" ? mall.reward.photo : mall.reward.text;
  }
  const raw = paidAmount * REWARD_RATE[type];
  const rounded = Math.round(raw / 100) * 100;   // 100원 단위 — 적립금 안내가 지저분해지지 않게
  return Math.min(REWARD_CAP[type], Math.max(REWARD_MIN, rounded));
}

// ── 토큰 (로그인 없이 누가/뭘 샀는지 식별) ───────────────────
// payload 를 base64url + HMAC-SHA256 서명. 변조 불가, 만료 포함.
export interface ReviewToken {
  mall: MallId;
  productNo: number;
  productName: string;
  orderRef?: string;
  name?: string;
  email?: string;
  phone?: string; // 국내 SMS 리뷰의 적립금 회원매칭 키(카페24는 cellphone으로 회원 조회)
  exp: number; // epoch sec
}

function secret(): string {
  return process.env.REVIEW_TOKEN_SECRET || process.env.APP_AUTH_SECRET || "harriot-review-dev-secret";
}
function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s: string): Buffer {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64");
}

export function signReviewToken(payload: Omit<ReviewToken, "exp"> & { exp?: number }): string {
  const body: ReviewToken = { ...payload, exp: payload.exp ?? Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 90 };
  const data = b64url(Buffer.from(JSON.stringify(body)));
  const sig = b64url(crypto.createHmac("sha256", secret()).update(data).digest());
  return `${data}.${sig}`;
}

export function verifyReviewToken(token: string): ReviewToken | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [data, sig] = parts;
  const expected = b64url(crypto.createHmac("sha256", secret()).update(data).digest());
  // timing-safe 비교
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(b64urlDecode(data).toString("utf8")) as ReviewToken;
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (!getMall(payload.mall)) return null;
    return payload;
  } catch {
    return null;
  }
}

// ── Supabase ─────────────────────────────────────────────────
export function reviewsDb(): SupabaseClient {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

export const REVIEW_MEDIA_BUCKET = "review-media";

/**
 * 후기 대상 상품의 **실결제가**를 주문에서 읽는다.
 *
 * ⚠️ 주문 총액이 아니라 **그 상품 항목**의 결제금액이다. 시계와 밴드를 한 주문에
 *    같이 샀는데 밴드 후기에 주문 총액을 적용하면 크게 과지급된다.
 * ⚠️ 실패하면 null 을 돌려준다 — 호출부가 정액으로 폴백한다. 여기서 던지면
 *    적립금 계산 때문에 후기 저장 자체가 막힌다. 후기를 잃는 게 더 손해다.
 */
export async function paidAmountForReview(
  mall: MallConfig,
  orderRef: string | null | undefined,
  productNo: number,
): Promise<number | null> {
  if (!orderRef) return null;
  try {
    const { getAccessTokenFromStore } = await import("@/lib/cafe24TokenStore");
    const { cafe24Get } = await import("@/lib/cafe24Client");
    const at = await getAccessTokenFromStore(mall.cafe24Mall);
    if (!at) return null;
    const res = await cafe24Get(
      `/api/v2/admin/orders/${encodeURIComponent(orderRef)}?embed=items`, at, mall.cafe24Mall);
    const items = (res?.order?.items ?? []) as Array<{ product_no?: number | string; payment_amount?: string; product_price?: string; quantity?: number }>;
    const hit = items.find((i) => Number(i.product_no) === Number(productNo));
    if (!hit) return null;
    // payment_amount = 할인·쿠폰까지 반영된 실제 결제금액. 수량이 2개면 1개당으로 나눈다.
    const amount = Number(hit.payment_amount || hit.product_price || 0);
    const qty = Math.max(1, Number(hit.quantity) || 1);
    return amount > 0 ? amount / qty : null;
  } catch {
    return null;
  }
}
