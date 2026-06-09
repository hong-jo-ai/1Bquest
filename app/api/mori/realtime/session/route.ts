import { type NextRequest } from "next/server";
import { buildSystemPrompt } from "@/lib/mori/systemPrompt";
import { assembleDashboardContext } from "@/lib/mori/context";
import { buildPageContextBlock } from "@/lib/mori/pageContext";
import { loadConversation } from "@/lib/mori/memory";
import { TOOL_DEFS } from "@/lib/mori/tools";

/** Anthropic Tool(input_schema) → Realtime function tool(parameters) 변환. 같은 도구셋을 음성에서도 쓴다. */
const REALTIME_TOOLS = TOOL_DEFS.map((t) => ({
  type: "function" as const,
  name: t.name,
  description: t.description,
  parameters: t.input_schema,
}));

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODEL = process.env.MORI_REALTIME_MODEL ?? "gpt-realtime";
const VOICE = process.env.MORI_REALTIME_VOICE ?? "marin";
const MAX_HISTORY = 12;

function recentHistoryBlock(history: Awaited<ReturnType<typeof loadConversation>>): string {
  const recent = history.slice(-MAX_HISTORY);
  if (recent.length === 0) return "";
  return `# 최근 대화 기억

아래는 같은 대표님과 직전에 나눈 대화입니다. 같은 맥락이 이어지면 참고하되, 현재 대시보드 상태와 충돌하면 현재 상태를 우선하세요.

${recent.map((m) => `${m.role === "user" ? "대표님" : "모리"}: ${m.content}`).join("\n")}`;
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return Response.json({ error: "OPENAI_API_KEY 없음" }, { status: 500 });

  const { pagePath } = (await req.json().catch(() => ({}))) as { pagePath?: string };
  const [history, dashboardContext] = await Promise.all([
    loadConversation().catch(() => []),
    assembleDashboardContext(),
  ]);
  const pageContext = buildPageContextBlock(pagePath);
  const historyContext = recentHistoryBlock(history);

  const instructions = [
    buildSystemPrompt(),
    dashboardContext,
    pageContext,
    historyContext,
    `# Realtime 음성대화 규칙
- 지금은 통화형 음성대화입니다. 한 답변은 보통 한두 문장으로 짧게 끝내세요.
- 대표님이 끼어들거나 말을 바꾸면 바로 멈추고 새 요청을 따르세요.
- 도구(조회/차트/할일등록/발주생성/기억저장 등)를 텍스트 모드와 똑같이 직접 호출할 수 있습니다. 요청받은 작업은 말로만 하지 말고 반드시 해당 도구를 호출해 실제로 처리하세요. 결과는 도구 실행 결과를 근거로 사실대로 짧게 말하세요.
- 아직 실행하지 못했거나 확실치 않은 일을 "해뒀다/처리했다"라고 말하지 마세요.
- 텔레그램 발송처럼 되돌리기 어려운 작업은 propose_owner_telegram 으로 확인 카드를 띄우고, 대표님이 화면에서 [실행]을 눌러야 실제로 나간다고 안내하세요. 음성만으로 보내지 마세요.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      session: {
        type: "realtime",
        model: MODEL,
        output_modalities: ["audio"],
        instructions,
        tools: REALTIME_TOOLS,
        tool_choice: "auto",
        audio: {
          input: {
            turn_detection: {
              type: "semantic_vad",
            },
            transcription: {
              model: "gpt-4o-mini-transcribe",
              language: "ko",
            },
          },
          output: {
            voice: VOICE,
          },
        },
      },
      expires_after: {
        anchor: "created_at",
        seconds: 600,
      },
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    return Response.json(
      { error: `Realtime 세션 생성 실패: ${text || response.statusText}` },
      { status: response.status },
    );
  }

  return new Response(text, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
