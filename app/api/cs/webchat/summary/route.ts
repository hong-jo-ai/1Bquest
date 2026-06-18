import {
  normalizeConversationId,
  summarizeWebchatConversations,
  webchatJson,
  webchatOptionsResponse,
} from "@/lib/cs/webchat";

export const dynamic = "force-dynamic";

const MAX_IDS = 30;

export async function OPTIONS(req: Request) {
  return webchatOptionsResponse(req);
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const raw = Array.isArray(body.conversationIds) ? body.conversationIds : [];
    const ids: string[] = [];
    for (const v of raw) {
      const id = normalizeConversationId(v);
      if (id && !ids.includes(id)) ids.push(id);
      if (ids.length >= MAX_IDS) break;
    }
    if (!ids.length) {
      return webchatJson(req, { ok: true, summaries: [] });
    }

    const summaries = await summarizeWebchatConversations(ids);
    return webchatJson(req, { ok: true, summaries });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return webchatJson(req, { ok: false, error }, { status: 500 });
  }
}
