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
 * POST /api/threads/comments/polish
 * Body: { draft: string, originalComment: string, postText: string, brand: BrandId }
 *
 * 사용자가 작성한 대댓글 초안을 브랜드 톤에 맞게 다듬기
 */
export async function POST(req: NextRequest) {
  const { draft, originalComment, postText, brand = "paulvice" } = await req.json();

  if (!draft?.trim()) {
    return Response.json({ error: "다듬을 초안이 없습니다" }, { status: 400 });
  }

  const brandConfig = BRANDS[brand as BrandId] ?? BRANDS.paulvice;
  const client = getClient();

  let replyGuide = "";
  try {
    replyGuide = readFileSync(join(process.cwd(), "config/threads-reply-guide.md"), "utf-8");
  } catch {}

  const system = `${brandConfig.systemPrompt}

당신은 브랜드 담당자가 작성한 대댓글 초안을 다듬어주는 역할입니다.

${replyGuide || `대댓글 다듬기 규칙:
- 원래 의도와 핵심 메시지를 유지
- 브랜드 톤에 맞게 자연스럽게 수정
- 짧고 임팩트 있게 (1-2문장)
- 이모지 0-1개
- @username 멘션 하지 않기`}

중요: 초안의 의도를 최대한 살리되, 표현만 더 자연스럽고 매력적으로 다듬어주세요.
다듬어진 텍스트만 출력하세요. JSON이나 설명 없이 텍스트만.`;

  const prompt = `내 게시물: "${postText}"
상대방 댓글: "${originalComment}"
내 대댓글 초안: "${draft}"

이 초안을 브랜드 톤에 맞게 다듬어주세요. 다듬어진 텍스트만 출력하세요.`;

  try {
    const res = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 500,
      system,
      messages: [{ role: "user", content: prompt }],
    });

    const polished = (res.content[0] as { text: string }).text.trim();
    return Response.json({ polished });
  } catch (e: any) {
    return Response.json({ error: e.message ?? "다듬기 실패" }, { status: 500 });
  }
}
