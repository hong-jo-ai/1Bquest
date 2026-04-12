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
 * 스레드를 upsert하고 메시지를 삽입한다.
 * external_message_id가 이미 있으면 중복 삽입을 건너뛴다.
 * 수신(in) 메시지는 thread.status를 'unanswered'로 돌린다.
 */
export async function ingestMessage(payload: IngestPayload): Promise<{
  threadId: string;
  inserted: boolean;
}> {
  const db = getCsSupabase();
  const bodyForPreview = payload.bodyText ?? stripHtml(payload.bodyHtml);

  // 1. thread upsert
  const { data: thread, error: threadErr } = await db
    .from("cs_threads")
    .upsert(
      {
        brand: payload.brand,
        channel: payload.channel,
        external_thread_id: payload.externalThreadId,
        customer_handle: payload.customerHandle ?? null,
        customer_name: payload.customerName ?? null,
        subject: payload.subject ?? null,
        last_message_at: payload.sentAt.toISOString(),
        last_message_preview: preview(bodyForPreview),
        status: payload.direction === "in" ? "unanswered" : "waiting",
      },
      { onConflict: "channel,external_thread_id" }
    )
    .select("id")
    .single();

  if (threadErr || !thread) {
    throw new Error(`cs_threads upsert 실패: ${threadErr?.message}`);
  }

  // 2. 중복 검사
  if (payload.externalMessageId) {
    const { data: existing } = await db
      .from("cs_messages")
      .select("id")
      .eq("thread_id", thread.id)
      .eq("external_message_id", payload.externalMessageId)
      .maybeSingle();
    if (existing) {
      return { threadId: thread.id, inserted: false };
    }
  }

  // 3. 메시지 삽입
  const { error: msgErr } = await db.from("cs_messages").insert({
    thread_id: thread.id,
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

  return { threadId: thread.id, inserted: true };
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
