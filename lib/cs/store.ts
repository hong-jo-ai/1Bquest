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

    // customer_handle/name/subject 는 값이 있을 때만 갱신 — null 로 덮어쓰지 않는다.
    // (인박스에서 답장 보낼 때 outgoing 메시지엔 고객 정보가 없어서, 덮어쓰면
    //  고객 이름이 "알 수 없음"으로 지워지는 버그가 있었음)
    const updateFields: Record<string, unknown> = {
      last_message_at: payload.sentAt.toISOString(),
      last_message_preview: preview(bodyForPreview),
      status: nextStatus,
    };
    if (payload.customerHandle) updateFields.customer_handle = payload.customerHandle;
    if (payload.customerName) updateFields.customer_name = payload.customerName;
    if (payload.subject) updateFields.subject = payload.subject;

    const { error: updErr } = await db
      .from("cs_threads")
      .update(updateFields)
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

  if (opts.status && opts.status !== "all") {
    q = q.eq("status", opts.status);
  } else {
    // "전체"는 보관(CS 아님)을 제외한 실제 CS 스레드만. 보관함은 status=archived 로 따로 조회.
    q = q.neq("status", "archived");
  }
  if (opts.brand && opts.brand !== "all") q = q.eq("brand", opts.brand);
  if (opts.channel && opts.channel !== "all") q = q.eq("channel", opts.channel);

  const { data, error } = await q;
  if (error) throw new Error(`listThreads 실패: ${error.message}`);
  return (data ?? []) as CsThread[];
}

/**
 * 상태별 스레드 개수 — 탭 배지용 서버 집계.
 * all = 보관 제외한 미답변+대기중+해결됨 합계.
 */
export async function countThreadsByStatus(opts: {
  brand?: "paulvice" | "harriot" | "all";
  channel?: CsChannel | "all";
}): Promise<{ unanswered: number; waiting: number; resolved: number; archived: number; all: number }> {
  const db = getCsSupabase();
  const statuses: CsStatus[] = ["unanswered", "waiting", "resolved", "archived"];
  const entries = await Promise.all(
    statuses.map(async (status) => {
      let q = db.from("cs_threads").select("id", { count: "exact", head: true }).eq("status", status);
      if (opts.brand && opts.brand !== "all") q = q.eq("brand", opts.brand);
      if (opts.channel && opts.channel !== "all") q = q.eq("channel", opts.channel);
      const { count, error } = await q;
      if (error) throw new Error(`countThreadsByStatus 실패: ${error.message}`);
      return [status, count ?? 0] as const;
    })
  );
  const m = Object.fromEntries(entries) as Record<CsStatus, number>;
  return {
    unanswered: m.unanswered,
    waiting:    m.waiting,
    resolved:   m.resolved,
    archived:   m.archived,
    all:        m.unanswered + m.waiting + m.resolved,
  };
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

/**
 * 스레드 고객 정보 보충 — 값이 있을 때만 갱신.
 *
 * 재동기화 때 채널이 고객 이름/이메일을 다시 가져오는데, 메시지는 이미 ingest 돼서
 * (dup) 스레드 행이 갱신 안 된다. 인박스 답장으로 이름이 지워진 기존 스레드를
 * 복구하려고 ingest 가 스레드 단위로 한 번 호출한다.
 */
export async function refreshThreadCustomer(
  channel: CsChannel,
  externalThreadId: string,
  info: { handle?: string | null; name?: string | null }
): Promise<void> {
  const fields: Record<string, unknown> = {};
  if (info.handle) fields.customer_handle = info.handle;
  if (info.name) fields.customer_name = info.name;
  if (Object.keys(fields).length === 0) return;
  const db = getCsSupabase();
  await db
    .from("cs_threads")
    .update(fields)
    .eq("channel", channel)
    .eq("external_thread_id", externalThreadId);
}

/**
 * 채널 + external_thread_id 목록에 대해 마지막 메시지 시각(epoch ms) 맵을 반환.
 * 증분 동기화용 — 외부 API에서 받은 대화가 우리가 가진 마지막 메시지보다
 * 새것인지 비교해, 변경 없으면 메시지 재조회(외부 API 호출)를 생략한다.
 */
export async function getThreadLastMessageMap(
  channel: CsChannel,
  externalThreadIds: string[]
): Promise<Map<string, number>> {
  if (externalThreadIds.length === 0) return new Map();
  const db = getCsSupabase();
  const { data } = await db
    .from("cs_threads")
    .select("external_thread_id, last_message_at")
    .eq("channel", channel)
    .in("external_thread_id", externalThreadIds);
  const map = new Map<string, number>();
  for (const r of data ?? []) {
    if (r.external_thread_id && r.last_message_at) {
      map.set(r.external_thread_id as string, new Date(r.last_message_at as string).getTime());
    }
  }
  return map;
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
