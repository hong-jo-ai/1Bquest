/**
 * 모리 채팅 — Anthropic 스트리밍(SSE).
 *
 * Week 1: 텍스트만. 매 요청마다 대시보드 state를 새로 직렬화해 system 블록으로 주입(=live).
 * 응답은 `data: {json}\n\n` 형태의 SSE 이벤트로 흘려보낸다.
 *   - { type: "text", text }   토큰 델타
 *   - { type: "done" }         완료
 *   - { type: "error", error } 오류
 */

import Anthropic from "@anthropic-ai/sdk";
import { type NextRequest } from "next/server";
import { buildSystemPrompt } from "@/lib/mori/systemPrompt";
import { assembleDashboardContext } from "@/lib/mori/context";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODEL = process.env.MORI_MODEL ?? "claude-sonnet-4-6";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "ANTHROPIC_API_KEY 없음" }, { status: 500 });
  }

  const { messages } = (await req.json()) as { messages: ChatMessage[] };
  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: "messages 비어있음" }, { status: 400 });
  }

  // 실시간 컨텍스트 — 매 메시지마다 새로 조립("같이 화면 보는" 구조)
  const dashboardContext = await assembleDashboardContext();

  const client = new Anthropic({ apiKey });
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        const ms = client.messages.stream({
          model: MODEL,
          max_tokens: 2048,
          system: [
            { type: "text", text: buildSystemPrompt() },
            { type: "text", text: dashboardContext },
          ],
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
        });

        ms.on("text", (text) => send({ type: "text", text }));

        await ms.finalMessage();
        send({ type: "done" });
      } catch (e: any) {
        send({ type: "error", error: e?.message ?? "스트리밍 오류" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
