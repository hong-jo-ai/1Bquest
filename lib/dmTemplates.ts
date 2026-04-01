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
    render: (inf) => `안녕하세요 @${inf.handle}님! 😊

럭셔리 워치 브랜드 폴바이스(PAULVICE)입니다 ⌚✨

${inf.name}님의 콘텐츠를 보며 폴바이스의 감성과 정말 잘 어울린다는 느낌이 들었어요.

폴바이스는 정교한 디자인과 합리적인 가격을 추구하는 국내 독립 시계 브랜드인데요, ${inf.name}님과 제품 협찬 협업을 진행하고 싶어서 연락드렸습니다.

관심이 있으시다면 편하게 답장 주세요! 🙏

감사합니다 💜
폴바이스(PAULVICE) 드림`,
  },
  {
    id: "followup",
    label: "팔로업 DM (미응답 시)",
    emoji: "🔔",
    render: (inf) => `안녕하세요 @${inf.handle}님! 😊

얼마 전 폴바이스(PAULVICE) 제품 협찬 관련으로 DM 드렸는데, 확인이 어려우셨나 해서 다시 연락드립니다.

혹시 관심이 있으시거나 궁금하신 점 있으시면 언제든지 편하게 답장 주세요! 🙏

감사합니다 💙`,
  },
  {
    id: "shipping_request",
    label: "배송지 요청 (긍정 답변 후)",
    emoji: "📦",
    render: (inf) => `감사합니다 ${inf.name}님! 😊

관심 가져주셔서 정말 기뻐요 💜

제품을 보내드릴 수 있도록 아래 정보를 알려주시겠어요?

📝 성함
📱 연락처 (010-xxxx-xxxx)
🏠 배송지 주소 (우편번호 포함)
🏠 상세주소

어떤 스타일을 선호하시나요? 취향에 맞는 제품으로 준비해 드릴게요 ⌚

감사합니다!
폴바이스(PAULVICE) 드림`,
  },
  {
    id: "shipping_confirm",
    label: "발송 확인 안내",
    emoji: "🚀",
    render: (inf) => `${inf.name}님, 안녕하세요! 😊

배송지 정보 감사합니다!

폴바이스(PAULVICE) 제품을 빠르게 준비해서 발송해 드릴게요 📦⌚

배송이 시작되면 운송장 번호와 함께 다시 연락드리겠습니다.

콘텐츠 촬영하시면서 궁금하신 점은 언제든 편하게 말씀해 주세요! 🙏

감사합니다 💜
폴바이스(PAULVICE) 드림`,
  },
  {
    id: "tracking",
    label: "배송 운송장 안내",
    emoji: "📬",
    render: (inf) => `안녕하세요 ${inf.name}님! 😊

폴바이스(PAULVICE) 제품이 발송되었습니다 📦

우체국택배 운송장 번호: [운송장번호 입력]
(우체국택배 사이트에서 조회 가능합니다)

마음에 드시길 바라며, 착용샷이나 콘텐츠 촬영 후 태그해 주시면 정말 감사할 것 같아요! ⌚✨

@paulvice_official

궁금하신 점은 언제든 연락 주세요 💜
감사합니다!`,
  },
  {
    id: "no_reply",
    label: "거절/보류 응대",
    emoji: "🤝",
    render: (inf) => `안녕하세요 ${inf.name}님!

말씀 감사드립니다. 바쁘신 중에 답장 주셔서 감사해요 😊

괜찮으시다면 나중에 기회가 될 때 다시 한번 함께 해요! 🙏

좋은 하루 되세요 💙
폴바이스(PAULVICE) 드림`,
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
