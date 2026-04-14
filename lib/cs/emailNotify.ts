import { getCsSupabase } from "./store";
import { getGmailAccessToken, listGmailAccounts } from "./gmailClient";
import { BRAND_LABEL, CHANNEL_LABEL, type CsThread } from "./types";

const LAST_NOTIFY_KEY = "cs_inbox_email_last_notify_at";

async function getLastNotifyAt(): Promise<string> {
  const db = getCsSupabase();
  const { data } = await db
    .from("kv_store")
    .select("data")
    .eq("key", LAST_NOTIFY_KEY)
    .maybeSingle();
  return (
    (data?.data as string) ??
    new Date(Date.now() - 10 * 60 * 1000).toISOString()
  );
}

async function setLastNotifyAt(iso: string): Promise<void> {
  const db = getCsSupabase();
  await db.from("kv_store").upsert(
    { key: LAST_NOTIFY_KEY, data: iso, updated_at: new Date().toISOString() },
    { onConflict: "key" }
  );
}

function htmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function encodeMimeHeader(text: string): string {
  if (/^[\x20-\x7E]*$/.test(text)) return text;
  const b64 = Buffer.from(text, "utf-8").toString("base64");
  return `=?UTF-8?B?${b64}?=`;
}

function buildDigestHtml(threads: CsThread[], inboxUrl: string): string {
  const rows = threads
    .map((t) => {
      const name =
        t.customer_name || t.customer_handle || "알 수 없음";
      const preview = (t.last_message_preview ?? "").slice(0, 200);
      return `
      <tr>
        <td style="padding:12px;border-bottom:1px solid #eee;vertical-align:top">
          <div style="font-size:11px;color:#888;margin-bottom:4px">
            ${htmlEscape(BRAND_LABEL[t.brand])} · ${htmlEscape(CHANNEL_LABEL[t.channel])}
          </div>
          <div style="font-size:14px;font-weight:600;color:#111;margin-bottom:2px">
            ${htmlEscape(name)}
          </div>
          ${t.subject ? `<div style="font-size:13px;color:#555;margin-bottom:4px">${htmlEscape(t.subject)}</div>` : ""}
          ${preview ? `<div style="font-size:12px;color:#777;line-height:1.5">${htmlEscape(preview)}</div>` : ""}
        </td>
      </tr>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#f5f5f5;margin:0;padding:20px">
<table style="max-width:600px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
  <tr>
    <td style="background:linear-gradient(135deg,#8b5cf6,#d946ef);padding:24px;color:white">
      <div style="font-size:12px;opacity:0.8;margin-bottom:4px">CS 인박스</div>
      <div style="font-size:20px;font-weight:bold">새 미답변 문의 ${threads.length}건</div>
    </td>
  </tr>
  ${rows}
  <tr>
    <td style="padding:20px;text-align:center;background:#fafafa">
      <a href="${inboxUrl}" style="display:inline-block;background:#7c3aed;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:600">
        인박스에서 답장하기
      </a>
    </td>
  </tr>
  <tr>
    <td style="padding:12px;text-align:center;color:#aaa;font-size:10px">
      Paulvice Dashboard CS Inbox · 자동 발송
    </td>
  </tr>
</table>
</body></html>`;
}

async function sendGmailNotification(
  to: string,
  subject: string,
  html: string
): Promise<void> {
  // 발송에 쓸 Gmail 계정 결정: 첫 번째 등록된 Gmail 계정
  const accounts = await listGmailAccounts();
  if (accounts.length === 0) {
    throw new Error("Gmail 계정 미등록 — 이메일 발송 불가");
  }
  // paulvice 계정을 우선 사용 (없으면 첫 번째)
  const sender =
    accounts.find((a) => a.brand === "paulvice") ?? accounts[0];

  const accessToken = await getGmailAccessToken(sender);

  const headers = [
    `To: ${to}`,
    `From: ${sender.displayName}`,
    `Subject: ${encodeMimeHeader(subject)}`,
    `Content-Type: text/html; charset="UTF-8"`,
    `MIME-Version: 1.0`,
  ];
  const rfc822 = headers.join("\r\n") + "\r\n\r\n" + html;
  const raw = Buffer.from(rfc822, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const res = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw }),
    }
  );
  if (!res.ok) {
    throw new Error(`Gmail send 실패: ${await res.text()}`);
  }
}

/**
 * 지난 알림 이후 새로 수집된 미답변 스레드를 이메일 다이제스트로 발송.
 * Cron에서 10분마다 호출.
 */
export async function emailNewUnanswered(): Promise<{
  sent: number;
  count: number;
  skipped?: string;
}> {
  const to = process.env.NOTIFY_EMAIL ?? "plvekorea@gmail.com";
  const db = getCsSupabase();
  const since = await getLastNotifyAt();
  const now = new Date().toISOString();

  const { data, error } = await db
    .from("cs_threads")
    .select("*")
    .eq("status", "unanswered")
    .gt("last_message_at", since)
    .order("last_message_at", { ascending: true })
    .limit(30);

  if (error) throw new Error(error.message);
  const threads = (data ?? []) as CsThread[];

  if (threads.length === 0) {
    await setLastNotifyAt(now);
    return { sent: 0, count: 0, skipped: "새 미답변 없음" };
  }

  const inboxUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://paulvice-dashboard.vercel.app";
  const subject = `[CS 인박스] 새 미답변 ${threads.length}건`;
  const html = buildDigestHtml(threads, `${inboxUrl}/inbox`);

  try {
    await sendGmailNotification(to, subject, html);
    await setLastNotifyAt(now);
    return { sent: 1, count: threads.length };
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : String(e));
  }
}
