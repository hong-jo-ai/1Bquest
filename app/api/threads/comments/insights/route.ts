import Anthropic from "@anthropic-ai/sdk";
import { type NextRequest } from "next/server";
import { BRANDS, type BrandId } from "@/lib/threadsBrands";

function getClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY 없음");
  return new Anthropic({ apiKey });
}

/**
 * POST /api/threads/comments/insights
 * Body: { posts: Array<{text, comments: Array<{username, text}>}>, brand: BrandId }
 *
 * 전체 댓글을 분석해서 콘텐츠 인사이트 & 아이디어 제안
 */
export async function POST(req: NextRequest) {
  const { posts, brand = "paulvice" } = await req.json();

  if (!posts?.length) {
    return Response.json({ error: "분석할 댓글이 없습니다" }, { status: 400 });
  }

  const brandConfig = BRANDS[brand as BrandId] ?? BRANDS.paulvice;
  const client = getClient();

  const postsWithComments = posts
    .map((p: { text: string; comments: Array<{ username: string; text: string }> }, i: number) => {
      const commentLines = p.comments
        .map((c: { username: string; text: string }) => `  - @${c.username}: ${c.text}`)
        .join("\n");
      return `[게시물 ${i + 1}] "${p.text}"\n댓글:\n${commentLines}`;
    })
    .join("\n\n");

  const system = `${brandConfig.systemPrompt}

당신은 브랜드의 Threads 댓글을 분석해서 콘텐츠 전략 인사이트를 도출하는 분석가입니다.
댓글에서 팔로워들이 진짜 관심 있는 주제, 자주 묻는 질문, 감정 패턴, 숨은 니즈를 파악하세요.
반드시 유효한 JSON만 출력하세요.`;

  const prompt = `아래는 최근 게시물들과 댓글들입니다. 분석해서 다음 콘텐츠에 활용할 인사이트를 도출해주세요.

${postsWithComments}

아래 JSON으로 응답하세요:
{
  "summary": "댓글 전체 트렌드 요약 (2-3문장)",
  "themes": [
    {
      "theme": "팔로워들이 관심 보인 주제/키워드",
      "count": "관련 댓글 수 (대략적)",
      "examples": ["대표적인 댓글 1-2개"]
    }
  ],
  "questions": ["팔로워들이 자주 한 질문들"],
  "sentiments": {
    "positive": "긍정적 반응 요약",
    "curious": "궁금해하는 것 요약",
    "requests": "요청/제안 사항 요약"
  },
  "contentIdeas": [
    {
      "topic": "제안하는 콘텐츠 주제",
      "why": "왜 이 주제가 좋은지 (댓글 근거)",
      "style": "추천 스타일 (공감형/정보형/질문형/스토리형/선언형/감성형)",
      "hook": "후킹 포인트 예시"
    }
  ]
}

themes는 3-5개, contentIdeas는 5개로 제안해주세요.
각 항목은 간결하게 작성하세요. 긴 설명 불필요. JSON만 출력.`;

  try {
    const res = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 6000,
      system,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = (res.content[0] as { text: string }).text.trim();
    let cleaned = raw.startsWith("{") ? raw : raw.replace(/^```json\n?/, "").replace(/\n?```$/, "");

    // 잘린 JSON 복구 시도: 열린 괄호 수만큼 닫기
    let json: any;
    try {
      json = JSON.parse(cleaned);
    } catch {
      // 잘린 문자열 정리: 마지막 유효한 위치까지 자르고 닫기
      const lastBrace = cleaned.lastIndexOf("}");
      const lastBracket = cleaned.lastIndexOf("]");
      const cutPos = Math.max(lastBrace, lastBracket);
      if (cutPos > 0) {
        cleaned = cleaned.slice(0, cutPos + 1);
        // 열린 괄호 카운트로 닫기
        const opens = (cleaned.match(/[{[]/g) || []).length;
        const closes = (cleaned.match(/[}\]]/g) || []).length;
        for (let i = 0; i < opens - closes; i++) {
          cleaned += cleaned.lastIndexOf("[") > cleaned.lastIndexOf("{") ? "]" : "}";
        }
      }
      json = JSON.parse(cleaned);
    }

    return Response.json({ insights: json });
  } catch (e: any) {
    return Response.json({ error: e.message ?? "분석 실패" }, { status: 500 });
  }
}
