/**
 * 국내 리뷰 요청 — 문자(SMS/LMS). 한국 고객은 이메일보다 문자 도달·반응이 높다.
 *
 * 토큰링크(로그인 불필요)로 우리 리뷰페이지를 열고, 작성 시 적립금 보상(lib/reviews/reward).
 * 발송은 Solapi(lib/sms/solapi) sendMany — 발신번호는 콘솔 등록번호(SOLAPI_SENDER).
 *
 * 토큰에 phone 을 실어 두면, 후기 제출 시 reviews.customer_phone 으로 저장되고
 * reward 단계에서 그 번호로 카페24 회원을 매칭해 적립금을 지급한다.
 */
import { signReviewToken, getMall, type MallId } from "./core";
import { sendMany, detectMessageType, estimateCost } from "@/lib/sms/solapi";

const BASE = () => process.env.REVIEW_BASE_URL || "https://paulvice-dashboard.vercel.app";

export interface SmsTarget {
  mall: MallId;
  phone: string;
  customer_name: string | null;
  product_no: number | null;
  product_name: string | null;
  order_ref?: string | null;
}

export function reviewUrlForSms(t: SmsTarget): string {
  const mall = getMall(t.mall)!;
  const token = signReviewToken({
    mall: mall.id,
    productNo: t.product_no || 0,
    productName: t.product_name || "주문하신 시계",
    orderRef: t.order_ref || undefined,
    name: t.customer_name || undefined,
    phone: t.phone.replace(/\D/g, ""),
  });
  return `${BASE()}/review/${token}`;
}

/**
 * 무료 수신거부 번호(080) — 국내 광고성 문자는 무료거부 수단 명시가 법적 의무.
 * Solapi 콘솔에서 080 수신거부 서비스 신청 후 번호를 REVIEW_SMS_OPTOUT 에 설정한다.
 */
export function smsOptOut(): string | null {
  return process.env.REVIEW_SMS_OPTOUT || null;
}

/** 국내 리뷰요청 문자 본문. LMS(제목+본문). 이름/상품 치환. */
export function buildReviewSms(t: SmsTarget): { subject: string; text: string } {
  const name = (t.customer_name || "고객").replace(/\s+/g, " ").trim();
  const product = t.product_name || "주문하신 시계";
  const url = reviewUrlForSms(t);
  const optout = smsOptOut();
  const text =
    `[해리엇] ${name}님, ${product}는 마음에 드셨나요?\n\n` +
    `사용 후기를 남겨주시면 적립금으로 보답해 드려요. ` +
    `사진·동영상 후기는 적립금이 더 커집니다.\n\n` +
    `▶ 1분이면 끝 (로그인 불필요)\n${url}\n\n` +
    `- 해리엇 드림` +
    (optout ? `\n무료수신거부 ${optout}` : "");
  return { subject: "해리엇 사용 후기 요청", text };
}

export interface SmsCampaignResult {
  ok: boolean;
  total: number;
  successCount: number;
  failCount: number;
  type: "SMS" | "LMS";
  estCost: number;
  groupId?: string;
  results: Array<{ phone: string; status: "success" | "fail"; error?: string }>;
}

/** 다건 리뷰요청 문자 발송. 수신자별 본문(이름·링크) 생성 → Solapi sendMany. */
export async function sendReviewSmsBatch(targets: SmsTarget[]): Promise<SmsCampaignResult> {
  const valid = targets.filter((t) => (t.phone || "").replace(/\D/g, "").length >= 10);
  const messages = valid.map((t) => {
    const { subject, text } = buildReviewSms(t);
    return { to: t.phone, text, subject };
  });
  const sampleText = messages[0]?.text || "";
  const type = detectMessageType(sampleText);
  const estCost = estimateCost(sampleText, messages.length);

  if (messages.length === 0) {
    return { ok: true, total: 0, successCount: 0, failCount: 0, type, estCost: 0, results: [] };
  }
  const out = await sendMany(messages);
  return {
    ok: out.ok,
    total: messages.length,
    successCount: out.successCount,
    failCount: out.failCount,
    type,
    estCost,
    groupId: out.groupId,
    results: out.results.map((r) => ({ phone: r.phone, status: r.status, error: r.error })),
  };
}
