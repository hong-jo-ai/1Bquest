/**
 * 음성 전사(STT) 공용 헬퍼 — OpenAI.
 * 모리 녹음 라우트(app/api/mori/transcribe)와 텔레그램 음성메시지 처리(webhook)가 공유.
 * gpt-4o-transcribe 우선, webm/ogg 컨테이너를 400으로 거부하면 whisper-1로 폴백.
 */

// 브랜드/운영 고유명사를 살리는 전사 힌트.
export const STT_PROMPT =
  "폴바이스(PAULVICE), 해리엇워치스, 미니엘, 에끌라, 에골라 오벌, 오드리, 각인, 매출, 광고, ROAS, MADS, 광고세트, 재고, 발주, 공동구매, 카페24, 무신사, W컨셉, 29CM, 식스샵, 우체국, 송장, 반품, 클로드.";

const PRIMARY = "gpt-4o-transcribe";
const FALLBACK = "whisper-1";

function extFor(mime: string): string {
  if (mime.includes("mp4") || mime.includes("m4a")) return "mp4";
  if (mime.includes("ogg") || mime.includes("oga")) return "ogg";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  return "webm";
}

async function call(key: string, file: File, model: string): Promise<Response> {
  const form = new FormData();
  form.append("file", file);
  form.append("model", model);
  form.append("language", "ko");
  form.append("prompt", STT_PROMPT);
  return fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
}

/** base64 오디오 → 한국어 전사 텍스트. 실패 시 throw. */
export async function transcribeAudio(audioBase64: string, mimeType?: string): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY 없음");

  const cleanType = (mimeType || "audio/webm").split(";")[0].trim() || "audio/webm";
  const u8 = new Uint8Array(Buffer.from(audioBase64, "base64"));
  if (u8.byteLength === 0) throw new Error("오디오 비어있음");
  const file = new File([u8], `audio.${extFor(cleanType)}`, { type: cleanType });

  let r = await call(key, file, PRIMARY);
  if (r.status === 400) r = await call(key, file, FALLBACK);
  if (!r.ok) {
    const detail = (await r.text()).slice(0, 300);
    throw new Error(`전사 실패(${r.status}): ${detail}`);
  }
  const j = (await r.json()) as { text?: string };
  return (j.text ?? "").trim();
}
