/**
 * 모리 음성 전사 — Gemini(gemini-2.5-flash) STT.
 *
 * 클라이언트가 녹음한 오디오(base64 + mimeType)를 받아 한국어로 전사한다.
 * 스펙의 Whisper 대체 — GEMINI_API_KEY 재사용(별도 키 불필요, 한국어·고유명사 양호).
 *
 * 입력(JSON): { audio: <base64>, mimeType: "audio/webm" 등 }
 * 출력: { text } 또는 { error }
 */

import { GoogleGenAI } from "@google/genai";
import { type NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODEL = "gemini-2.5-flash";

const HINT = `다음 오디오를 한국어로 정확히 전사하라. 받아쓰기만 하고 다른 말은 붙이지 마라.
- 브랜드/제품 고유명사를 살려라: 폴바이스(PAULVICE), 해리엇(해리엇워치스), 미니엘, 에끌라/에골라 오벌, 오드리, 각인.
- 운영 용어: 매출, 광고, ROAS, MADS, 광고세트, 재고, 발주, 공동구매, 카페24.
- 들리는 그대로의 문장만 출력. 추측·요약·인사말 금지. 비어있으면 빈 문자열.`;

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return Response.json({ error: "GEMINI_API_KEY 없음" }, { status: 500 });

  const { audio, mimeType } = (await req.json()) as { audio?: string; mimeType?: string };
  if (!audio) return Response.json({ error: "audio 비어있음" }, { status: 400 });

  try {
    const ai = new GoogleGenAI({ apiKey });
    const res = await ai.models.generateContent({
      model: MODEL,
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: mimeType || "audio/webm", data: audio } },
            { text: HINT },
          ],
        },
      ],
      config: { maxOutputTokens: 1024, thinkingConfig: { thinkingBudget: 0 } },
    });
    const text = (res.candidates?.[0]?.content?.parts?.[0]?.text ?? "").trim();
    return Response.json({ text });
  } catch (e: any) {
    return Response.json({ error: e?.message ?? "전사 실패" }, { status: 500 });
  }
}
