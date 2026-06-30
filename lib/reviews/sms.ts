/**
 * 국내 리뷰 요청 — 문자(SMS/LMS). 한국 고객은 이메일보다 문자 도달·반응이 높다.
 *
 * 토큰링크(로그인 불필요)로 우리 리뷰페이지를 열고, 작성 시 적립금 보상(lib/reviews/reward).
 * 발송은 Solapi(lib/sms/solapi) sendMany — 발신번호는 콘솔 등록번호(SOLAPI_SENDER).
 *
 * 문자에는 긴 토큰 대신 **짧은 링크(/r/<code>)** 를 싣는다(lib/reviews/shortlink).
 * 토큰에 phone 을 실어 두면, 후기 제출 시 reviews.customer_phone 으로 저장되고
 * reward 단계에서 그 번호로 카페24 회원을 매칭해 적립금을 지급한다.
 */
import { signReviewToken, getMall, brandLabelKo, reviewBaseUrl, kakaoReviewConfig, type MallId } from "./core";
import { createReviewShortLink } from "./shortlink";
import { sendMany, detectMessageType, estimateCost, type KakaoOptions } from "@/lib/sms/solapi";

export interface SmsTarget {
  mall: MallId;
  phone: string;
  customer_name: string | null;
  product_no: number | null;
  product_name: string | null;
  order_ref?: string | null;
}

/** 리뷰 토큰 문자열 생성(phone 포함). */
function signSmsToken(t: SmsTarget): string {
  const mall = getMall(t.mall)!;
  return signReviewToken({
    mall: mall.id,
    productNo: t.product_no || 0,
    productName: t.product_name || "주문하신 시계",
    orderRef: t.order_ref || undefined,
    name: t.customer_name || undefined,
    phone: t.phone.replace(/\D/g, ""),
  });
}

/** 긴 토큰 URL(/review/<token>) — 내부·폴백용. 브랜드별 리뷰 도메인. */
export function reviewUrlForSms(t: SmsTarget): string {
  return `${reviewBaseUrl(getMall(t.mall)!)}/review/${signSmsToken(t)}`;
}

/** 짧은 링크(/r/<code>) 생성 — DB 저장 동반. 문자/알림톡 발송용. 브랜드별 리뷰 도메인. */
export async function createShortReviewUrl(t: SmsTarget): Promise<string> {
  const token = signSmsToken(t);
  const code = await createReviewShortLink(token, t.mall);
  return `${reviewBaseUrl(getMall(t.mall)!)}/r/${code}`;
}

/** 국내 무료 수신거부 번호(설정 시에만 표기). 리뷰요청은 정보성이라 필수는 아님. */
export function smsOptOut(): string | null {
  return process.env.REVIEW_SMS_OPTOUT || null;
}

/** 국내 리뷰요청 문자 본문(브랜드별). url 은 호출부에서 생성해 전달(짧은 링크 권장). */
export function buildReviewSms(t: SmsTarget, url: string): { subject: string; text: string } {
  const brand = brandLabelKo(getMall(t.mall)!);
  const name = (t.customer_name || "고객").replace(/\s+/g, " ").trim();
  const product = t.product_name || "주문하신 시계";
  const optout = smsOptOut();
  const text =
    `[${brand}] ${name}님, ${product}는 마음에 드셨나요?\n\n` +
    `사용 후기를 남겨주시면 적립금으로 보답해 드려요. ` +
    `사진·동영상 후기는 적립금이 더 커집니다.\n\n` +
    `▶ 1분이면 끝 (로그인 불필요)\n${url}\n\n` +
    `- ${brand} 드림` +
    (optout ? `\n무료수신거부 ${optout}` : "");
  return { subject: `${brand} 사용 후기 요청`, text };
}

/**
 * 카카오 알림톡 리뷰요청 — 렌더된 본문 + 템플릿 변수(브랜드별).
 * ⚠️ 여기 text/변수는 **카카오에 승인 등록한 템플릿과 정확히 일치**해야 발송됨.
 *    등록 템플릿 변수: #{고객명} #{상품명} #{리뷰링크}(프로토콜 제외 주소, 버튼 URL=https://#{리뷰링크})
 *    템플릿 최종본 확정되면 이 함수만 맞추면 된다.
 */
export function buildReviewKakao(t: SmsTarget, url: string): { text: string; variables: Record<string, string> } {
  const mall = getMall(t.mall)!;
  const brand = brandLabelKo(mall);
  const name = (t.customer_name || "고객").replace(/\s+/g, " ").trim();
  const product = t.product_name || "주문하신 시계";
  const linkNoProtocol = url.replace(/^https?:\/\//, ""); // 버튼 URL은 https://#{리뷰링크} 라 프로토콜 제외
  const text =
    brand === "해리엇"
      ? `${name}님, 해리엇을 선택해 주셔서 감사합니다.\n\n` +
        `${product} 잘 받으셨나요?\n착용 후기를 남겨주시면 적립금을 드립니다.\n(사진·동영상 후기는 적립금이 더 커집니다)\n\n` +
        `▶ 아래 버튼으로 1분이면 완료 (로그인 불필요)`
      : `${name}님, 폴바이스를 이용해 주셔서 감사합니다.\n\n` +
        `주문하신 ${product}, 마음에 드셨나요?\n사용 후기를 남겨주시면 적립금으로 보답해 드립니다.\n(사진·동영상 후기는 적립금이 더 커집니다)\n\n` +
        `▶ 아래 버튼으로 1분이면 완료 (로그인 불필요)`;
  return { text, variables: { "#{고객명}": name, "#{상품명}": product, "#{리뷰링크}": linkNoProtocol } };
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

/**
 * 다건 리뷰요청 발송. 수신자별 짧은 링크 생성 → 본문 → Solapi sendMany.
 * 브랜드에 카카오 알림톡 설정(pfId+templateId env)이 있으면 **알림톡**으로, 없으면 **SMS/LMS**로 발송.
 * (알림톡 실패 시 disableSms=false 라 Solapi가 같은 본문으로 SMS 대체발송)
 */
export async function sendReviewSmsBatch(targets: SmsTarget[]): Promise<SmsCampaignResult> {
  const valid = targets.filter((t) => (t.phone || "").replace(/\D/g, "").length >= 10);
  const messages: Array<{ to: string; text: string; subject?: string; kakaoOptions?: KakaoOptions }> = [];
  for (const t of valid) {
    const url = await createShortReviewUrl(t);
    const kakao = kakaoReviewConfig(getMall(t.mall)!);
    if (kakao) {
      const { text, variables } = buildReviewKakao(t, url);
      messages.push({ to: t.phone, text, kakaoOptions: { pfId: kakao.pfId, templateId: kakao.templateId, variables } });
    } else {
      const { subject, text } = buildReviewSms(t, url);
      messages.push({ to: t.phone, text, subject });
    }
  }
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
