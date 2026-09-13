/**
 * 해리엇 명의 메일 1통 발송 (Gmail API, 평문+HTML multipart, 추가 헤더 지원).
 *
 * waitlistBlast.ts 의 sendOneEmail 과 같은 원칙을 따르되 **헤더를 붙일 수 있게** 분리했다 —
 * 마케팅 메일에는 List-Unsubscribe(+One-Click) 헤더가 필요한데 그쪽은 헤더 자리가 없다.
 * (waitlistBlast.ts 는 다른 작업이 진행 중이라 손대지 않고 새로 두었다. 2026-09-13)
 *
 * 발신 계정은 반드시 harriotwatches@gmail.com — 2026-09-09 폴바이스 계정으로 나간 사고 이후 고정.
 * harriotwatches.com 은 DKIM/DMARC 가 없어 일괄 발송엔 gmail.com 이 안전하다.
 */
import { listGmailAccounts, getGmailAccessToken } from "@/lib/cs/gmailClient";

export const HARRIOT_SENDER_EMAIL = "harriotwatches@gmail.com";
export const HARRIOT_SENDER_NAME = "Harriot";

export interface HarriotMail {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** 예: { "List-Unsubscribe": "<https://…>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } */
  headers?: Record<string, string>;
}

let tokenCache: { token: string; at: number } | null = null;

async function senderToken(): Promise<string> {
  if (tokenCache && Date.now() - tokenCache.at < 30 * 60_000) return tokenCache.token;
  const accounts = await listGmailAccounts();
  const account = accounts.find((a) => a.brand === "harriot" && a.displayName === HARRIOT_SENDER_EMAIL);
  if (!account) {
    throw new Error(
      `발신 계정 ${HARRIOT_SENDER_EMAIL} 이 연결되어 있지 않습니다 (연결된 계정: ${accounts.map((a) => `${a.brand}/${a.displayName}`).join(", ") || "없음"})`,
    );
  }
  const token = await getGmailAccessToken(account);
  tokenCache = { token, at: Date.now() };
  return token;
}

const b64 = (t: string) => Buffer.from(t, "utf-8").toString("base64").replace(/(.{76})/g, "$1\r\n");
const enc = (t: string) => `=?UTF-8?B?${Buffer.from(t, "utf-8").toString("base64")}?=`;

export async function sendHarriotEmail(m: HarriotMail): Promise<{ ok: boolean; status: number; error?: string }> {
  const accessToken = await senderToken();
  const head = [
    `From: ${enc(HARRIOT_SENDER_NAME)} <${HARRIOT_SENDER_EMAIL}>`,
    `To: ${m.to}`,
    `Subject: ${enc(m.subject)}`,
    "MIME-Version: 1.0",
    ...Object.entries(m.headers ?? {}).map(([k, v]) => `${k}: ${v}`),
  ];
  let rfc822: string;
  if (m.html) {
    const bd = `hrt_${Date.now().toString(36)}`;
    rfc822 =
      [...head, `Content-Type: multipart/alternative; boundary="${bd}"`].join("\r\n") + "\r\n\r\n" +
      [
        `--${bd}`, 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64", "", b64(m.text),
        `--${bd}`, 'Content-Type: text/html; charset="UTF-8"', "Content-Transfer-Encoding: base64", "", b64(m.html),
        `--${bd}--`, "",
      ].join("\r\n");
  } else {
    rfc822 = [...head, 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64"].join("\r\n") + "\r\n\r\n" + b64(m.text);
  }
  const raw = Buffer.from(rfc822, "utf-8").toString("base64url");
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  if (res.ok) return { ok: true, status: res.status };
  return { ok: false, status: res.status, error: (await res.text().catch(() => "")).slice(0, 300) };
}
