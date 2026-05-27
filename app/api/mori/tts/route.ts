/**
 * 모리 음성 출력 — OpenAI 신경망 TTS(gpt-4o-mini-tts).
 *
 * POST {text} → OpenAI /v1/audio/speech → mp3 바이트 반환.
 * 자연스러운 음성 + 낮은 지연(짧은 문장 단위로 호출하므로 첫 소리까지 빠름).
 * 클라이언트는 Web Audio로 재생하며 AnalyserNode로 진폭을 뽑아 구체에 연동.
 *
 * 필요: OPENAI_API_KEY (환경변수). 보이스는 MORI_OPENAI_VOICE로 교체 가능(기본 sage).
 */

import { type NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODEL = "gpt-4o-mini-tts";
const VOICE = process.env.MORI_OPENAI_VOICE ?? "sage";

export async function POST(req: NextRequest) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return Response.json({ error: "OPENAI_API_KEY 없음" }, { status: 500 });

  const { text } = (await req.json()) as { text?: string };
  const t = (text ?? "").trim();
  if (!t) return Response.json({ error: "text 비어있음" }, { status: 400 });

  try {
    const r = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        voice: VOICE,
        input: t,
        response_format: "mp3",
        instructions:
          "정중하고 자연스러운 한국어 여성 비서 톤. 차분하지만 너무 느리지 않게, 약간 또렷하고 신뢰감 있게.",
      }),
    });
    if (!r.ok) {
      const e = await r.text().catch(() => "");
      return Response.json({ error: `OpenAI TTS 실패: ${r.status} ${e.slice(0, 200)}` }, { status: 500 });
    }
    const ab = await r.arrayBuffer();
    return new Response(ab, {
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
    });
  } catch (e: any) {
    return Response.json({ error: e?.message ?? "TTS 실패" }, { status: 500 });
  }
}
