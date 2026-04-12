import { getThread, getCsSupabase, ingestMessage } from "./store";
import {
  extractHeader,
  getGmailAccessToken,
  listGmailAccounts,
} from "./gmailClient";
import { getThreadsTokenFromStore } from "../threadsTokenStore";
import type { CsBrandId, CsChannel } from "./types";

export interface ReplyResult {
  ok: boolean;
  externalMessageId?: string;
  error?: string;
}

export async function sendReply(
  threadId: string,
  body: string
): Promise<ReplyResult> {
  const data = await getThread(threadId);
  if (!data) return { ok: false, error: "thread not found" };
  const { thread } = data;

  const dispatchers: Partial<
    Record<CsChannel, (threadId: string, body: string) => Promise<ReplyResult>>
  > = {
    gmail: sendGmailReply,
    threads: sendThreadsReply,
  };

  const fn = dispatchers[thread.channel];
  if (!fn) {
    return {
      ok: false,
      error: `${thread.channel} 채널은 아직 답장을 지원하지 않습니다. 해당 채널 어드민에서 직접 답변해 주세요.`,
    };
  }

  return fn(threadId, body);
}

async function sendGmailReply(
  threadId: string,
  body: string
): Promise<ReplyResult> {
  const data = await getThread(threadId);
  if (!data) return { ok: false, error: "thread not found" };
  const { thread, messages } = data;

  const accounts = await listGmailAccounts();
  const account = accounts.find((a) => a.brand === thread.brand);
  if (!account) return { ok: false, error: "Gmail 계정 미등록" };

  const last = [...messages].reverse().find((m) => m.direction === "in");
  if (!last) return { ok: false, error: "원본 수신 메시지 없음" };

  const rawHeaders = (last.raw ?? {}) as Record<string, unknown>;
  const gmailHeaders = ((rawHeaders.headers ??
    (rawHeaders.payload as { headers?: Array<{ name: string; value: string }> } | undefined)
      ?.headers) ?? []) as Array<{ name: string; value: string }>;
  const pseudoMsg = { payload: { headers: gmailHeaders } } as Parameters<
    typeof extractHeader
  >[0];
  const messageId = extractHeader(pseudoMsg, "Message-ID");
  const references = extractHeader(pseudoMsg, "References");
  const toAddress = thread.customer_handle;
  const subject = thread.subject?.startsWith("Re:")
    ? thread.subject
    : `Re: ${thread.subject ?? "(답장)"}`;

  if (!toAddress) return { ok: false, error: "수신 이메일 주소 없음" };

  const accessToken = await getGmailAccessToken(account);

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

  const res = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw, threadId: thread.external_thread_id }),
    }
  );

  if (!res.ok) {
    return { ok: false, error: `Gmail 전송 실패: ${await res.text()}` };
  }

  const json = (await res.json()) as { id: string };

  await ingestMessage({
    brand: thread.brand as CsBrandId,
    channel: "gmail",
    externalThreadId: thread.external_thread_id,
    externalMessageId: json.id,
    bodyText: body,
    sentAt: new Date(),
    direction: "out",
    raw: { sent_via: "inbox_ui" },
  });

  // 상태: 내가 답했으므로 waiting으로
  const db = getCsSupabase();
  await db.from("cs_threads").update({ status: "waiting" }).eq("id", threadId);

  return { ok: true, externalMessageId: json.id };
}

async function sendThreadsReply(
  threadId: string,
  body: string
): Promise<ReplyResult> {
  const data = await getThread(threadId);
  if (!data) return { ok: false, error: "thread not found" };
  const { thread } = data;

  const token = await getThreadsTokenFromStore(thread.brand as CsBrandId);
  if (!token) return { ok: false, error: "Threads 토큰 없음" };

  // Threads: 답글은 먼저 container를 만든 다음 publish 해야 함.
  // reply_to_id는 원글의 thread_id가 아니라 댓글 맥락에 맞는 메시지 id.
  // 1단계에서는 원본 externalThreadId(=원글 id)에 답글을 다는 방식으로 동작.
  const replyToId = thread.external_thread_id;

  const createRes = await fetch(
    `https://graph.threads.net/v1.0/me/threads?media_type=TEXT&text=${encodeURIComponent(body)}&reply_to_id=${encodeURIComponent(replyToId)}&access_token=${encodeURIComponent(token)}`,
    { method: "POST" }
  );
  if (!createRes.ok) {
    return { ok: false, error: `Threads container 생성 실패: ${await createRes.text()}` };
  }
  const { id: containerId } = (await createRes.json()) as { id: string };

  const publishRes = await fetch(
    `https://graph.threads.net/v1.0/me/threads_publish?creation_id=${encodeURIComponent(containerId)}&access_token=${encodeURIComponent(token)}`,
    { method: "POST" }
  );
  if (!publishRes.ok) {
    return { ok: false, error: `Threads publish 실패: ${await publishRes.text()}` };
  }
  const { id: publishedId } = (await publishRes.json()) as { id: string };

  await ingestMessage({
    brand: thread.brand as CsBrandId,
    channel: "threads",
    externalThreadId: thread.external_thread_id,
    externalMessageId: publishedId,
    bodyText: body,
    sentAt: new Date(),
    direction: "out",
    raw: { sent_via: "inbox_ui" },
  });

  const db = getCsSupabase();
  await db.from("cs_threads").update({ status: "waiting" }).eq("id", threadId);

  return { ok: true, externalMessageId: publishedId };
}

function encodeMimeHeader(text: string): string {
  // RFC 2047: ASCII가 아닌 문자는 base64 encoded-word로
  if (/^[\x20-\x7E]*$/.test(text)) return text;
  const b64 = Buffer.from(text, "utf-8").toString("base64");
  return `=?UTF-8?B?${b64}?=`;
}
