/**
 * 모리 채팅 — Anthropic 스트리밍(SSE) + Tool Use 에이전트 루프 + 대화 메모리.
 *
 * Week 2:
 *  - 클라이언트는 { message } 한 줄만 전송. 대화 히스토리는 서버(kv_store)가 SSOT.
 *  - 매 요청마다 대시보드 state를 새로 직렬화해 system 블록으로 주입(live).
 *  - 모델이 tool_use를 내면 서버에서 실행 → widget SSE 푸시 → tool_result 되먹임 → 반복.
 *
 * SSE 이벤트:
 *   { type:"text", text }       토큰 델타
 *   { type:"widget", widget }   위젯 렌더/clear
 *   { type:"done" }             완료
 *   { type:"error", error }     오류
 */

import Anthropic from "@anthropic-ai/sdk";
import { type NextRequest } from "next/server";
import { buildSystemPrompt } from "@/lib/mori/systemPrompt";
import { assembleDashboardContext } from "@/lib/mori/context";
import { loadConversation, appendTurn } from "@/lib/mori/memory";
import { TOOL_DEFS, executeTool } from "@/lib/mori/tools";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODEL = process.env.MORI_MODEL ?? "claude-sonnet-4-6";
const MAX_HISTORY = 40; // 모델에 보내는 직전 대화 수
const MAX_TOOL_LOOPS = 5;

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return Response.json({ error: "ANTHROPIC_API_KEY 없음" }, { status: 500 });

  const { message } = (await req.json()) as { message?: string };
  const userText = (message ?? "").trim();
  if (!userText) return Response.json({ error: "message 비어있음" }, { status: 400 });

  // 메모리에서 히스토리 로드 + 실시간 컨텍스트 조립(병렬)
  const [history, dashboardContext] = await Promise.all([
    loadConversation(),
    assembleDashboardContext(),
  ]);

  const convo: Anthropic.MessageParam[] = history
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.content }));
  convo.push({ role: "user", content: userText });

  const client = new Anthropic({ apiKey });
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      let assistantText = "";
      try {
        for (let loop = 0; loop < MAX_TOOL_LOOPS; loop++) {
          const ms = client.messages.stream({
            model: MODEL,
            max_tokens: 2048,
            system: [
              { type: "text", text: buildSystemPrompt() },
              { type: "text", text: dashboardContext },
            ],
            tools: TOOL_DEFS,
            messages: convo,
          });

          ms.on("text", (text) => {
            assistantText += text;
            send({ type: "text", text });
          });

          const final = await ms.finalMessage();

          if (final.stop_reason !== "tool_use") break;

          // tool_use 블록 실행
          const toolUses = final.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
          );
          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          for (const tu of toolUses) {
            const { resultText, widget } = await executeTool(tu.name, tu.input);
            if (widget) send({ type: "widget", widget });
            toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: resultText });
          }

          convo.push({ role: "assistant", content: final.content });
          convo.push({ role: "user", content: toolResults });
        }

        send({ type: "done" });
        // 메모리 영속 (텍스트만 — 위젯은 재생성 가능)
        if (assistantText.trim()) await appendTurn(userText, assistantText.trim());
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
