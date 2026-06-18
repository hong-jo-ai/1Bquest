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

type WebchatPresence = {
  state: "active" | "away";
  at: string;
  lastSeenAt?: string;
};

// 고객이 위젯을 보고 있다고 간주하는 최대 무응답 시간(하트비트 주기 5초 + 여유).
// 이 시간 안에 active 신호가 있었으면 "화면을 보는 중"으로 보고 SMS를 보류한다.
const WEBCHAT_ACTIVE_WINDOW_MS = 20 * 1000;

function presenceKey(conversationId: string): string {
  return `webchat_presence:${conversationId}`;
}

function conversationIdFromExternalThreadId(externalThreadId: string): string {
  return externalThreadId.replace(/^webchat:/, "");
}

export async function recordWebchatPresence(
  conversationId: string,
  state: "active" | "away"
): Promise<void> {
  const db = getCsSupabase();
  const key = presenceKey(conversationId);
  const now = new Date().toISOString();
  const { data: existing } = await db
    .from("kv_store")
    .select("data")
    .eq("key", key)
    .maybeSingle();
  const prev = (existing?.data ?? {}) as Partial<WebchatPresence>;
  // active 신호 = 현재 위젯 화면을 보는 중 → 최신 메시지를 본 것으로 간주(lastSeenAt 갱신).
  // away 신호는 lastSeenAt 을 갱신하지 않는다(직전에 본 시점 유지).
  const next: WebchatPresence = {
    state,
    at: now,
    lastSeenAt:
      state === "active"
        ? now
        : typeof prev.lastSeenAt === "string"
          ? prev.lastSeenAt
          : undefined,
  };
  await db
    .from("kv_store")
    .upsert({ key, data: next, updated_at: now }, { onConflict: "key" });
}

async function readWebchatPresence(
  conversationId: string
): Promise<WebchatPresence | null> {
  const db = getCsSupabase();
  const { data } = await db
    .from("kv_store")
    .select("data")
    .eq("key", presenceKey(conversationId))
    .maybeSingle();
  const raw = data?.data as Partial<WebchatPresence> | undefined;
  if (!raw || (raw.state !== "active" && raw.state !== "away")) return null;
  if (typeof raw.at !== "string") return null;
  return {
    state: raw.state,
    at: raw.at,
    lastSeenAt: typeof raw.lastSeenAt === "string" ? raw.lastSeenAt : undefined,
  };
}

export async function resolveWebchatThreadId(
  conversationId: string
): Promise<string | null> {
  const db = getCsSupabase();
  const { data } = await db
    .from("cs_threads")
    .select("id")
    .eq("channel", "webchat")
    .eq("external_thread_id", makeWebchatExternalThreadId(conversationId))
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/**
 * away(화면/사이트 이탈) 신호가 오면, 미확인 상태로 남은 상담원 답변이 있을 때만 SMS를 보낸다.
 * presence 엔드포인트에서 호출.
 */
export async function flushWebchatReplyNotification(
  conversationId: string
): Promise<{ ok: boolean; skipped?: string; error?: string }> {
  const threadId = await resolveWebchatThreadId(conversationId);
  if (!threadId) return { ok: false, skipped: "thread_not_found" };
  return notifyWebchatReplyBySms(threadId);
}

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

  const latestInbound = [...data.messages]
    .reverse()
    .find((m) => m.direction === "in" && !isInternalSystemMessage(m.raw));
  const latestOutbound = [...data.messages].reverse().find((m) => m.direction === "out");
  if (!latestInbound?.id) return { ok: false, skipped: "no_customer_message" };
  if (!latestOutbound?.id) return { ok: false, skipped: "no_agent_reply" };
  if (new Date(latestOutbound.sent_at).getTime() < new Date(latestInbound.sent_at).getTime()) {
    return { ok: false, skipped: "reply_before_latest_customer_message" };
  }

  const db = getCsSupabase();

  // ── 화면을 보고 있으면 SMS 보류 ──────────────────────────────────
  // 고객이 위젯 화면을 보는 중(active)이거나, 이미 이 답변을 본 뒤라면 보내지 않는다.
  // 사이트/화면을 떠난 경우에만 발송한다.
  const conversationId = conversationIdFromExternalThreadId(thread.external_thread_id);
  const presence = await readWebchatPresence(conversationId);
  if (presence) {
    const replyAt = new Date(latestOutbound.sent_at).getTime();
    const seenReply =
      presence.lastSeenAt != null &&
      new Date(presence.lastSeenAt).getTime() >= replyAt;
    const activeNow =
      presence.state === "active" &&
      Date.now() - new Date(presence.at).getTime() < WEBCHAT_ACTIVE_WINDOW_MS;
    if (seenReply) return { ok: false, skipped: "visitor_already_saw_reply" };
    if (activeNow) return { ok: false, skipped: "visitor_present" };
  }

  // ── 채팅당 1회 제한(atomic) ─────────────────────────────────────
  // everSentKey 를 unique insert 로 선점한다. 이미 있으면(보냈거나 보내는 중) 발송하지 않는다.
  // 동시에 여러 경로(답변 직후·away 신호)에서 호출돼도 단 한 번만 통과한다.
  const everSentKey = `webchat_sms_ever_sent:${threadId}`;
  const claimAt = new Date().toISOString();
  const { error: claimError } = await db.from("kv_store").insert({
    key: everSentKey,
    data: {
      status: "sending",
      threadId,
      inboundMessageId: latestInbound.id,
      outMessageId: latestOutbound.id,
      createdAt: claimAt,
    },
    updated_at: claimAt,
  });
  if (claimError) {
    if (claimError.code === "23505") return { ok: false, skipped: "already_sent_once" };
    return { ok: false, error: `sms_claim_failed:${claimError.message}` };
  }

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
    // 발송 실패 시 선점(claim)을 해제해 다음 신호에서 재시도할 수 있게 한다.
    await db.from("kv_store").delete().eq("key", everSentKey);
    return { ok: false, error: outcome.error ?? "sms_send_failed" };
  }

  const notifiedAt = new Date().toISOString();
  const { error: claimUpdateError } = await db.from("kv_store").update({
    data: {
      status: "sent",
      threadId,
      inboundMessageId: latestInbound.id,
      outMessageId: latestOutbound.id,
      groupId: outcome.groupId ?? null,
      sentAt: notifiedAt,
    },
    updated_at: notifiedAt,
  }).eq("key", everSentKey);
  if (claimUpdateError) {
    console.error("[webchat-sms] 발송 상태 갱신 실패:", claimUpdateError.message);
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

  const latestVisitorMessage = [...messages]
    .reverse()
    .find((m) => m.direction === "in" && !isInternalSystemMessage(m.raw));
  if (!latestVisitorMessage?.body_text?.trim()) {
    return { ok: false, skipped: "no_visitor_message" };
  }

  // 새 대화 시작 시 1회만 — 동시에 여러 첫 메시지가 들어와도 unique key insert 로 한 번만 통과시킨다.
  const now0 = new Date().toISOString();
  const { error: claimError } = await db.from("kv_store").insert({
    key,
    data: { status: "notifying", createdAt: now0 },
    updated_at: now0,
  });
  if (claimError) {
    if (claimError.code === "23505") return { ok: false, skipped: "already_notified" };
    return { ok: false, error: `telegram_claim_failed:${claimError.message}` };
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

  try {
    await sendTelegramMessage(text, {
      buttons: [{ text: "CS 인박스 열기", url: inboxUrl }],
    });
  } catch (e) {
    // 전송 실패 시 claim 을 해제해 다음 메시지에서 재시도할 수 있게 한다.
    await db.from("kv_store").delete().eq("key", key);
    throw e;
  }

  const sentAt = new Date().toISOString();
  await db.from("kv_store").update({
    data: { status: "notified", sentAt },
    updated_at: sentAt,
  }).eq("key", key);

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
