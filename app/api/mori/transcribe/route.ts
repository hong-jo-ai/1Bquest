/**
 * 모리 음성 전사 — OpenAI STT (공용 헬퍼 lib/mori/stt.ts 래퍼).
 *
 * 클라이언트가 녹음한 오디오(base64 + mimeType)를 받아 한국어로 전사한다.
 * 브라우저 MediaRecorder는 webm/opus(크롬)·mp4(사파리)를 내보낸다.
 *
 * 입력(JSON): { audio: <base64>, mimeType: "audio/webm" 등 }
 * 출력: { text } 또는 { error }
 */

import { type NextRequest } from "next/server";
import { transcribeAudio } from "@/lib/mori/stt";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { audio, mimeType } = (await req.json()) as { audio?: string; mimeType?: string };
  if (!audio) return Response.json({ error: "audio 비어있음" }, { status: 400 });
  try {
    const text = await transcribeAudio(audio, mimeType);
    return Response.json({ text });
  } catch (e: any) {
    return Response.json({ error: e?.message ?? "전사 실패" }, { status: 500 });
  }
}
