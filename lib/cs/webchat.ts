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
  // 해리엇 (멀티몰)
  "https://harriot.co.kr",
  "https://www.harriot.co.kr",
  "https://m.harriot.co.kr",
  "https://harriotkorea.cafe24.com",
];

// 웹채팅 표시 브랜드명 (SMS·텔레그램·상담 제목). 폴바이스 기존 문구 유지.
const WEBCHAT_BRAND_LABEL: Record<string, string> = { paulvice: "PAULVICE", harriot: "HARRIOT" };
function wlabel(brand?: string | null): string {
  return WEBCHAT_BRAND_LABEL[brand ?? "paulvice"] ?? "PAULVICE";
}

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
  brand?: CsBrandId;
}): Promise<{ conversationId: string; threadId: string; isNew: boolean }> {
  const brand: CsBrandId = input.brand ?? "paulvice";
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
    brand,
    channel: "webchat",
    externalThreadId,
    externalMessageId: `${externalThreadId}:system:${now.getTime()}`,
    customerHandle: input.phone || input.email || conversationId,
    customerName: input.name || undefined,
    subject: `${wlabel(brand)} 웹 상담`,
    bodyText: intro || `${wlabel(brand)} 웹 상담이 시작되었습니다.`,
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
  brand?: CsBrandId;
}): Promise<{ threadId: string; inserted: boolean }> {
  const brand: CsBrandId = input.brand ?? "paulvice";
  const externalThreadId = makeWebchatExternalThreadId(input.conversationId);
  const result = await ingestMessage({
    brand,
    channel: "webchat",
    externalThreadId,
    externalMessageId: `${externalThreadId}:visitor:${Date.now()}:${crypto.randomUUID().slice(0, 8)}`,
    customerHandle: input.phone || input.email || input.conversationId,
    customerName: input.name || undefined,
    subject: `${wlabel(brand)} 웹 상담`,
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

export type WebchatConversationSummary = {
  conversationId: string;
  firstAt: string | null;
  lastAt: string | null;
  lastText: string;
  lastDirection: "in" | "out" | null;
  count: number;
};

/**
 * 위젯 "대화" 탭의 요약 카드용 — 방문자가 보유한 대화 id 목록을 받아
 * 각 대화의 시작/최근 시각, 마지막 메시지 미리보기, 메시지 수를 돌려준다.
 * 입력 순서(최근 대화 우선)를 그대로 유지한다.
 */
export async function summarizeWebchatConversations(
  conversationIds: string[]
): Promise<WebchatConversationSummary[]> {
  const out: WebchatConversationSummary[] = [];
  for (const id of conversationIds) {
    try {
      const msgs = await listWebchatMessages(id);
      if (!msgs.length) {
        out.push({ conversationId: id, firstAt: null, lastAt: null, lastText: "", lastDirection: null, count: 0 });
        continue;
      }
      const first = msgs[0];
      const last = msgs[msgs.length - 1];
      out.push({
        conversationId: id,
        firstAt: first.sent_at,
        lastAt: last.sent_at,
        lastText: last.body_text ?? "",
        lastDirection: last.direction,
        count: msgs.length,
      });
    } catch {
      out.push({ conversationId: id, firstAt: null, lastAt: null, lastText: "", lastDirection: null, count: 0 });
    }
  }
  return out;
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

  // ── 답변 라운드당 1회 제한(atomic) ──────────────────────────────
  // ⚠️ 원래 "채팅당 평생 1회"였는데, 고객이 재문의→사장님 재답변 시 SMS가 영영 안 가서
  //    "답변 못 받았다" 불만 발생(2026-07-02 수정, 실사례 3건). 이제 고객의 마지막 메시지
  //    (=답변 라운드) 기준으로 1회 — 사장님이 연속 여러 개 답해도 라운드당 SMS는 1통.
  // unique insert 로 선점: 동시에 여러 경로(답변 직후·away 신호·스위퍼)에서 호출돼도 1번만 통과.
  const everSentKey = `webchat_sms_sent:${threadId}:${latestInbound.id}`;
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

  const link = buildWebchatReturnUrl(conversationId, thread.brand);
  const name = thread.customer_name?.trim() || "고객님";
  const text = `${name}, ${wlabel(thread.brand)} 상담 답변이 도착했습니다.\n아래 링크에서 이어서 확인해 주세요.\n${link}`;

  const outcome = await sendMany([{ to: phone, text, subject: `${wlabel(thread.brand)} 상담 답변` }]);
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
    `🔔 <b>${wlabel(thread.brand)} 새 웹채팅 문의</b>`,
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

function buildWebchatReturnUrl(conversationId: string, brand?: string | null): string {
  const isHarriot = brand === "harriot";
  const base = (
    (isHarriot ? process.env.HARRIOT_WEBCHAT_RETURN_URL : process.env.PAULVICE_WEBCHAT_RETURN_URL) ||
    (isHarriot ? "https://harriot.co.kr/" : "https://paulvice.co.kr/")
  ).trim();
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

/**
 * 미통보 답변 스위퍼 — 10분 주기(cs/notify 크론에서 호출).
 * 고객이 탭을 강제종료하면 away 신호가 안 와서 답변 SMS가 영영 안 나가는 케이스를 회수한다.
 * (모바일 91% — iOS에서 pagehide 미발화 흔함) notifyWebchatReplyBySms 가 자체 가드
 * (이미 봄/화면 보는 중/라운드당 1회 선점)를 가지므로 여기선 후보만 순회하면 안전.
 */
export async function sweepWebchatReplyNotifications(): Promise<{ checked: number; sent: number }> {
  const db = getCsSupabase();
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { data: threads } = await db
    .from("cs_threads")
    .select("id")
    .eq("channel", "webchat")
    .gte("last_message_at", since)
    .limit(50);
  let sent = 0;
  for (const t of threads || []) {
    try {
      const res = await notifyWebchatReplyBySms(t.id);
      if (res.ok) sent++;
    } catch { /* 개별 실패 무시 */ }
  }
  return { checked: (threads || []).length, sent };
}
