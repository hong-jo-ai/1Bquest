import {
  appendWebchatVisitorMessage,
  cleanText,
  ensureWebchatThread,
  listWebchatMessages,
  notifyNewWebchatThreadByTelegram,
  normalizeConversationId,
  webchatJson,
  webchatOptionsResponse,
} from "@/lib/cs/webchat";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: Request) {
  return webchatOptionsResponse(req);
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const conversationId = normalizeConversationId(url.searchParams.get("conversationId"));
    if (!conversationId) {
      return webchatJson(req, { ok: false, error: "conversationId required" }, { status: 400 });
    }

    const messages = await listWebchatMessages(conversationId);
    return webchatJson(req, { ok: true, messages });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return webchatJson(req, { ok: false, error }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const conversationId = normalizeConversationId(body.conversationId);
    const text = cleanText(body.body, 2000);
    if (!text) {
      return webchatJson(req, { ok: false, error: "body required" }, { status: 400 });
    }
    const name = cleanText(body.name, 60);
    const phone = cleanText(body.phone, 40);
    if (!name || phone.replace(/\D/g, "").length < 10) {
      return webchatJson(
        req,
        { ok: false, error: "name and valid phone required" },
        { status: 400 }
      );
    }

    const session = await ensureWebchatThread({
      conversationId,
      name,
      phone,
      email: cleanText(body.email, 120),
      pageUrl: cleanText(body.pageUrl, 500),
      referrer: cleanText(body.referrer, 500),
      userAgent: cleanText(req.headers.get("user-agent"), 300),
    });

    const inserted = await appendWebchatVisitorMessage({
      conversationId: session.conversationId,
      body: text,
      name,
      phone,
      email: cleanText(body.email, 120),
      pageUrl: cleanText(body.pageUrl, 500),
      userAgent: cleanText(req.headers.get("user-agent"), 300),
    });

    if (inserted.inserted) {
      try {
        const telegram = await notifyNewWebchatThreadByTelegram(inserted.threadId);
        if (!telegram.ok) {
          console.warn("[webchat] 텔레그램 알림 생략/실패:", telegram.skipped ?? telegram.error);
        }
      } catch (e) {
        console.warn("[webchat] 텔레그램 알림 오류:", e instanceof Error ? e.message : String(e));
      }
    }

    return webchatJson(req, { ok: true, conversationId: session.conversationId });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return webchatJson(req, { ok: false, error }, { status: 500 });
  }
}
