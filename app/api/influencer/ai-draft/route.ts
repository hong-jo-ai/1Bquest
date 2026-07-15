/**
 * 인플루언서 맞춤 DM 초안 생성 (Phase 3).
 * 인플루언서 컨텍스트(이름·카테고리·팔로워)로 Claude가 협찬/팔로업 제안 DM 초안을 쓴다.
 * ANTHROPIC_API_KEY 없으면 템플릿으로 폴백.
 */
import { type NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getInfluencerByHandle } from "@/lib/influencer/register";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const SYSTEM = `당신은 폴바이스(PAULVICE) 협찬 담당자입니다. 폴바이스는 국내 30~40대 여성 타깃의 미니멀·모노톤 감성 시계(가죽 스트랩) 브랜드입니다.
인스타그램 인플루언서에게 보낼 협찬 제안/팔로업 DM 초안을 작성하세요.

원칙:
- 진정성 있고 정중하게. 스팸·복붙 느낌 금지.
- 상대의 콘텐츠·감성을 존중하고 한 문장으로 구체적으로 언급(카테고리 활용).
- 과장·이모지 남발 금지(이모지 0~1개). 4~6문장으로 짧게.
- 제품은 "시계(가죽 스트랩)" 정도로만, 조건(무료 제공)은 담백하게.
- 한국어 존댓말. 마지막 줄 서명은 "폴바이스 드림".
- 링크·해시태그·가격 언급 금지.
초안 본문만 출력(설명·따옴표 없이).`;

function fallbackTemplate(kind: string, name: string): string {
  if (kind === "followup") {
    return `${name}님 안녕하세요, 폴바이스입니다 :)\n지난번 조심스레 제안드렸던 협찬 관련해 혹시 검토해보셨을까 해서 다시 인사드려요. 부담 없이 편하게 알려주시면 감사하겠습니다.\n폴바이스 드림`;
  }
  return `${name}님 안녕하세요, 폴바이스입니다.\n${name}님의 감성과 저희 브랜드가 잘 어울릴 것 같아 조심스레 협찬 제안 드려요. 미니멀한 감성의 시계를 무료로 보내드리고 싶습니다.\n관심 있으시면 편히 답장 주세요. 감사합니다.\n폴바이스 드림`;
}

export async function POST(req: NextRequest) {
  let body: { handle?: string; kind?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "잘못된 본문" }, { status: 400 });
  }
  const handle = String(body.handle ?? "").replace(/^@/, "").trim();
  const kind = body.kind === "followup" ? "followup" : "initial";
  if (!handle) return Response.json({ ok: false, error: "handle 필요" }, { status: 400 });

  const inf = await getInfluencerByHandle(handle);
  const name = inf?.name || handle;
  const cats = (inf?.categories ?? []).join(", ") || "라이프스타일";
  const followers = inf?.followers ?? 0;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({ ok: true, draft: fallbackTemplate(kind, name), source: "template" });
  }

  const userPrompt =
    kind === "followup"
      ? `이전에 협찬 제안 DM을 보냈으나 답이 없는 인플루언서에게 보낼 가벼운 팔로업 DM.\n이름/닉: ${name} (@${handle})\n콘텐츠 카테고리: ${cats}\n팔로워: ${followers.toLocaleString()}\n부담 없이 한 번 더 관심을 여쭙는 톤으로.`
      : `첫 협찬 제안 DM.\n이름/닉: ${name} (@${handle})\n콘텐츠 카테고리: ${cats}\n팔로워: ${followers.toLocaleString()}`;

  try {
    const client = new Anthropic({ apiKey });
    const resp = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 600,
      system: SYSTEM,
      messages: [{ role: "user", content: userPrompt }],
    });
    // sonnet-5 는 thinking 블록을 먼저 넣을 수 있으므로 text 블록을 찾아 꺼낸다.
    const textBlock = resp.content.find((c) => c.type === "text");
    const text = textBlock && textBlock.type === "text" ? textBlock.text.trim() : "";
    if (!text) return Response.json({ ok: true, draft: fallbackTemplate(kind, name), source: "template" });
    return Response.json({ ok: true, draft: text, source: "ai" });
  } catch (e) {
    return Response.json({
      ok: true,
      draft: fallbackTemplate(kind, name),
      source: "template",
      warn: e instanceof Error ? e.message : String(e),
    });
  }
}
