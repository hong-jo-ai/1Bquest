import {
  appendWebchatVisitorMessage,
  cleanText,
  ensureWebchatThread,
  notifyNewWebchatThreadByTelegram,
  normalizeConversationId,
  webchatContactOk,
  webchatJson,
  webchatOptionsResponse,
} from "@/lib/cs/webchat";
import { getCsSupabase } from "@/lib/cs/store";
import { maybeAutoReplyOffHours } from "@/lib/cs/crispAutoReply";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 불량 사진 첨부용. multipart POST 는 CORS 단순요청이라 preflight 없이 도달하지만,
// 응답에는 webchatJson 이 Allow-Origin 을 실어줘야 위젯이 결과를 읽을 수 있다.
const CS_ATTACHMENT_BUCKET = "cs-attachments";
const MAX_IMAGE = 12 * 1024 * 1024; // 12MB — 리뷰 업로드와 동일 기준
const IMAGE_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
};

export async function OPTIONS(req: Request) {
  return webchatOptionsResponse(req);
}

export async function POST(req: Request) {
  try {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return webchatJson(req, { ok: false, error: "bad form data" }, { status: 400 });
    }

    const file = form.get("file");
    if (!(file instanceof File)) {
      return webchatJson(req, { ok: false, error: "no file" }, { status: 400 });
    }
    const mime = file.type || "";
    const ext = IMAGE_MIME[mime];
    if (!ext) {
      return webchatJson(req, { ok: false, error: "image only (JPG/PNG/WEBP/GIF/HEIC)" }, { status: 415 });
    }
    if (file.size > MAX_IMAGE) {
      return webchatJson(req, { ok: false, error: "max 12MB" }, { status: 413 });
    }

    const field = (k: string, max: number) => cleanText(form.get(k), max);
    const name = field("name", 60);
    const phone = field("phone", 40);
    const email = field("email", 120);
    if (!webchatContactOk({ name, phone, email })) {
      return webchatJson(
        req,
        { ok: false, error: "name and a valid phone or email required" },
        { status: 400 }
      );
    }

    const brand = form.get("brand") === "harriot" ? "harriot" : "paulvice";
    const conversationId = normalizeConversationId(form.get("conversationId"));
    const session = await ensureWebchatThread({
      conversationId,
      name,
      phone,
      email,
      pageUrl: field("pageUrl", 500),
      referrer: field("referrer", 500),
      userAgent: cleanText(req.headers.get("user-agent"), 300),
      brand,
    });

    const path = `webchat/${session.conversationId}/${crypto.randomUUID()}.${ext}`;
    const sb = getCsSupabase();
    const buf = Buffer.from(await file.arrayBuffer());
    const { error: uploadError } = await sb.storage
      .from(CS_ATTACHMENT_BUCKET)
      .upload(path, buf, { contentType: mime, upsert: false });
    if (uploadError) {
      return webchatJson(req, { ok: false, error: `upload failed: ${uploadError.message}` }, { status: 500 });
    }
    const { data: pub } = sb.storage.from(CS_ATTACHMENT_BUCKET).getPublicUrl(path);

    // 이미지도 하나의 방문자 메시지로 적재 — 인박스·요약카드·알림 흐름을 텍스트와 동일하게 태운다.
    const label = form.get("label") === "en" ? "[Photo]" : "[사진]";
    const inserted = await appendWebchatVisitorMessage({
      conversationId: session.conversationId,
      body: label,
      name,
      phone,
      email,
      pageUrl: field("pageUrl", 500),
      userAgent: cleanText(req.headers.get("user-agent"), 300),
      brand,
      attachments: [{ url: pub.publicUrl, name: cleanText(file.name, 120) || undefined, isImage: true }],
    });

    if (inserted.inserted) {
      try {
        const telegram = await notifyNewWebchatThreadByTelegram(inserted.threadId);
        if (!telegram.ok) {
          console.warn("[webchat-upload] 텔레그램 알림 생략/실패:", telegram.skipped ?? telegram.error);
        }
      } catch (e) {
        console.warn("[webchat-upload] 텔레그램 알림 오류:", e instanceof Error ? e.message : String(e));
      }
      try {
        await maybeAutoReplyOffHours(inserted.threadId);
      } catch (e) {
        console.warn("[webchat-upload] 자동응대 오류:", e instanceof Error ? e.message : String(e));
      }
    }

    return webchatJson(req, {
      ok: true,
      conversationId: session.conversationId,
      url: pub.publicUrl,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return webchatJson(req, { ok: false, error }, { status: 500 });
  }
}
