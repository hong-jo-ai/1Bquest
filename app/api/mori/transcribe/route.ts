/**
 * 모리 음성 전사 — OpenAI(gpt-4o-transcribe) STT.
 *
 * 클라이언트가 녹음한 오디오(base64 + mimeType)를 받아 한국어로 전사한다.
 * 브라우저 MediaRecorder는 webm/opus(크롬)·mp4(사파리)를 내보내는데, OpenAI 전사
 * 엔드포인트는 이를 그대로 받는다. (이전 Gemini inlineData는 webm 미지원이라 무음
 * 실패가 났음 — TTS에서 쓰는 OPENAI_API_KEY 재사용.)
 *
 * 입력(JSON): { audio: <base64>, mimeType: "audio/webm" 등 }
 * 출력: { text } 또는 { error }
 */

import { type NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODEL = "gpt-4o-transcribe";

// 브랜드/운영 고유명사를 살리는 전사 힌트(prompt).
const PROMPT =
  "폴바이스(PAULVICE), 해리엇워치스, 미니엘, 에끌라, 에골라 오벌, 오드리, 각인, 매출, 광고, ROAS, MADS, 광고세트, 재고, 발주, 공동구매, 카페24.";

function extFor(mime: string): string {
  if (mime.includes("mp4") || mime.includes("m4a")) return "mp4";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  return "webm";
}

export async function POST(req: NextRequest) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return Response.json({ error: "OPENAI_API_KEY 없음" }, { status: 500 });

  const { audio, mimeType } = (await req.json()) as { audio?: string; mimeType?: string };
  if (!audio) return Response.json({ error: "audio 비어있음" }, { status: 400 });

  try {
    const type = mimeType || "audio/webm";
    const bytes = Buffer.from(audio, "base64");
    if (bytes.length === 0) return Response.json({ error: "오디오 비어있음" }, { status: 400 });

    const form = new FormData();
    form.append("file", new Blob([bytes], { type }), `audio.${extFor(type)}`);
    form.append("model", MODEL);
    form.append("language", "ko");
    form.append("prompt", PROMPT);

    const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });

    if (!r.ok) {
      const detail = (await r.text()).slice(0, 300);
      return Response.json({ error: `전사 실패(${r.status}): ${detail}` }, { status: 500 });
    }

    const j = (await r.json()) as { text?: string };
    return Response.json({ text: (j.text ?? "").trim() });
  } catch (e: any) {
    return Response.json({ error: e?.message ?? "전사 실패" }, { status: 500 });
  }
}
