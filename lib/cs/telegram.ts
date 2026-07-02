import { getCsSupabase } from "./store";
import { shouldNotifyByAI } from "./notifyFilter";
import { BRAND_LABEL, CHANNEL_LABEL, type CsThread } from "./types";

const LAST_NOTIFY_KEY = "cs_inbox_telegram_last_notify_at";

export interface TelegramButton {
  text: string;
  url?: string;            // 링크 버튼
  callback_data?: string;  // 콜백 버튼(웹훅 callback_query로 수신) — 둘 중 하나 필수
}

export async function sendTelegramMessage(
  text: string,
  options: { buttons?: TelegramButton[] } = {}
): Promise<void> {
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
        ...(options.buttons?.length
          ? {
              reply_markup: {
                inline_keyboard: [
                  options.buttons.map((button) =>
                    button.callback_data
                      ? { text: button.text, callback_data: button.callback_data }
                      : { text: button.text, url: button.url },
                  ),
                ],
              },
            }
          : {}),
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
 *
 * Gmail 채널은 shouldNotifyByAI 로 마케팅·뉴스레터·자동알림 사전 필터링.
 * 다른 채널은 무조건 발송. fail-open(분류 실패 시 발송).
 */
export async function notifyNewUnanswered(): Promise<{ sent: number; filtered: number }> {
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

  let sent = 0;
  let filtered = 0;
  for (const t of threads) {
    const decision = await shouldNotifyByAI(t);
    if (!decision.notify) {
      console.log(
        `[cs-notify] skip ${t.brand}/${t.channel} thread=${t.id} (${t.customer_name ?? "?"}): ${decision.reason}`,
      );
      filtered++;
      continue;
    }
    await sendTelegramMessage(formatThread(t, base));
    sent++;
  }

  await setLastNotifyAt(now);
  return { sent, filtered };
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

  const allStale = (data ?? []) as CsThread[];

  // Gmail 마케팅/뉴스레터는 stale digest 에서도 제외 — 캐시된 분류 재사용이라 비용 거의 없음.
  const stale: CsThread[] = [];
  for (const t of allStale) {
    const decision = await shouldNotifyByAI(t);
    if (decision.notify) stale.push(t);
  }
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
