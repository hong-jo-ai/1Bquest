import {
  cleanText,
  ensureWebchatThread,
  normalizeConversationId,
  webchatJson,
  webchatOptionsResponse,
} from "@/lib/cs/webchat";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: Request) {
  return webchatOptionsResponse(req);
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const conversationId = normalizeConversationId(body.conversationId);
    const name = cleanText(body.name, 60);
    const phone = cleanText(body.phone, 40);
    if (!name || phone.replace(/\D/g, "").length < 10) {
      return webchatJson(
        req,
        { ok: false, error: "name and valid phone required" },
        { status: 400 }
      );
    }

    const result = await ensureWebchatThread({
      conversationId,
      name,
      phone,
      email: cleanText(body.email, 120),
      pageUrl: cleanText(body.pageUrl, 500),
      referrer: cleanText(body.referrer, 500),
      userAgent: cleanText(req.headers.get("user-agent"), 300),
    });

    return webchatJson(req, {
      ok: true,
      conversationId: result.conversationId,
      isNew: result.isNew,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return webchatJson(req, { ok: false, error }, { status: 500 });
  }
}
