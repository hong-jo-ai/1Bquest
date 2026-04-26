import Anthropic from "@anthropic-ai/sdk";
import { type NextRequest } from "next/server";

function getClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY 없음");
  return new Anthropic({ apiKey });
}

const SYSTEM = `당신은 폴바이스(PAULVICE) 전담 SNS 콘텐츠 디렉터입니다.

브랜드 프로필:
- 브랜드: 폴바이스 (PAULVICE) / 인스타 @plve_seoul
- 제품 라인: 미니엘 쁘띠 사각 워치 (클래식), 에골라 오벌 워치 (트렌디), 오드리 워치 (로맨틱)
- 각인 서비스: 이름·날짜·문구 각인 (선물용으로 인기)
- 타겟: 20~30대 한국 직장 여성, 미니멀·감각적 취향
- 가격대: 합리적 (명품 아님, 하지만 데일리 퀄리티)
- 창업자: 홍성조 대표 (남성) — 브랜드 대표이자 디자이너

창업자 출연 제약 — 반드시 준수:
- 홍성조 대표는 남성이므로 제품을 직접 착용하거나 "이 시계 진짜 예쁘죠?" 식의 착용 시연 불가
- 대신 가능한 포지션: 브랜드 창업자, 제품 디자이너, 선물을 고르는 남자 (연인·친구 선물 맥락)
- 출연 시 말할 수 있는 내용:
  · "이 디자인을 만든 이유는..."
  · "직장 다니는 여자친구를 보면서 느낀 게..."
  · "이 소재를 고른 이유가 따로 있어요"
  · "제 주변 여성분들이 가장 많이 찾는 게..."
  · "각인 서비스 시작한 계기가 있는데..."
  · "선물할 때 어떤 시계를 골라야 할지 모르시는 분들을 위해..."
- 착용 장면, 손목 클로즈업, 코디 연출은 반드시 여성 모델 또는 여성 손 사용
- 창업자는 말하는 역할(인터뷰·브이로그 스타일), 제품은 따로 촬영

콘텐츠 제작 원칙:
- 광고 티 나는 말투 X → 실제로 쓰는 말 O
- "이 시계를 차면 어떤 기분인지"는 창업자가 직접 표현하지 않고, 타겟 공감 문구로 대신
- 공감 → 제작 배경/의도 → CTA 구조
- 대본은 홍성조 대표가 남성 창업자로서 실제로 말할 수 있는 자연스러운 한국어

반드시 유효한 JSON만 출력하세요.`;

export async function POST(req: NextRequest) {
  const { product, season, emotion, channels, contentType, trendContext } = await req.json();

  const client = getClient();

  const channelList = (channels as string[]).join(", ");

  const prompt = `다음 조건으로 폴바이스 SNS 콘텐츠 기획서를 완성도 높게 작성해주세요.

📌 기획 조건
- 제품: ${product}
- 시즌/이슈: ${season}
- 타깃 감성: ${emotion}
- 채널: ${channelList}
- 콘텐츠 유형: ${contentType}
${trendContext ? `
🔥 최신 트렌드 데이터 (트렌드 스캔 결과 — 훅·씬·대본에 적극 반영하세요)
${trendContext}
` : ""}

아래 JSON 구조로 완성된 기획서를 출력하세요:
{
  "title": "이 기획서의 제목 (짧고 명확하게)",
  "hooks": [
    { "text": "훅 문구 (SNS에 바로 쓸 수 있는 첫 줄)", "type": "공감형/질문형/선언형/정보형/감성형 중 하나" },
    { "text": "두 번째 훅 옵션", "type": "..." },
    { "text": "세 번째 훅 옵션", "type": "..." }
  ],
  "scenes": [
    {
      "order": 1,
      "angle": "구체적인 앵글 설명 (예: 손목 45도 클로즈업, 자연광 역광)",
      "background": "배경 설명 (구체적인 장소/컬러/분위기)",
      "props": ["소품1", "소품2"],
      "duration": "권장 촬영 길이 (예: 2-3초, 5초)",
      "note": "촬영 시 주의사항이나 팁"
    }
  ],
  "script": {
    "intro": "도입부 발화 — 훅을 걸고 공감 유발하는 오프닝 (2-3문장, 실제 말하는 톤)",
    "body": "본론 — 제품/스토리 설명 (3-4문장, 자연스럽게)",
    "cta": "CTA — 링크/팔로우/각인 유도 (1-2문장)"
  },
  "caption": "인스타 캡션 전체 (해시태그 제외, 200-400자, 줄바꿈 포함)",
  "hashtags": ["#폴바이스", "#여성시계"],
  "checklist": {
    "styling": ["착장 준비물"],
    "props": ["소품 준비물"],
    "background": ["배경/공간 준비"],
    "equipment": ["장비/세팅 사항"]
  },
  "channelVersions": [
    {
      "channel": "reels",
      "script": "릴스용 15초 완성 대본 (도입-핵심-CTA, 실제 말하는 속도로 15초 분량)",
      "notes": "릴스 편집/촬영 특이사항"
    }
  ]
}

씬은 채널에 따라 적절하게: 릴스 3-4씬, 유튜브쇼츠 5-7씬, 피드는 1-2씬.
channelVersions는 요청된 채널(${channelList})에 맞게 각각 작성.
해시태그는 20개 이내, 핵심 + 브랜드 + 카테고리 믹스.
대본은 홍성조 대표가 실제 말할 수 있는 자연스러운 구어체로.`;

  try {
    const res = await client.messages.create({
      model: "claude-haiku-4-5", max_tokens: 5000, system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
    });
    const raw = (res.content[0] as { text: string }).text.trim();
    const json = raw.startsWith("{") ? JSON.parse(raw) : JSON.parse(raw.replace(/^```json\n?/, "").replace(/\n?```$/, ""));
    return Response.json({ ...json, product, season, emotion, channels, contentType });
  } catch (e: any) {
    return Response.json({ error: e.message ?? "기획서 생성 실패" }, { status: 500 });
  }
}
