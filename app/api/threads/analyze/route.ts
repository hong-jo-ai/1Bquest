import Anthropic from "@anthropic-ai/sdk";
import { type NextRequest } from "next/server";
import { BRANDS, type BrandId } from "@/lib/threadsBrands";

function getClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY 없음");
  return new Anthropic({ apiKey });
}

const PLATFORM_CONTEXT = `
Threads 플랫폼 특성:
- 짧은 텍스트 중심 (140자~500자)
- 진정성·일상감이 중요
- 답글/대화 유도 콘텐츠가 알고리즘에 유리
- 해시태그 없거나 1-2개만 사용
- 강한 첫 문장(hook)이 핵심
- 공감, 정보, 질문, 스토리 형식이 효과적
- 브랜드 계정도 개인처럼 캐주얼하게 말해야 함

반드시 유효한 JSON만 출력하세요. 마크다운 코드블록 없이 순수 JSON.`;

export async function POST(req: NextRequest) {
  const { keywords, brand = "paulvice" } = await req.json();

  const brandConfig = BRANDS[brand as BrandId] ?? BRANDS.paulvice;
  const kw = keywords ?? brandConfig.defaultKeywords;
  const client = getClient();

  const system = `당신은 한국 쓰레드(Threads) 콘텐츠 마케팅 전문가입니다.
${brandConfig.analyzeContext}
${brandConfig.description}
${PLATFORM_CONTEXT}`;

  const prompt = `다음 키워드 관련 쓰레드(Threads)에서 바이럴되는 콘텐츠 패턴을 분석해주세요.
키워드: ${kw.join(", ")}

${brandConfig.name} 브랜드 관점에서 활용할 수 있는 인사이트를 포함해서 분석하세요.

반드시 아래 JSON 구조로만 응답하세요:
{
  "formats": [
    {
      "name": "형식명",
      "description": "이 형식이 왜 잘 되는지 설명",
      "example": "실제 쓰레드 스타일의 예시 글 (한국어, 자연스럽게)"
    }
  ],
  "hooks": [
    {
      "hook": "후킹 기법명",
      "example": "이 기법을 활용한 첫 문장 예시"
    }
  ],
  "themes": [
    {
      "theme": "테마명",
      "reason": "이 테마가 반응 좋은 이유",
      "brandAngle": "${brandConfig.name}가 이 테마를 활용하는 방법"
    }
  ],
  "insights": [
    "${brandConfig.name} 쓰레드 운영에 바로 쓸 수 있는 인사이트 (구체적으로)"
  ]
}

formats는 6개, hooks는 8개, themes는 5개, insights는 7개 이상 제시하세요.`;

  try {
    const res = await client.messages.create({
      model:      "claude-opus-4-5",
      max_tokens: 4000,
      system,
      messages:   [{ role: "user", content: prompt }],
    });

    const raw = (res.content[0] as { text: string }).text.trim();
    const json = raw.startsWith("{") ? JSON.parse(raw) : JSON.parse(raw.replace(/^```json\n?/, "").replace(/\n?```$/, ""));

    return Response.json({
      keywords: kw,
      brand,
      generatedAt: new Date().toISOString(),
      ...json,
    });
  } catch (e: any) {
    return Response.json({ error: e.message ?? "분석 실패" }, { status: 500 });
  }
}
