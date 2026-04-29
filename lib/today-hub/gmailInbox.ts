/**
 * 오늘의 운영 허브 — 답장 필요 인박스 Gmail 연동.
 * 기존 CS용 Gmail OAuth(cs_accounts) 자격 증명을 그대로 재활용.
 *
 * 모든 CS Gmail 계정의 '답장필요' 라벨이 붙은 스레드를 통합 조회.
 * 답장 전송 + 라벨 제거 + 딥링크 URL 생성을 담당.
 */
import {
  listGmailAccounts,
  getGmailAccessToken,
  extractHeader,
  parseFrom,
  extractBody,
  type GmailAccount,
} from "@/lib/cs/gmailClient";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const REPLY_NEEDED_LABEL = "답장필요";

export interface InboxItem {
  id:            string; // composite: accountId:threadId
  accountId:     string;
  accountBrand:  string;
  threadId:      string;
  sender:        string;
  senderEmail:   string | null;
  subject:       string;
  snippet:       string;
  receivedAt:    string; // ISO
  receivedLabel: string;
  overdue:       boolean;
  gmailWebUrl:   string;
}

export interface ThreadMessage {
  from:     string;
  to:       string;
  date:     string;
  bodyText: string;
  bodyHtml: string;
  isOutgoing: boolean;
}

export interface ThreadDetail {
  threadId:  string;
  accountId: string;
  subject:   string;
  messages:  ThreadMessage[];
}

interface GmailHeader { name: string; value: string }
interface GmailMessageRaw {
  id:            string;
  threadId:      string;
  internalDate:  string;
  snippet?:      string;
  labelIds?:     string[];
  payload?: {
    headers?:  GmailHeader[];
    mimeType?: string;
    body?:     { data?: string };
    parts?:    GmailMessageRaw["payload"][];
  };
}

async function gmailFetch<T>(
  accessToken: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${GMAIL_BASE}${path}`, {
    ...init,
    headers: {
      Authorization:  `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(`Gmail ${path}: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

async function findLabelId(
  accessToken: string,
  labelName: string,
): Promise<string | null> {
  const res = await gmailFetch<{ labels?: Array<{ id: string; name: string }> }>(
    accessToken,
    "/labels",
  );
  return res.labels?.find((l) => l.name === labelName)?.id ?? null;
}

function relativeKr(iso: string): { label: string; overdue: boolean } {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  const hours   = Math.floor(diffMs / 3_600_000);
  const days    = Math.floor(diffMs / 86_400_000);
  let label: string;
  if (minutes < 1)        label = "방금";
  else if (minutes < 60)  label = `${minutes}분 전`;
  else if (hours < 24)    label = `${hours}시간 전`;
  else if (days === 1)    label = "어제";
  else                    label = `${days}일 전`;
  return { label, overdue: hours >= 24 };
}

/** 모든 CS Gmail 계정에서 '답장필요' 라벨이 붙은 스레드를 통합 조회 */
export async function listReplyNeededThreads(): Promise<InboxItem[]> {
  const accounts: GmailAccount[] = await listGmailAccounts();
  const out: InboxItem[] = [];

  await Promise.all(accounts.map(async (account) => {
    let accessToken: string;
    try {
      accessToken = await getGmailAccessToken(account);
    } catch (e) {
      console.error(`[today-hub:inbox] ${account.displayName} 토큰 갱신 실패:`, e);
      return;
    }

    let list: { messages?: Array<{ id: string; threadId: string }> };
    try {
      list = await gmailFetch(
        accessToken,
        `/messages?q=${encodeURIComponent(`label:${REPLY_NEEDED_LABEL}`)}&maxResults=50`,
      );
    } catch (e) {
      console.error(`[today-hub:inbox] ${account.displayName} 리스트 실패:`, e);
      return;
    }

    // 같은 스레드 중복 제거 — 가장 첫 매치(=최신) 만 유지
    const seen = new Set<string>();
    const messages = (list.messages ?? []).filter((m) => {
      if (seen.has(m.threadId)) return false;
      seen.add(m.threadId);
      return true;
    });

    for (const m of messages) {
      try {
        const msg = await gmailFetch<GmailMessageRaw>(
          accessToken,
          `/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
        );
        const fromHeader    = extractHeader(msg, "From");
        const subjectHeader = extractHeader(msg, "Subject") ?? "(제목 없음)";
        const dateHeader    = extractHeader(msg, "Date");
        const internalDate  = msg.internalDate
          ? new Date(parseInt(msg.internalDate)).toISOString()
          : dateHeader
            ? new Date(dateHeader).toISOString()
            : new Date().toISOString();
        const { name, email } = parseFrom(fromHeader);
        const { label, overdue } = relativeKr(internalDate);
        out.push({
          id:            `${account.id}:${m.threadId}`,
          accountId:     account.id,
          accountBrand:  account.brand,
          threadId:      m.threadId,
          sender:        name || email || "(보낸이 없음)",
          senderEmail:   email,
          subject:       subjectHeader,
          snippet:       msg.snippet ?? "",
          receivedAt:    internalDate,
          receivedLabel: label,
          overdue,
          gmailWebUrl:   `https://mail.google.com/mail/u/0/#all/${m.threadId}`,
        });
      } catch (e) {
        console.warn(`[today-hub:inbox] 메시지 ${m.id} 메타 조회 실패:`, e);
      }
    }
  }));

  // 최신순
  out.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  return out;
}

/** 스레드 본문(받은+보낸 모두) 시간순으로 가져옴 */
export async function getThreadDetail(
  accountId: string,
  threadId:  string,
): Promise<ThreadDetail | null> {
  const accounts = await listGmailAccounts();
  const account  = accounts.find((a) => a.id === accountId);
  if (!account) return null;

  const accessToken = await getGmailAccessToken(account);
  const res = await gmailFetch<{ messages?: GmailMessageRaw[] }>(
    accessToken,
    `/threads/${threadId}?format=full`,
  );
  const msgs = res.messages ?? [];
  if (msgs.length === 0) return null;

  const subject = extractHeader(msgs[0], "Subject") ?? "(제목 없음)";
  const messages: ThreadMessage[] = msgs.map((m) => {
    const { text, html } = extractBody(m);
    return {
      from: extractHeader(m, "From") ?? "",
      to:   extractHeader(m, "To") ?? "",
      date: extractHeader(m, "Date") ?? "",
      bodyText: text,
      bodyHtml: html,
      isOutgoing: (m.labelIds ?? []).includes("SENT"),
    };
  });

  return { threadId, accountId, subject, messages };
}

/** '답장필요' 라벨만 제거 (답장 작성 없이 완료 표시할 때) */
export async function unlabelThread(
  accountId: string,
  threadId:  string,
): Promise<void> {
  const accounts = await listGmailAccounts();
  const account  = accounts.find((a) => a.id === accountId);
  if (!account) throw new Error("Gmail 계정 미등록");

  const accessToken = await getGmailAccessToken(account);
  const labelId     = await findLabelId(accessToken, REPLY_NEEDED_LABEL);
  if (!labelId) return; // 라벨 자체가 없으면 할 일 없음

  await gmailFetch(accessToken, `/threads/${threadId}/modify`, {
    method: "POST",
    body:   JSON.stringify({ removeLabelIds: [labelId] }),
  });
}

/** 답장 전송 + '답장필요' 라벨 자동 제거 */
export async function sendReplyAndUnlabel(
  accountId: string,
  threadId:  string,
  body:      string,
): Promise<{ ok: boolean; error?: string; messageId?: string }> {
  const accounts = await listGmailAccounts();
  const account  = accounts.find((a) => a.id === accountId);
  if (!account) return { ok: false, error: "Gmail 계정 미등록" };

  let accessToken: string;
  try {
    accessToken = await getGmailAccessToken(account);
  } catch (e) {
    return { ok: false, error: `토큰 갱신 실패: ${e instanceof Error ? e.message : String(e)}` };
  }

  // 답장 헤더 구성을 위해 스레드 메타 조회
  let thread: { messages?: GmailMessageRaw[] };
  try {
    thread = await gmailFetch(
      accessToken,
      `/threads/${threadId}?format=metadata&metadataHeaders=From&metadataHeaders=Message-ID&metadataHeaders=References&metadataHeaders=Subject`,
    );
  } catch (e) {
    return { ok: false, error: `스레드 조회 실패: ${e instanceof Error ? e.message : String(e)}` };
  }
  const msgs = thread.messages ?? [];
  if (msgs.length === 0) return { ok: false, error: "스레드에 메시지 없음" };

  // 가장 최근 수신 메시지 (SENT 라벨 없는 마지막) — 없으면 마지막 메시지
  const last =
    [...msgs].reverse().find((m) => !(m.labelIds ?? []).includes("SENT")) ??
    msgs[msgs.length - 1];

  const fromHeader = extractHeader(last, "From") ?? "";
  const messageId  = extractHeader(last, "Message-ID");
  const references = extractHeader(last, "References");
  const subjectRaw = extractHeader(last, "Subject") ?? "(답장)";
  const { email: toAddress } = parseFrom(fromHeader);
  if (!toAddress) return { ok: false, error: "수신자 주소 추출 실패" };

  const subject = subjectRaw.startsWith("Re:") ? subjectRaw : `Re: ${subjectRaw}`;
  const headerLines = [
    `To: ${toAddress}`,
    `Subject: ${encodeMimeHeader(subject)}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `MIME-Version: 1.0`,
  ];
  if (messageId) headerLines.push(`In-Reply-To: ${messageId}`);
  if (messageId || references) {
    const refs = [references, messageId].filter(Boolean).join(" ");
    headerLines.push(`References: ${refs}`);
  }

  const rfc822 = headerLines.join("\r\n") + "\r\n\r\n" + body;
  const raw = Buffer.from(rfc822, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const sendRes = await fetch(`${GMAIL_BASE}/messages/send`, {
    method:  "POST",
    headers: {
      Authorization:  `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw, threadId }),
  });
  if (!sendRes.ok) {
    return { ok: false, error: `Gmail 전송 실패: ${await sendRes.text()}` };
  }
  const json = (await sendRes.json()) as { id: string };

  // 라벨 제거 — 답장은 성공했으므로 실패해도 경고만
  try {
    await unlabelThread(accountId, threadId);
  } catch (e) {
    console.warn("[today-hub:inbox] 답장 후 라벨 제거 실패:", e);
  }

  return { ok: true, messageId: json.id };
}

function encodeMimeHeader(text: string): string {
  if (/^[\x20-\x7E]*$/.test(text)) return text;
  const b64 = Buffer.from(text, "utf-8").toString("base64");
  return `=?UTF-8?B?${b64}?=`;
}
