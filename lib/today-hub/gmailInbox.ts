/**
 * 답장 필요 인박스 — 분류된 메일 list/상세/답장/피드백.
 * 라벨 기반 → AI 분류 기반으로 v2 전환.
 *
 * 데이터 소스: today_hub_inbox:msg:* (inboxStore)
 *  - needsReply=true && !userMarkedNotNeeded && !userReplied 만 위젯에 노출
 *  - 답장 보내면 userReplied=true 로 자동 마킹
 *  - 사용자가 '필요없음' 누르면 userMarkedNotNeeded=true + 부정 사례 누적
 */
import { getGoogleAccessTokenFromStore } from "@/lib/googleTokenStore";
import {
  listClassifiedEmails, getClassifiedEmail, patchClassifiedEmail,
  addNegativeExample, type ClassifiedEmail,
} from "./inboxStore";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

interface GmailMessageRaw {
  id:           string;
  threadId:     string;
  internalDate: string;
  snippet?:     string;
  labelIds?:    string[];
  payload?: {
    headers?:  Array<{ name: string; value: string }>;
    mimeType?: string;
    body?:     { data?: string };
    parts?:    GmailMessageRaw["payload"][];
  };
}

export interface InboxItem {
  id:            string;            // composite: threadId (위젯 React key)
  messageId:     string;
  threadId:      string;
  sender:        string;
  senderEmail:   string;
  subject:       string;
  snippet:       string;
  receivedAt:    string;
  receivedLabel: string;
  overdue:       boolean;
  /** AI 분류 사유 — UI tooltip */
  reason:        string;
  confidence:    number;
  gmailWebUrl:   string;
}

export interface ThreadMessage {
  from:       string;
  to:         string;
  date:       string;
  bodyText:   string;
  bodyHtml:   string;
  isOutgoing: boolean;
}

export interface ThreadDetail {
  threadId: string;
  subject:  string;
  messages: ThreadMessage[];
}

async function gmailFetch<T>(
  token: string,
  path:  string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${GMAIL_BASE}${path}`, {
    ...init,
    headers: {
      Authorization:  `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 403 && /insufficient|ACCESS_TOKEN_SCOPE/i.test(body)) {
      throw new Error(
        "Gmail 스코프 부족 (gmail.modify). " +
        "/api/auth/google/login?hint=shong@harriotwatches.com 으로 재연결 후 동의 화면에서 Gmail 권한 체크.",
      );
    }
    throw new Error(`Gmail ${path}: ${res.status} ${body}`);
  }
  return res.json() as Promise<T>;
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

/**
 * Gmail 스레드에서 이미 답장이 나갔는지 자동 감지.
 * 사용자가 CS 인박스, Gmail 웹/모바일 어디서든 보냈으면 SENT 메시지가 스레드에 추가됨.
 * 받은 시각보다 새로운 SENT 메시지가 있으면 userReplied=true 로 캐시 갱신 + 위젯에서 제외.
 */
async function dismissAlreadyReplied(
  items: ClassifiedEmail[],
): Promise<ClassifiedEmail[]> {
  if (items.length === 0) return items;
  let token: string | null;
  try {
    token = await getGoogleAccessTokenFromStore();
  } catch {
    return items; // 토큰 못 가져오면 그냥 통과 (위젯은 정상 표시)
  }
  if (!token) return items;

  const checks = await Promise.allSettled(
    items.map(async (item) => {
      try {
        const thread = await gmailFetch<{
          messages?: Array<{
            labelIds?: string[];
            internalDate?: string;
          }>;
        }>(token, `/threads/${item.threadId}?format=minimal`);
        const msgs = thread.messages ?? [];

        let latestReceived = 0;
        let latestSent = 0;
        for (const m of msgs) {
          const ts = parseInt(m.internalDate || "0", 10);
          if ((m.labelIds ?? []).includes("SENT")) {
            if (ts > latestSent) latestSent = ts;
          } else {
            if (ts > latestReceived) latestReceived = ts;
          }
        }
        // 받은 메시지 이후에 보낸 메시지가 있으면 답장 완료로 간주
        const replied = latestSent > 0 && latestSent >= latestReceived;
        return { item, replied };
      } catch {
        return { item, replied: false };
      }
    }),
  );

  const remaining: ClassifiedEmail[] = [];
  for (const r of checks) {
    if (r.status !== "fulfilled") continue;
    const { item, replied } = r.value;
    if (replied) {
      // 캐시 갱신 — 다음 호출부터는 Gmail 재조회 없이 빠르게 제외됨
      await patchClassifiedEmail(item.messageId, {
        userReplied: true,
        dismissedAt: new Date().toISOString(),
      }).catch(() => {});
    } else {
      remaining.push(item);
    }
  }
  return remaining;
}

/** 위젯에 노출할 메일 목록 — 분류 결과 중 needsReply 인 것만, 사용자 처리된 건 제외 */
export async function listInboxItems(): Promise<InboxItem[]> {
  const all = await listClassifiedEmails();
  const candidates = all.filter(
    (e) => e.needsReply && !e.userMarkedNotNeeded && !e.userReplied,
  );
  // CS 인박스 / Gmail 웹 / 모바일 어디서든 답장했으면 자동 감지 후 제외
  const visible = await dismissAlreadyReplied(candidates);
  return visible
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
    .map((e) => {
      const { label, overdue } = relativeKr(e.receivedAt);
      return {
        id:            e.threadId,
        messageId:     e.messageId,
        threadId:      e.threadId,
        sender:        e.fromName || e.fromEmail,
        senderEmail:   e.fromEmail,
        subject:       e.subject,
        snippet:       e.snippet,
        receivedAt:    e.receivedAt,
        receivedLabel: label,
        overdue,
        reason:        e.reason,
        confidence:    e.confidence,
        gmailWebUrl:   `https://mail.google.com/mail/u/0/#all/${e.threadId}`,
      };
    });
}

/** 스레드 본문 — 모달용 */
export async function getThreadDetail(threadId: string): Promise<ThreadDetail | null> {
  const token = await getGoogleAccessTokenFromStore();
  if (!token) throw new Error("Google 미연결");

  const res = await gmailFetch<{ messages?: GmailMessageRaw[] }>(
    token,
    `/threads/${threadId}?format=full`,
  );
  const msgs = res.messages ?? [];
  if (msgs.length === 0) return null;

  function getHeader(msg: GmailMessageRaw, name: string): string {
    return (msg.payload?.headers ?? [])
      .find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
  }

  function decodeBase64Url(data: string): string {
    const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(b64, "base64").toString("utf-8");
  }

  function htmlToText(html: string): string {
    if (!html) return "";
    return html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<\/li>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function extractBody(msg: GmailMessageRaw): { text: string; html: string } {
    let text = "", html = "";
    function walk(part?: GmailMessageRaw["payload"]): void {
      if (!part) return;
      const mime = part.mimeType ?? "";
      const data = part.body?.data;
      if (data) {
        const decoded = decodeBase64Url(data);
        if (mime === "text/plain") text += decoded;
        else if (mime === "text/html") html += decoded;
      }
      for (const child of part.parts ?? []) walk(child);
    }
    walk(msg.payload);
    // text 가 없거나 너무 짧으면 html 에서 추출 — HTML-only 메일 대응
    if (!text.trim() || text.trim().length < 50) {
      const fromHtml = htmlToText(html);
      if (fromHtml.length > text.length) text = fromHtml;
    }
    if (!text && msg.snippet) text = msg.snippet;
    return { text, html };
  }

  const subject = getHeader(msgs[0], "Subject") || "(제목 없음)";
  const messages: ThreadMessage[] = msgs.map((m) => {
    const { text, html } = extractBody(m);
    return {
      from:       getHeader(m, "From"),
      to:         getHeader(m, "To"),
      date:       getHeader(m, "Date"),
      bodyText:   text,
      bodyHtml:   html,
      isOutgoing: (m.labelIds ?? []).includes("SENT"),
    };
  });

  return { threadId, subject, messages };
}

/** 답장 전송 — 성공 시 ClassifiedEmail.userReplied=true 자동 마킹 */
export async function sendReplyToThread(
  threadId: string,
  body:     string,
): Promise<{ ok: boolean; error?: string; messageId?: string }> {
  const token = await getGoogleAccessTokenFromStore();
  if (!token) return { ok: false, error: "Google 미연결" };

  // 답장 헤더 구성
  const thread = await gmailFetch<{ messages?: GmailMessageRaw[] }>(
    token,
    `/threads/${threadId}?format=metadata&metadataHeaders=From&metadataHeaders=Message-ID&metadataHeaders=References&metadataHeaders=Subject`,
  );
  const msgs = thread.messages ?? [];
  if (msgs.length === 0) return { ok: false, error: "스레드 비어있음" };

  const last = [...msgs].reverse().find((m) => !(m.labelIds ?? []).includes("SENT")) ?? msgs[msgs.length - 1];

  const getHeader = (m: GmailMessageRaw, n: string): string =>
    (m.payload?.headers ?? []).find((h) => h.name.toLowerCase() === n.toLowerCase())?.value ?? "";

  const fromHeader = getHeader(last, "From");
  const messageId  = getHeader(last, "Message-ID");
  const references = getHeader(last, "References");
  const subjectRaw = getHeader(last, "Subject") || "(답장)";

  const m = fromHeader.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  const toAddress = m ? m[2].trim() : (fromHeader.includes("@") ? fromHeader.trim() : "");
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
    headerLines.push(`References: ${[references, messageId].filter(Boolean).join(" ")}`);
  }

  const rfc822 = headerLines.join("\r\n") + "\r\n\r\n" + body;
  const raw = Buffer.from(rfc822, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const sendRes = await fetch(`${GMAIL_BASE}/messages/send`, {
    method:  "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body:    JSON.stringify({ raw, threadId }),
  });
  if (!sendRes.ok) return { ok: false, error: `Gmail 전송 실패: ${await sendRes.text()}` };
  const json = (await sendRes.json()) as { id: string };

  // 분류 캐시에서 같은 threadId 의 모든 항목을 userReplied=true 처리 (한 스레드에 여러 messageId 가 있을 수 있음)
  const all = await listClassifiedEmails();
  for (const e of all) {
    if (e.threadId === threadId && !e.userReplied) {
      await patchClassifiedEmail(e.messageId, {
        userReplied: true,
        dismissedAt: new Date().toISOString(),
      });
    }
  }

  return { ok: true, messageId: json.id };
}

/**
 * 수동 '답변 완료' 마킹 — 위젯에서 숨김.
 * markNotNeeded 와 다른 점: 부정 사례로 학습시키지 않음 (분류는 정확했고, 단지 이미 답장한 상태).
 */
export async function markReplied(messageId: string): Promise<{ ok: boolean; error?: string }> {
  const email = await getClassifiedEmail(messageId);
  if (!email) return { ok: false, error: "분류 결과 없음" };
  // 같은 threadId 의 모든 항목을 함께 마킹 (스레드 내 여러 메시지가 분류돼있을 수 있음)
  const all = await listClassifiedEmails();
  for (const e of all) {
    if (e.threadId === email.threadId && !e.userReplied) {
      await patchClassifiedEmail(e.messageId, {
        userReplied: true,
        dismissedAt: new Date().toISOString(),
      });
    }
  }
  return { ok: true };
}

/** '필요없음' 처리 — 위젯에서 숨김 + 부정 사례로 누적해 다음 분류에 영향 */
export async function markNotNeeded(messageId: string, userReason?: string): Promise<{ ok: boolean; error?: string }> {
  const email = await getClassifiedEmail(messageId);
  if (!email) return { ok: false, error: "분류 결과 없음" };

  await patchClassifiedEmail(messageId, {
    userMarkedNotNeeded: true,
    dismissedAt:         new Date().toISOString(),
  });

  await addNegativeExample({
    fromEmail:     email.fromEmail,
    subjectSample: email.subject,
    reason:        userReason || `사용자가 '${email.fromName ?? email.fromEmail}'의 메일을 답장 불필요로 분류`,
    createdAt:     new Date().toISOString(),
  });

  return { ok: true };
}

function encodeMimeHeader(text: string): string {
  if (/^[\x20-\x7E]*$/.test(text)) return text;
  const b64 = Buffer.from(text, "utf-8").toString("base64");
  return `=?UTF-8?B?${b64}?=`;
}

// 기존 파일이 export 하던 타입과의 호환을 위해 re-export
export type { ClassifiedEmail };
