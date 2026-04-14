import {
  fetchIgMessages,
  listIgAccounts,
  listIgConversations,
} from "@/lib/cs/instagramClient";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cs/debug/ig
 * 해리엇 IG 계정의 최근 대화 5개와 각 대화의 메시지 구조를 raw로 반환.
 */
export async function GET() {
  try {
    const accounts = await listIgAccounts();
    const harriot = accounts.find((a) => a.brand === "harriot");
    if (!harriot) {
      return Response.json({ error: "harriot IG 계정 미등록" }, { status: 404 });
    }

    const conversations = await listIgConversations(harriot, {
      since: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      maxPages: 3,
    });

    const sample = [];
    for (const conv of conversations.slice(0, 5)) {
      try {
        const msgs = await fetchIgMessages(harriot, conv.id);
        sample.push({
          conversationId: conv.id,
          updated_time: conv.updated_time,
          participants: conv.participants,
          messageCount: msgs.length,
          firstMessage: msgs[0] ?? null,
          hasMessageField: msgs.map((m) => !!m.message),
        });
      } catch (e) {
        sample.push({
          conversationId: conv.id,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return Response.json({
      ok: true,
      totalConversations: conversations.length,
      sample,
    });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
