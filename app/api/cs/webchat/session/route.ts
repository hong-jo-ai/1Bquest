import {
  cleanText,
  ensureWebchatThread,
  normalizeConversationId,
  webchatContactOk,
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
    const email = cleanText(body.email, 120);
    // 국내몰=전화, 영문몰=이메일. 둘 중 하나면 통과 (영문 위젯엔 전화 입력칸이 없다).
    if (!webchatContactOk({ name, phone, email })) {
      return webchatJson(
        req,
        { ok: false, error: "name and a valid phone or email required" },
        { status: 400 }
      );
    }

    const result = await ensureWebchatThread({
      conversationId,
      name,
      phone,
      email,
      pageUrl: cleanText(body.pageUrl, 500),
      referrer: cleanText(body.referrer, 500),
      userAgent: cleanText(req.headers.get("user-agent"), 300),
      brand: body.brand === "harriot" ? "harriot" : "paulvice",
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
