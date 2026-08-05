import {
  appendWebchatVisitorMessage,
  cleanText,
  ensureWebchatThread,
  listWebchatMessages,
  notifyNewWebchatThreadByTelegram,
  normalizeConversationId,
  recordWebchatPresence,
  webchatContactOk,
  webchatJson,
  webchatOptionsResponse,
} from "@/lib/cs/webchat";
import { maybeAutoReplyOffHours } from "@/lib/cs/crispAutoReply";

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
    // 메시지를 불러오는 중 = 고객이 위젯 화면을 보는 중(최신 답변을 본 것으로 간주).
    try {
      await recordWebchatPresence(conversationId, "active");
    } catch {
      // presence 기록 실패는 치명적이지 않음
    }
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
    const email = cleanText(body.email, 120);
    // 국내몰=전화, 영문몰=이메일. 둘 중 하나면 통과 (영문 위젯엔 전화 입력칸이 없다).
    if (!webchatContactOk({ name, phone, email })) {
      return webchatJson(
        req,
        { ok: false, error: "name and a valid phone or email required" },
        { status: 400 }
      );
    }

    const brand = body.brand === "harriot" ? "harriot" : "paulvice";
    const session = await ensureWebchatThread({
      conversationId,
      name,
      phone,
      email,
      pageUrl: cleanText(body.pageUrl, 500),
      referrer: cleanText(body.referrer, 500),
      userAgent: cleanText(req.headers.get("user-agent"), 300),
      brand,
    });

    const inserted = await appendWebchatVisitorMessage({
      conversationId: session.conversationId,
      body: text,
      name,
      phone,
      email,
      pageUrl: cleanText(body.pageUrl, 500),
      userAgent: cleanText(req.headers.get("user-agent"), 300),
      brand,
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

      // 업무외 시간/휴일이면 자동 1차 응대 (근무시간이면 내부에서 스킵)
      try {
        const auto = await maybeAutoReplyOffHours(inserted.threadId);
        if (auto.sent) {
          console.log("[webchat] 업무외 자동응대 발송:", inserted.threadId);
        } else if (!auto.ok) {
          console.warn("[webchat] 자동응대 실패:", auto.reason, auto.error ?? "");
        }
      } catch (e) {
        console.warn("[webchat] 자동응대 오류:", e instanceof Error ? e.message : String(e));
      }
    }

    return webchatJson(req, { ok: true, conversationId: session.conversationId });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return webchatJson(req, { ok: false, error }, { status: 500 });
  }
}
