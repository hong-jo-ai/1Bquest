import { getThread, ingestMessage, getCsSupabase } from "./store";
import type { CsBrandId, CsMessage } from "./types";
import { detectMessageType, estimateCost, sendMany, smsConfigured } from "../sms/solapi";
import { logSmsSend } from "../sms/store";
import { sendTelegramMessage } from "./telegram";

const DEFAULT_ALLOWED_ORIGINS = [
  "https://paulvice.co.kr",
  "https://www.paulvice.co.kr",
  "https://m.paulvice.co.kr",
  "https://paulvice.cafe24.com",
];

export function getWebchatCorsHeaders(req: Request): HeadersInit {
  const origin = req.headers.get("origin") ?? "";
  const allowed = (process.env.PAULVICE_WEBCHAT_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  const allowedOrigins = allowed.length > 0 ? allowed : DEFAULT_ALLOWED_ORIGINS;
  const allowOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

export function webchatOptionsResponse(req: Request): Response {
  return new Response(null, {
    status: 204,
    headers: getWebchatCorsHeaders(req),
  });
}

export function webchatJson(req: Request, body: unknown, init: ResponseInit = {}): Response {
  return Response.json(body, {
    ...init,
    headers: {
      ...getWebchatCorsHeaders(req),
      ...(init.headers ?? {}),
    },
  });
}

export function makeWebchatExternalThreadId(conversationId: string): string {
  return `webchat:${conversationId}`;
}

export function createConversationId(): string {
  return `pv_${Date.now().toString(36)}_${crypto.randomUUID().replace(/-/g, "").slice(0, 18)}`;
}

export function normalizeConversationId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  if (!/^pv_[a-z0-9_]{12,80}$/i.test(clean)) return null;
  return clean;
}

export function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

export async function ensureWebchatThread(input: {
  conversationId?: string | null;
  name?: string;
  phone?: string;
  email?: string;
  pageUrl?: string;
  referrer?: string;
  userAgent?: string;
}): Promise<{ conversationId: string; threadId: string; isNew: boolean }> {
  const conversationId = input.conversationId ?? createConversationId();
  const externalThreadId = makeWebchatExternalThreadId(conversationId);
  const db = getCsSupabase();
  const { data: existing, error } = await db
    .from("cs_threads")
    .select("id")
    .eq("channel", "webchat")
    .eq("external_thread_id", externalThreadId)
    .maybeSingle();
  if (error) throw new Error(`webchat thread 조회 실패: ${error.message}`);
  if (existing?.id) return { conversationId, threadId: existing.id as string, isNew: false };

  const now = new Date();
  const intro = [
    input.name ? `이름: ${input.name}` : null,
    input.phone ? `연락처: ${input.phone}` : null,
    input.email ? `이메일: ${input.email}` : null,
    input.pageUrl ? `페이지: ${input.pageUrl}` : null,
  ].filter(Boolean).join("\n");

  const { threadId } = await ingestMessage({
    brand: "paulvice" satisfies CsBrandId,
    channel: "webchat",
    externalThreadId,
    externalMessageId: `${externalThreadId}:system:${now.getTime()}`,
    customerHandle: input.phone || input.email || conversationId,
    customerName: input.name || undefined,
    subject: "PAULVICE 웹 상담",
    bodyText: intro || "PAULVICE 웹 상담이 시작되었습니다.",
    sentAt: now,
    direction: "in",
    raw: {
      kind: "webchat_session_started",
      conversation_id: conversationId,
      page_url: input.pageUrl,
      referrer: input.referrer,
      user_agent: input.userAgent,
    },
  });
  return { conversationId, threadId, isNew: true };
}

export async function appendWebchatVisitorMessage(input: {
  conversationId: string;
  body: string;
  name?: string;
  phone?: string;
  email?: string;
  pageUrl?: string;
  userAgent?: string;
}): Promise<{ threadId: string; inserted: boolean }> {
  const externalThreadId = makeWebchatExternalThreadId(input.conversationId);
  const result = await ingestMessage({
    brand: "paulvice",
    channel: "webchat",
    externalThreadId,
    externalMessageId: `${externalThreadId}:visitor:${Date.now()}:${crypto.randomUUID().slice(0, 8)}`,
    customerHandle: input.phone || input.email || input.conversationId,
    customerName: input.name || undefined,
    subject: "PAULVICE 웹 상담",
    bodyText: input.body,
    sentAt: new Date(),
    direction: "in",
    raw: {
      kind: "webchat_visitor_message",
      conversation_id: input.conversationId,
      page_url: input.pageUrl,
      user_agent: input.userAgent,
    },
  });
  return result;
}

export async function listWebchatMessages(
  conversationId: string
): Promise<Array<Pick<CsMessage, "id" | "direction" | "body_text" | "sent_at">>> {
  const db = getCsSupabase();
  const externalThreadId = makeWebchatExternalThreadId(conversationId);
  const { data: thread, error } = await db
    .from("cs_threads")
    .select("id")
    .eq("channel", "webchat")
    .eq("external_thread_id", externalThreadId)
    .maybeSingle();
  if (error) throw new Error(`webchat thread 조회 실패: ${error.message}`);
  if (!thread?.id) return [];

  const detail = await getThread(thread.id as string);
  return (detail?.messages ?? [])
    .filter((m) => m.body_text && !isInternalSystemMessage(m.raw))
    .map((m) => ({
      id: m.id,
      direction: m.direction,
      body_text: m.body_text,
      sent_at: m.sent_at,
    }));
}

export async function notifyWebchatReplyBySms(threadId: string): Promise<{
  ok: boolean;
  skipped?: string;
  error?: string;
}> {
  const cfg = smsConfigured();
  if (!cfg.ok) return { ok: false, skipped: `sms_not_configured:${cfg.missing.join(",")}` };

  const data = await getThread(threadId);
  if (!data) return { ok: false, skipped: "thread_not_found" };
  const { thread } = data;
  if (thread.channel !== "webchat") return { ok: false, skipped: "not_webchat" };

  const phone = normalizePhone(thread.customer_handle);
  if (!phone) return { ok: false, skipped: "missing_phone" };

  const conversationId = thread.external_thread_id.replace(/^webchat:/, "");
  const link = buildWebchatReturnUrl(conversationId);
  const name = thread.customer_name?.trim() || "고객님";
  const text = `${name}, PAULVICE 상담 답변이 도착했습니다.\n아래 링크에서 이어서 확인해 주세요.\n${link}`;

  const outcome = await sendMany([{ to: phone, text, subject: "PAULVICE 상담 답변" }]);
  const results = outcome.results.map((r) => ({ ...r, name, text: r.text ?? text }));

  try {
    await logSmsSend({
      messageText: text,
      messageType: detectMessageType(text),
      sourceDesc: `웹채팅 답변 알림 · ${thread.subject ?? thread.id}`,
      recipientCount: 1,
      successCount: outcome.successCount,
      failCount: outcome.failCount,
      estCost: estimateCost(text, 1),
      groupId: outcome.groupId,
      results,
      isTest: false,
    });
  } catch (e) {
    console.error("[webchat-sms] 이력 기록 실패:", e instanceof Error ? e.message : String(e));
  }

  if (!outcome.ok) {
    return { ok: false, error: outcome.error ?? "sms_send_failed" };
  }
  return { ok: true };
}

export async function notifyNewWebchatThreadByTelegram(threadId: string): Promise<{
  ok: boolean;
  skipped?: string;
  error?: string;
}> {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    return { ok: false, skipped: "telegram_not_configured" };
  }

  const data = await getThread(threadId);
  if (!data) return { ok: false, skipped: "thread_not_found" };
  const { thread, messages } = data;
  if (thread.channel !== "webchat") return { ok: false, skipped: "not_webchat" };

  const db = getCsSupabase();
  const key = `webchat_telegram_notified:${threadId}`;
  const { data: existing } = await db
    .from("kv_store")
    .select("data")
    .eq("key", key)
    .maybeSingle();
  if (existing) return { ok: false, skipped: "already_notified" };

  const latestVisitorMessage = [...messages]
    .reverse()
    .find((m) => m.direction === "in" && !isInternalSystemMessage(m.raw));
  if (!latestVisitorMessage?.body_text?.trim()) {
    return { ok: false, skipped: "no_visitor_message" };
  }

  const inboxUrl = buildInboxThreadUrl(threadId);
  const name = thread.customer_name || "이름 없음";
  const phone = thread.customer_handle || "연락처 없음";
  const preview = latestVisitorMessage.body_text.trim().slice(0, 500);

  const text = [
    "🔔 <b>PAULVICE 새 웹채팅 문의</b>",
    "",
    `<b>${escapeHtml(name)}</b> · ${escapeHtml(phone)}`,
    "",
    escapeHtml(preview),
    "",
    `<a href="${inboxUrl}">CS 인박스에서 바로 답장하기</a>`,
  ].join("\n");

  await sendTelegramMessage(text, {
    buttons: [{ text: "CS 인박스 열기", url: inboxUrl }],
  });

  await db.from("kv_store").upsert(
    {
      key,
      data: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" }
  );

  return { ok: true };
}

function buildWebchatReturnUrl(conversationId: string): string {
  const base = (process.env.PAULVICE_WEBCHAT_RETURN_URL || "https://paulvice.co.kr/").trim();
  const url = new URL(base);
  url.searchParams.set("pv_chat", conversationId);
  return url.toString();
}

function buildInboxThreadUrl(threadId: string): string {
  const base = getDashboardBaseUrl();
  const url = new URL("/inbox", base);
  url.searchParams.set("thread", threadId);
  return url.toString();
}

function getDashboardBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "https://paulvice-dashboard.vercel.app";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function normalizePhone(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits : null;
}

function isInternalSystemMessage(raw: unknown): boolean {
  const kind = (raw as { kind?: string } | null)?.kind;
  return kind === "webchat_session_started";
}
