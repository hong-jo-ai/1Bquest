/**
 * 모리 음성(Realtime) 도구 실행 — 데이터채널의 function_call 을 클라이언트가 이 라우트로 실행.
 *
 * 텍스트 모드(chat/route.ts)와 동일한 executeTool 을 재사용해 음성에서도 같은 도구를 쓴다.
 * 되돌리기 어려운 작업은 executeTool 단계에서 '확인 카드 위젯'만 만들고(예: propose_owner_telegram),
 * 실제 실행은 사용자가 카드의 [실행]을 눌러 /api/mori/action 으로만 일어난다(음성/LLM 단독 실행 불가).
 */
import { type NextRequest } from "next/server";
import { executeTool } from "@/lib/mori/tools";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const { name, input } = (await req.json().catch(() => ({}))) as {
    name?: string;
    input?: unknown;
  };
  if (!name) return Response.json({ error: "tool name 없음" }, { status: 400 });

  const { resultText, widget } = await executeTool(name, input ?? {});
  return Response.json({ resultText, widget: widget ?? null });
}
