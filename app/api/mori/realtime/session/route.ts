import { type NextRequest } from "next/server";
import { buildSystemPrompt } from "@/lib/mori/systemPrompt";
import { assembleDashboardContext } from "@/lib/mori/context";
import { buildPageContextBlock } from "@/lib/mori/pageContext";
import { loadConversation } from "@/lib/mori/memory";

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
- 화면 조작 도구는 이 모드에서 아직 직접 실행하지 못합니다. 실행이 필요하면 짧게 확인하고, 텍스트 모드에서 처리할 수 있다고 안내하세요.`,
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
