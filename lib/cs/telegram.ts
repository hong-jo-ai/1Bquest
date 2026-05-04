import { getCsSupabase } from "./store";
import { BRAND_LABEL, CHANNEL_LABEL, type CsThread } from "./types";

const LAST_NOTIFY_KEY = "cs_inbox_telegram_last_notify_at";

export async function sendTelegramMessage(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.warn("[telegram] TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID 미설정 — 알림 발송 생략");
    return;
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      // Telegram이 200 외 응답 — 가장 흔한 silent fail 원인. Vercel 로그에 남겨야 운영자가 알 수 있음.
      const body = await res.text().catch(() => "(본문 읽기 실패)");
      console.error(
        `[telegram] sendMessage 실패 status=${res.status} body=${body.slice(0, 300)}`
      );
    }
  } catch (e) {
    // 네트워크 자체 실패 — for-loop 호출자가 다음 메시지 진행할 수 있도록 throw 안 함
    console.error(
      "[telegram] sendMessage 네트워크 에러:",
      e instanceof Error ? e.message : String(e)
    );
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatThread(t: CsThread, inboxBaseUrl: string): string {
  const name = t.customer_name || t.customer_handle || "알 수 없음";
  const preview = t.last_message_preview?.slice(0, 200) ?? "";
  return [
    `🔴 <b>${escapeHtml(BRAND_LABEL[t.brand])} · ${escapeHtml(CHANNEL_LABEL[t.channel])}</b>`,
    `<b>${escapeHtml(name)}</b>${t.subject ? " — " + escapeHtml(t.subject) : ""}`,
    preview ? escapeHtml(preview) : "",
    `<a href="${inboxBaseUrl}/inbox">인박스에서 열기</a>`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function getLastNotifyAt(): Promise<string> {
  const db = getCsSupabase();
  const { data } = await db
    .from("kv_store")
    .select("data")
    .eq("key", LAST_NOTIFY_KEY)
    .maybeSingle();
  // fallback 24시간: 최초 실행 / 키 누락 / cron 장기 중단 시에도 직전 하루치는 보강 발송.
  // 한번 발송이 성공하면 그때부터 정상 시간이 저장돼 이 fallback은 쓰이지 않음.
  return (data?.data as string) ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}

async function setLastNotifyAt(iso: string): Promise<void> {
  const db = getCsSupabase();
  await db
    .from("kv_store")
    .upsert(
      { key: LAST_NOTIFY_KEY, data: iso, updated_at: new Date().toISOString() },
      { onConflict: "key" }
    );
}

/**
 * 지난 실행 이후 새로 수집된 미답변 스레드를 Telegram으로 통지.
 * Cron에서 주기적으로 호출 (예: 10분마다).
 */
export async function notifyNewUnanswered(): Promise<{ sent: number }> {
  const db = getCsSupabase();
  const since = await getLastNotifyAt();
  const now = new Date().toISOString();

  const { data, error } = await db
    .from("cs_threads")
    .select("*")
    .eq("status", "unanswered")
    .gt("last_message_at", since)
    .order("last_message_at", { ascending: true })
    .limit(20);

  if (error) throw new Error(error.message);
  const threads = (data ?? []) as CsThread[];

  const base = process.env.NEXT_PUBLIC_APP_URL ?? process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL ?? ""}`
    : "";

  for (const t of threads) {
    await sendTelegramMessage(formatThread(t, base));
  }

  await setLastNotifyAt(now);
  return { sent: threads.length };
}

/**
 * 2시간 이상 미답변 상태인 스레드에 대해 리마인더 발송.
 * Cron에서 1시간마다 호출.
 */
export async function notifyStaleUnanswered(): Promise<{ sent: number }> {
  const db = getCsSupabase();
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data } = await db
    .from("cs_threads")
    .select("*")
    .eq("status", "unanswered")
    .lt("last_message_at", twoHoursAgo)
    .order("last_message_at", { ascending: true })
    .limit(10);

  const stale = (data ?? []) as CsThread[];
  if (stale.length === 0) return { sent: 0 };

  const lines = stale.map((t) => {
    const name = t.customer_name || t.customer_handle || "?";
    const minutes = Math.floor(
      (Date.now() - new Date(t.last_message_at).getTime()) / 60000
    );
    const hours = Math.floor(minutes / 60);
    return `• ${escapeHtml(BRAND_LABEL[t.brand])} · ${escapeHtml(CHANNEL_LABEL[t.channel])} · ${escapeHtml(name)} (${hours}h)`;
  });

  await sendTelegramMessage(
    `⏰ <b>미답변 ${stale.length}건 (2시간 초과)</b>\n\n${lines.join("\n")}`
  );
  return { sent: stale.length };
}
