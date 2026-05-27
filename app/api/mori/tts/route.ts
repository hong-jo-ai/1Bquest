/**
 * 모리 음성 출력 — Gemini TTS.
 *
 * POST {text} → Gemini(gemini-2.5-flash-preview-tts) 음성 합성 → WAV 바이트 반환.
 * Gemini는 raw PCM(L16, 보통 24kHz mono)을 주므로 서버에서 WAV 컨테이너로 감싼다.
 * 클라이언트는 Web Audio로 재생하며 AnalyserNode로 진폭을 뽑아 구체에 연동.
 *
 * ElevenLabs 대체 — GEMINI_API_KEY 재사용(별도 키/구독 불필요, 종량 저렴).
 */

import { GoogleGenAI } from "@google/genai";
import { type NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODEL = "gemini-2.5-flash-preview-tts";
const VOICE = process.env.MORI_TTS_VOICE ?? "Kore"; // 차분·또렷 (COO 톤)

function parseRate(mime: string | undefined): number {
  const m = mime?.match(/rate=(\d+)/);
  return m ? parseInt(m[1], 10) : 24000;
}

/** raw PCM(s16le, mono) → WAV 버퍼. */
function pcmToWav(pcm: Buffer, sampleRate: number, channels = 1, bps = 16): Buffer {
  const blockAlign = (channels * bps) / 8;
  const byteRate = sampleRate * blockAlign;
  const buf = Buffer.alloc(44 + pcm.length);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + pcm.length, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(bps, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(pcm.length, 40);
  pcm.copy(buf, 44);
  return buf;
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return Response.json({ error: "GEMINI_API_KEY 없음" }, { status: 500 });

  const { text } = (await req.json()) as { text?: string };
  const t = (text ?? "").trim();
  if (!t) return Response.json({ error: "text 비어있음" }, { status: 400 });

  try {
    const ai = new GoogleGenAI({ apiKey });
    const res = await ai.models.generateContent({
      model: MODEL,
      // 전달 톤 힌트 + 본문
      contents: [{ role: "user", parts: [{ text: `정중하고 자연스러운 톤으로, 너무 느리지 않게 약간 경쾌하게 읽어줘:\n${t}` }] }],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } },
      } as any,
    });

    const part = res.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
    const inline = (part as any)?.inlineData;
    if (!inline?.data) return Response.json({ error: "오디오 생성 실패" }, { status: 500 });

    const pcm = Buffer.from(inline.data, "base64");
    const wav = pcmToWav(pcm, parseRate(inline.mimeType));
    return new Response(new Uint8Array(wav), {
      headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store" },
    });
  } catch (e: any) {
    return Response.json({ error: e?.message ?? "TTS 실패" }, { status: 500 });
  }
}
