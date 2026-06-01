import type { Influencer, InfluencerStatus } from "./influencerStorage";

export interface DmTemplate {
  id: InfluencerStatus | string;
  label: string;
  emoji: string;
  render: (inf: Influencer) => string;
}

// ── 키워드 기반 감정 분석 ──────────────────────────────────────────────────

const POSITIVE_KEYWORDS = ["좋아요", "감사", "해볼게요", "관심", "보내주세요", "좋아", "협찬", "가능", "네", "ㅎㅎ", "😊", "❤️", "💜", "✨", "ok", "okay", "yes", "sure", "협업", "해요"];
const NEGATIVE_KEYWORDS = ["안돼요", "힘들", "거절", "괜찮아요", "죄송", "못해요", "노", "no", "바빠", "다음에", "어렵"];

export function analyzeSentiment(text: string): "positive" | "negative" | "neutral" {
  const lower = text.toLowerCase();
  const pos = POSITIVE_KEYWORDS.filter((k) => lower.includes(k)).length;
  const neg = NEGATIVE_KEYWORDS.filter((k) => lower.includes(k)).length;
  if (neg > pos) return "negative";
  if (pos > 0) return "positive";
  return "neutral";
}

// ── DM 템플릿 목록 ────────────────────────────────────────────────────────

export const DM_TEMPLATES: DmTemplate[] = [
  {
    id: "initial",
    label: "첫 번째 DM (협찬 제안)",
    emoji: "✉️",
    render: (inf) => `안녕하세요 ${inf.name || inf.handle}님, 여성 시계 브랜드 폴바이스(PAULVICE)입니다.

${inf.name || inf.handle}님과 잘 어울릴 것 같은 시계가 있어 협업 제안드리고 싶어 연락드렸습니다. 에끌라 오벌과 오드리 두 모델 중 마음에 드시는 걸로 무상으로 보내드리고, 인스타 피드 1회 정도의 가벼운 협업을 생각하고 있습니다.

부담 없이 보시고 관심 있으시면 답장 주세요. 두 제품 링크 바로 보내드리겠습니다.

폴바이스 드림`,
  },
  {
    id: "followup",
    label: "팔로업 DM (미응답 시)",
    emoji: "🔔",
    render: (inf) => `안녕하세요 ${inf.name || inf.handle}님, 폴바이스(PAULVICE)입니다.

얼마 전 시계 협업 관련해 메시지 드렸는데, 혹시 못 보셨을까 해서 한 번 더 연락드립니다.

관심 있으시거나 궁금한 점 있으시면 편하게 답장 주세요.

폴바이스 드림`,
  },
  {
    id: "shipping_request",
    label: "배송지 요청 (긍정 답변 후)",
    emoji: "📦",
    render: (inf) => `답장 감사합니다, ${inf.name || inf.handle}님.

제품 보내드릴 수 있도록 아래 정보 주시면 됩니다.

성함 / 연락처 / 배송지 주소(우편번호 포함) / 상세주소

그리고 에끌라 오벌과 오드리 중 어떤 모델로 받아보고 싶으신지도 함께 알려주세요. 두 제품 링크 보내드립니다.
[링크]

폴바이스 드림`,
  },
  {
    id: "shipping_confirm",
    label: "발송 확인 안내",
    emoji: "🚀",
    render: (inf) => `${inf.name || inf.handle}님, 배송지 정보 감사합니다.

제품 준비해서 빠르게 발송하겠습니다. 발송되면 운송장 번호와 함께 다시 연락드릴게요.

촬영하시면서 궁금한 점 있으면 편하게 말씀해 주세요.

폴바이스 드림`,
  },
  {
    id: "tracking",
    label: "배송 운송장 안내",
    emoji: "📬",
    render: (inf) => `${inf.name || inf.handle}님, 제품이 발송되었습니다.

우체국택배 운송장 번호: [운송장번호]
(우체국택배 사이트에서 조회 가능합니다)

받아보시고 콘텐츠 올리실 때 @paulvice.kr 태그해 주시면 감사하겠습니다.

궁금한 점은 언제든 연락 주세요.

폴바이스 드림`,
  },
  {
    id: "no_reply",
    label: "거절/보류 응대",
    emoji: "🤝",
    render: (inf) => `답장 주셔서 감사합니다, ${inf.name || inf.handle}님.

다음에 기회가 되면 또 제안드리겠습니다. 좋은 하루 보내세요.

폴바이스 드림`,
  },
];

// ── 상태에 따른 추천 템플릿 ───────────────────────────────────────────────

export function getRecommendedTemplate(
  status: InfluencerStatus,
  replyText?: string
): DmTemplate {
  // 답장이 있으면 감정 분석 후 추천
  if (replyText) {
    const sentiment = analyzeSentiment(replyText);
    if (sentiment === "negative") return DM_TEMPLATES.find((t) => t.id === "no_reply")!;
    if (sentiment === "positive") return DM_TEMPLATES.find((t) => t.id === "shipping_request")!;
  }

  const map: Partial<Record<InfluencerStatus, string>> = {
    approved:    "initial",
    dm_sent:     "followup",
    replied:     "shipping_request",
    negotiating: "shipping_request",
    confirmed:   "shipping_confirm",
    shipped:     "tracking",
  };

  const templateId = map[status] ?? "initial";
  return DM_TEMPLATES.find((t) => t.id === templateId) ?? DM_TEMPLATES[0];
}
