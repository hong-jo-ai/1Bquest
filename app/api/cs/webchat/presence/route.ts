import {
  flushWebchatReplyNotification,
  normalizeConversationId,
  recordWebchatPresence,
  webchatJson,
  webchatOptionsResponse,
} from "@/lib/cs/webchat";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: Request) {
  return webchatOptionsResponse(req);
}

export async function POST(req: Request) {
  try {
    // sendBeacon 은 text/plain 으로 본문을 보내므로 JSON 파싱을 직접 한다.
    const rawText = await req.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : {};
    } catch {
      parsed = {};
    }

    const conversationId = normalizeConversationId(parsed.conversationId);
    const state = parsed.state === "away" ? "away" : "active";
    if (!conversationId) {
      return webchatJson(req, { ok: false, error: "conversationId required" }, { status: 400 });
    }

    await recordWebchatPresence(conversationId, state);

    // 화면/사이트를 떠난 신호면, 미확인 답변이 있을 때만 SMS 발송을 시도한다.
    if (state === "away") {
      try {
        await flushWebchatReplyNotification(conversationId);
      } catch (e) {
        console.warn(
          "[webchat-presence] SMS 플러시 오류:",
          e instanceof Error ? e.message : String(e)
        );
      }
    }

    return webchatJson(req, { ok: true });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return webchatJson(req, { ok: false, error }, { status: 500 });
  }
}
