import Anthropic from "@anthropic-ai/sdk";
import { type NextRequest } from "next/server";
import { BRANDS, type BrandId } from "@/lib/threadsBrands";

function getClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY 없음");
  return new Anthropic({ apiKey });
}

const LENGTH_GUIDE: Record<string, string> = {
  short:  "1-2문장으로 짧고 임팩트 있게. 한 줄로 꽂히는 글.",
  medium: "3-5문장이 최적. 핵심을 전달하되 너무 길지 않게.",
  long:   "6문장 이상. 스토리텔링이나 깊은 정보를 전달하는 긴 글. 단락을 나눠서 읽기 편하게.",
};

const WRITING_RULES = `
Threads 글쓰기 규칙:
- 첫 문장이 핵심 (스크롤 멈추는 hook)
- 해시태그 0-2개 (없어도 됨)
- 브랜드 냄새 너무 강하면 도망감 — 자연스럽게
- 이모지는 1-2개만 (과하면 촌스러움)
- 마케팅 문구 X, 사람 말 O

반드시 유효한 JSON만 출력하세요.`;

export async function POST(req: NextRequest) {
  const {
    topic,
    style,
    count = 5,
    customContext = "",
    brand = "paulvice",
    length = "medium",
  } = await req.json();

  const brandConfig = BRANDS[brand as BrandId] ?? BRANDS.paulvice;
  const client = getClient();
  const lengthGuide = LENGTH_GUIDE[length] ?? LENGTH_GUIDE.medium;

  const system = `${brandConfig.systemPrompt}

당신은 이 브랜드의 Threads 콘텐츠 전문가입니다.
글을 작성하기 전에 해당 주제에 대한 현재 Threads 트렌드를 자동 분석하세요:
- 이 주제로 어떤 형식의 글이 잘 되는지
- 어떤 hook이 효과적인지
- 타겟 독자가 공감할 포인트가 무엇인지

이 트렌드 분석을 기반으로 글을 작성하세요.

글 길이 기준: ${lengthGuide}

${WRITING_RULES}`;

  const customCtx = customContext ? `\n추가 맥락: ${customContext}` : "";

  const prompt = `${brandConfig.name} 쓰레드 글을 ${count}개 작성해주세요.

주제: ${topic}
스타일: ${style}
길이: ${length === "short" ? "짧게 (1-2문장)" : length === "long" ? "길게 (6문장 이상)" : "보통 (3-5문장)"}${customCtx}

먼저 이 주제에 대한 Threads 트렌드를 빠르게 분석한 뒤, 그 인사이트를 반영해서 글을 작성하세요.
각 글은 서로 다른 접근법, 다른 hook을 사용하세요.

아래 JSON 배열로만 응답하세요:
[
  {
    "text": "실제 쓰레드에 그대로 올릴 수 있는 완성된 글",
    "style": "${style}",
    "topic": "${topic}",
    "hook": "이 글의 후킹 포인트 — 왜 스크롤을 멈추게 되는지",
    "whyItWorks": "이 글이 반응을 이끌어낼 이유 (구체적으로)"
  }
]`;

  try {
    const res = await client.messages.create({
      model:      "claude-haiku-4-5",
      max_tokens: length === "long" ? 5000 : 3000,
      system,
      messages:   [{ role: "user", content: prompt }],
    });

    const raw = (res.content[0] as { text: string }).text.trim();
    const json = raw.startsWith("[") ? JSON.parse(raw) : JSON.parse(raw.replace(/^```json\n?/, "").replace(/\n?```$/, ""));

    return Response.json({ posts: json });
  } catch (e: any) {
    return Response.json({ error: e.message ?? "생성 실패" }, { status: 500 });
  }
}
