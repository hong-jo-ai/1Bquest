/**
 * 모리 음성 출력 — OpenAI 신경망 TTS(gpt-4o-mini-tts).
 *
 * POST {text} → OpenAI /v1/audio/speech → mp3 바이트 반환.
 * 자연스러운 음성 + 낮은 지연(짧은 문장 단위로 호출하므로 첫 소리까지 빠름).
 * 클라이언트는 Web Audio로 재생하며 AnalyserNode로 진폭을 뽑아 구체에 연동.
 *
 * 필요: OPENAI_API_KEY (환경변수). 보이스는 MORI_OPENAI_VOICE로 교체 가능(기본 shimmer).
 */

import { type NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODEL = "gpt-4o-mini-tts";
const VOICE = process.env.MORI_OPENAI_VOICE ?? "shimmer";
const SPEED = Math.min(1.3, Math.max(0.8, Number(process.env.MORI_TTS_SPEED) || 1.08));

const INSTRUCTIONS =
  "한국어로 자연스럽게 말하세요. 뉴스 낭독이나 책 읽는 톤이 아니라, 옆자리에서 업무를 짧게 지시·보고하는 동료 톤입니다. " +
  "문장 끝을 과하게 끌지 말고, 조사는 또렷하게, 숫자는 자연스럽게 끊어 읽으세요. " +
  "밝게 연기하지 말고 차분하고 빠릿하게. 폴바이스, 해리엇, 카페24, MADS는 한국어 대화 속 고유명사처럼 자연스럽게 발음하세요.";

export async function POST(req: NextRequest) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return Response.json({ error: "OPENAI_API_KEY 없음" }, { status: 500 });

  const { text } = (await req.json()) as { text?: string };
  const t = (text ?? "").trim();
  if (!t) return Response.json({ error: "text 비어있음" }, { status: 400 });

  try {
    const payload = {
      model: MODEL,
      voice: VOICE,
      input: t,
      response_format: "mp3",
      speed: SPEED,
      instructions: INSTRUCTIONS,
    };

    let r = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (r.status === 400) {
      const { speed: _speed, ...fallbackPayload } = payload;
      r = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(fallbackPayload),
      });
    }
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
