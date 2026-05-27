/**
 * 모리 음성 전사 — OpenAI STT.
 *
 * 클라이언트가 녹음한 오디오(base64 + mimeType)를 받아 한국어로 전사한다.
 * 브라우저 MediaRecorder는 webm/opus(크롬)·mp4(사파리)를 내보낸다.
 * 기본 gpt-4o-transcribe로 시도하고, 이 모델이 webm 컨테이너를 400으로 거부하면
 * 가장 호환성 좋은 whisper-1로 자동 폴백한다. (OPENAI_API_KEY는 TTS와 공유.)
 *
 * 입력(JSON): { audio: <base64>, mimeType: "audio/webm" 등 }
 * 출력: { text } 또는 { error }
 */

import { type NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PRIMARY = "gpt-4o-transcribe";
const FALLBACK = "whisper-1";

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

async function transcribe(key: string, file: File, model: string): Promise<Response> {
  const form = new FormData();
  form.append("file", file);
  form.append("model", model);
  form.append("language", "ko");
  form.append("prompt", PROMPT);
  return fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
}

export async function POST(req: NextRequest) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return Response.json({ error: "OPENAI_API_KEY 없음" }, { status: 500 });

  const { audio, mimeType } = (await req.json()) as { audio?: string; mimeType?: string };
  if (!audio) return Response.json({ error: "audio 비어있음" }, { status: 400 });

  try {
    // codecs 파라미터 제거(`audio/webm;codecs=opus` → `audio/webm`).
    const cleanType = (mimeType || "audio/webm").split(";")[0].trim() || "audio/webm";
    // Node Buffer를 그대로 Blob에 넣으면 멀티파트가 깨질 수 있어 Uint8Array로 복사.
    const u8 = new Uint8Array(Buffer.from(audio, "base64"));
    if (u8.byteLength === 0) return Response.json({ error: "오디오 비어있음" }, { status: 400 });
    const file = new File([u8], `audio.${extFor(cleanType)}`, { type: cleanType });

    let r = await transcribe(key, file, PRIMARY);
    // gpt-4o-transcribe가 이 컨테이너를 400으로 거부하면 whisper-1로 한 번 더.
    if (r.status === 400) r = await transcribe(key, file, FALLBACK);

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
