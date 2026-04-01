import Anthropic from "@anthropic-ai/sdk";
import { type NextRequest } from "next/server";

function getClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY 없음");
  return new Anthropic({ apiKey });
}

const SYSTEM = `당신은 폴바이스(PAULVICE) 멀티채널 콘텐츠 전문가입니다.
하나의 콘텐츠 아이디어를 각 채널의 특성에 맞게 최적화합니다.

채널별 특성:
- 릴스(Reels): 15초, 강한 훅 첫 1초, 빠른 컷, 텍스트 오버레이 활용, 음악 중요
- 유튜브 쇼츠: 60초, 스토리 있음, 정보 제공형도 OK, 자막 필수
- 인스타 피드: 정적 이미지, 캡션 길어도 됨 (300-500자), 감성적 사진 설명 + CTA
- 쓰레드: 텍스트만, 3-5문장, 해시태그 없거나 1개, 공감/질문/선언형

브랜드: 폴바이스(PAULVICE) / 타겟: 20-30대 직장 여성 / 제품: 여성 시계, 각인 서비스

창업자 출연 제약 — 반드시 준수:
- 창업자(홍성조)는 남성이므로 제품 착용·착장 시연 불가
- 창업자 출연은 디자이너/대표 포지션으로만: 제작 배경, 소재 선택 이유, 선물 추천, 각인 스토리 등
- 착용·손목 클로즈업·코디 장면은 여성 모델 또는 여성 손으로만 연출
- 대본에서 "저도 이런 시계 좋아해요" 류의 착용 공감 표현 사용 금지

반드시 유효한 JSON만 출력하세요.`;

export async function POST(req: NextRequest) {
  const { idea, channels } = await req.json();

  const client = getClient();
  const channelList = (channels as string[]).join(", ");

  const prompt = `다음 콘텐츠 아이디어를 각 채널에 맞게 변환해주세요.

핵심 아이디어:
${idea}

변환할 채널: ${channelList}

아래 JSON 배열로만 응답하세요:
[
  {
    "channel": "reels",
    "script": "채널에 최적화된 대본 또는 캡션 전체",
    "shootingNotes": "이 채널용 촬영/편집 특이사항",
    "duration": "예상 길이",
    "keyPoints": ["이 채널 버전의 핵심 포인트"]
  }
]

각 채널의 특성을 충분히 반영해서 단순 포맷 변환이 아닌 채널 맞춤 재창작을 해주세요.`;

  try {
    const res = await client.messages.create({
      model: "claude-opus-4-5", max_tokens: 3000, system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
    });
    const raw = (res.content[0] as { text: string }).text.trim();
    const json = raw.startsWith("[") ? JSON.parse(raw) : JSON.parse(raw.replace(/^```json\n?/, "").replace(/\n?```$/, ""));
    return Response.json({ versions: json });
  } catch (e: any) {
    return Response.json({ error: e.message ?? "채널 변환 실패" }, { status: 500 });
  }
}
