import Anthropic from "@anthropic-ai/sdk";
import { type NextRequest } from "next/server";
import { BRANDS, type BrandId } from "@/lib/threadsBrands";

function getClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY 없음");
  return new Anthropic({ apiKey });
}

const WRITING_RULES = `
Threads 글쓰기 규칙:
- 첫 문장이 핵심 (스크롤 멈추는 hook)
- 2-5문장이 최적 (너무 길면 안 읽음)
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
    references = [],
    customContext = "",
    brand = "paulvice",
  } = await req.json();

  const brandConfig = BRANDS[brand as BrandId] ?? BRANDS.paulvice;
  const client = getClient();

  const system = `${brandConfig.systemPrompt}\n${WRITING_RULES}`;

  const refContext = references.length > 0
    ? `\n참고할 레퍼런스 글들:\n${references.map((r: string, i: number) => `[${i + 1}] ${r}`).join("\n")}`
    : "";

  const customCtx = customContext ? `\n추가 맥락: ${customContext}` : "";

  const prompt = `${brandConfig.name} 쓰레드 글을 ${count}개 작성해주세요.

주제: ${topic}
스타일: ${style}${refContext}${customCtx}

각 글은 서로 다른 접근법, 다른 hook을 사용하세요.
같은 스타일 내에서도 다양한 변형을 보여주세요.

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
      model:      "claude-opus-4-5",
      max_tokens: 3000,
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
