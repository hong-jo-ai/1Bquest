import Anthropic from "@anthropic-ai/sdk";
import { type NextRequest } from "next/server";
import { BRANDS, type BrandId } from "@/lib/threadsBrands";
import { readFileSync } from "fs";
import { join } from "path";

function getClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY 없음");
  return new Anthropic({ apiKey });
}

/**
 * POST /api/threads/comments/generate-reply
 * Body: { comments: Array<{username, text}>, postText: string, brand: BrandId }
 *
 * 댓글들을 분석하고 브랜드 톤에 맞는 대댓글 생성
 */
export async function POST(req: NextRequest) {
  const { comments, postText, brand = "paulvice" } = await req.json();

  if (!comments?.length) {
    return Response.json({ error: "댓글이 없습니다" }, { status: 400 });
  }

  const brandConfig = BRANDS[brand as BrandId] ?? BRANDS.paulvice;
  const client = getClient();

  // 대댓글 가이드 파일 읽기
  let replyGuide = "";
  try {
    replyGuide = readFileSync(join(process.cwd(), "config/threads-reply-guide.md"), "utf-8");
  } catch {
    replyGuide = "";
  }

  const commentList = comments
    .map((c: { username: string; text: string }, i: number) => `[${i + 1}] @${c.username}: ${c.text}`)
    .join("\n");

  const system = `${brandConfig.systemPrompt}

당신은 이 브랜드의 Threads 계정에서 팔로워들의 댓글에 대댓글을 작성하는 역할입니다.

${replyGuide || `대댓글 작성 규칙:
- 진심 어린 반응 (기계적 답변 절대 금지)
- 댓글 내용에 맞는 구체적인 답변 (복붙 느낌 X)
- 브랜드 톤 유지하되 너무 격식적이지 않게
- 짧고 자연스럽게 (1-2문장 최적)
- 질문에는 정보를 포함한 답변
- 칭찬/공감에는 감사 + 추가 대화 유도
- 이모지 0-1개 (과하지 않게)
- 절대 홍보성 문구 삽입하지 않기
- @username 멘션 하지 않기 (Threads가 자동으로 처리)`}

반드시 유효한 JSON만 출력하세요.`;

  const prompt = `아래는 내 게시물과 그에 달린 댓글들입니다. 각 댓글에 적절한 대댓글을 작성해주세요.

내 게시물:
"${postText}"

댓글들:
${commentList}

각 댓글에 대한 대댓글을 아래 JSON 배열로 응답하세요:
[
  {
    "commentIndex": 1,
    "username": "댓글 작성자",
    "originalComment": "원래 댓글 내용",
    "reply": "대댓글 내용"
  }
]`;

  try {
    const res = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 2000,
      system,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = (res.content[0] as { text: string }).text.trim();
    const json = raw.startsWith("[")
      ? JSON.parse(raw)
      : JSON.parse(raw.replace(/^```json\n?/, "").replace(/\n?```$/, ""));

    return Response.json({ replies: json });
  } catch (e: any) {
    return Response.json({ error: e.message ?? "생성 실패" }, { status: 500 });
  }
}
