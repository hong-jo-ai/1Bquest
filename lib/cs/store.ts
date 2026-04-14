import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  CsChannel,
  CsMessage,
  CsStatus,
  CsThread,
  IngestPayload,
} from "./types";

let cached: SupabaseClient | null = null;

export function getCsSupabase(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY 환경변수 누락");
  }
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

function preview(text: string | undefined | null, max = 140): string | null {
  if (!text) return null;
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max) + "…" : clean;
}

/**
 * 스레드 + 메시지 ingest.
 *
 * 핵심 규칙:
 *   1. 메시지 중복(external_message_id 기준)이면 스레드를 전혀 건드리지 않고 return.
 *      → archived / resolved 스레드의 상태가 재동기화로 덮어쓰이는 걸 방지.
 *   2. 새 메시지인 경우:
 *      - 스레드가 이미 있으면: last_message_* 만 갱신. status는
 *        archived/resolved 면 보존, 나머지는 방향에 따라 unanswered/waiting.
 *      - 새 스레드면: status는 방향에 따라 초기 설정.
 */
export async function ingestMessage(payload: IngestPayload): Promise<{
  threadId: string;
  inserted: boolean;
}> {
  const db = getCsSupabase();
  const bodyForPreview = payload.bodyText ?? stripHtml(payload.bodyHtml);

  // 1. 메시지 중복 검사 (전역)
  if (payload.externalMessageId) {
    const { data: existingMsg } = await db
      .from("cs_messages")
      .select("id, thread_id")
      .eq("external_message_id", payload.externalMessageId)
      .maybeSingle();
    if (existingMsg) {
      return { threadId: existingMsg.thread_id, inserted: false };
    }
  }

  // 2. 기존 스레드 조회
  const { data: existingThread } = await db
    .from("cs_threads")
    .select("id, status")
    .eq("channel", payload.channel)
    .eq("external_thread_id", payload.externalThreadId)
    .maybeSingle();

  let threadId: string;

  if (existingThread) {
    // archived / resolved는 보존 — 사용자가 명시적으로 처리한 상태는 덮어쓰지 않음
    const preserve =
      existingThread.status === "archived" ||
      existingThread.status === "resolved";
    const nextStatus = preserve
      ? existingThread.status
      : payload.direction === "in"
        ? "unanswered"
        : "waiting";

    const { error: updErr } = await db
      .from("cs_threads")
      .update({
        last_message_at: payload.sentAt.toISOString(),
        last_message_preview: preview(bodyForPreview),
        customer_handle: payload.customerHandle ?? null,
        customer_name: payload.customerName ?? null,
        subject: payload.subject ?? null,
        status: nextStatus,
      })
      .eq("id", existingThread.id);
    if (updErr) throw new Error(`cs_threads update 실패: ${updErr.message}`);
    threadId = existingThread.id;
  } else {
    const { data: inserted, error: insErr } = await db
      .from("cs_threads")
      .insert({
        brand: payload.brand,
        channel: payload.channel,
        external_thread_id: payload.externalThreadId,
        customer_handle: payload.customerHandle ?? null,
        customer_name: payload.customerName ?? null,
        subject: payload.subject ?? null,
        last_message_at: payload.sentAt.toISOString(),
        last_message_preview: preview(bodyForPreview),
        status: payload.direction === "in" ? "unanswered" : "waiting",
      })
      .select("id")
      .single();
    if (insErr || !inserted) {
      throw new Error(`cs_threads insert 실패: ${insErr?.message}`);
    }
    threadId = inserted.id;
  }

  // 3. 메시지 삽입
  const { error: msgErr } = await db.from("cs_messages").insert({
    thread_id: threadId,
    direction: payload.direction,
    external_message_id: payload.externalMessageId ?? null,
    body_text: payload.bodyText ?? null,
    body_html: payload.bodyHtml ?? null,
    sent_at: payload.sentAt.toISOString(),
    raw: payload.raw ?? null,
  });

  if (msgErr) {
    throw new Error(`cs_messages insert 실패: ${msgErr.message}`);
  }

  return { threadId, inserted: true };
}

export async function listThreads(opts: {
  status?: CsStatus | "all";
  brand?: "paulvice" | "harriot" | "all";
  channel?: CsChannel | "all";
  limit?: number;
}): Promise<CsThread[]> {
  const db = getCsSupabase();
  let q = db
    .from("cs_threads")
    .select("*")
    .order("last_message_at", { ascending: false })
    .limit(opts.limit ?? 100);

  if (opts.status && opts.status !== "all") q = q.eq("status", opts.status);
  if (opts.brand && opts.brand !== "all") q = q.eq("brand", opts.brand);
  if (opts.channel && opts.channel !== "all") q = q.eq("channel", opts.channel);

  const { data, error } = await q;
  if (error) throw new Error(`listThreads 실패: ${error.message}`);
  return (data ?? []) as CsThread[];
}

export async function getThread(
  threadId: string
): Promise<{ thread: CsThread; messages: CsMessage[] } | null> {
  const db = getCsSupabase();
  const { data: thread, error: tErr } = await db
    .from("cs_threads")
    .select("*")
    .eq("id", threadId)
    .maybeSingle();
  if (tErr) throw new Error(tErr.message);
  if (!thread) return null;

  const { data: messages, error: mErr } = await db
    .from("cs_messages")
    .select("*")
    .eq("thread_id", threadId)
    .order("sent_at", { ascending: true });
  if (mErr) throw new Error(mErr.message);

  return {
    thread: thread as CsThread,
    messages: (messages ?? []) as CsMessage[],
  };
}

export async function setThreadStatus(
  threadId: string,
  status: CsStatus
): Promise<void> {
  const db = getCsSupabase();
  const { error } = await db
    .from("cs_threads")
    .update({ status })
    .eq("id", threadId);
  if (error) throw new Error(error.message);
}

function stripHtml(html: string | undefined | null): string | null {
  if (!html) return null;
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
