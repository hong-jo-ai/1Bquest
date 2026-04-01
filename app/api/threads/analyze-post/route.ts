import Anthropic from "@anthropic-ai/sdk";
import { type NextRequest } from "next/server";

function getClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY 없음");
  return new Anthropic({ apiKey });
}

// ── Threads 공개 글 가져오기 시도 ──────────────────────────────────────────

async function tryFetchThreadsPost(url: string): Promise<string | null> {
  try {
    // threads.net 공개 글 HTML에서 og:description 추출
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "ko-KR,ko;q=0.9",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const html = await res.text();

    // og:description에 글 내용이 들어있는 경우
    const ogDesc = html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i);
    if (ogDesc?.[1]) return decodeHTMLEntities(ogDesc[1]);

    // JSON-LD에서 description 추출
    const jsonLd = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i);
    if (jsonLd?.[1]) {
      const data = JSON.parse(jsonLd[1]);
      if (data.description) return data.description;
    }
    return null;
  } catch {
    return null;
  }
}

function decodeHTMLEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
}

// ── AI 분석 ───────────────────────────────────────────────────────────────

const SYSTEM = `당신은 한국 쓰레드(Threads) 콘텐츠 분석 전문가입니다.
폴바이스(PAULVICE) — 20~30대 직장 여성 타겟 여성 시계 브랜드 — 의 관점에서 분석하세요.
반드시 유효한 JSON만 출력하세요.`;

export async function POST(req: NextRequest) {
  const { text: rawText, url } = await req.json();

  let text = rawText?.trim() ?? "";

  // URL이 있고 텍스트가 없으면 자동 fetch 시도
  if (!text && url) {
    const fetched = await tryFetchThreadsPost(url);
    if (fetched) text = fetched;
  }

  if (!text) {
    return Response.json({ error: "분석할 글 내용이 없습니다" }, { status: 400 });
  }

  const client = getClient();

  const prompt = `다음 쓰레드(Threads) 글을 분석하세요.

--- 원문 ---
${text}
-----------

아래 JSON 구조로만 응답하세요:
{
  "category": "패션|시계|주얼리|패션잡화|브랜드|라이프스타일|기타 중 하나",
  "hook": "첫 문장이나 도입부의 후킹 방식 (2-3문장 설명)",
  "format": "공감형|정보형|질문형|스토리형|선언형|감성형 중 가장 가까운 것",
  "tone": "글의 톤과 분위기 설명",
  "drivers": ["반응 유발 요소 1", "반응 유발 요소 2", "반응 유발 요소 3"],
  "lesson": "폴바이스가 이 글에서 배워서 적용할 수 있는 핵심 인사이트 (구체적으로)"
}`;

  try {
    const res = await client.messages.create({
      model:      "claude-haiku-4-5",
      max_tokens: 800,
      system:     SYSTEM,
      messages:   [{ role: "user", content: prompt }],
    });

    const raw = (res.content[0] as { text: string }).text.trim();
    const json = raw.startsWith("{") ? JSON.parse(raw) : JSON.parse(raw.replace(/^```json\n?/, "").replace(/\n?```$/, ""));

    return Response.json({ text, url, ...json });
  } catch (e: any) {
    return Response.json({ error: e.message ?? "분석 실패" }, { status: 500 });
  }
}
