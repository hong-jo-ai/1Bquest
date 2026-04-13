import { getThread, getCsSupabase, ingestMessage } from "./store";
import {
  extractHeader,
  getGmailAccessToken,
  listGmailAccounts,
} from "./gmailClient";
import { getThreadsTokenFromStore } from "../threadsTokenStore";
import { listCrispAccounts, sendCrispMessage } from "./crispClient";
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
    crisp: sendCrispReply,
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
  const { thread, messages } = data;

  const token = await getThreadsTokenFromStore(thread.brand as CsBrandId);
  if (!token) return { ok: false, error: "Threads 토큰 없음" };

  // 답장 대상: 가장 최근 "수신(in)" 메시지의 external_message_id (= 고객 댓글 id)
  // 없으면 원글 id로 폴백
  const latestIn = [...messages].reverse().find((m) => m.direction === "in");
  const replyToId =
    latestIn?.external_message_id ?? thread.external_thread_id;
  if (!replyToId) return { ok: false, error: "답장 대상 id 없음" };

  const BASE = "https://graph.threads.net/v1.0";

  try {
    // 1) userId 조회
    const meRes = await fetch(
      `${BASE}/me?fields=id&access_token=${encodeURIComponent(token)}`,
      { cache: "no-store" }
    );
    if (!meRes.ok) {
      return { ok: false, error: `Threads 계정 조회 실패: ${await meRes.text()}` };
    }
    const me = (await meRes.json()) as { id: string };

    // 2) 대댓글 컨테이너 생성 (POST form body)
    const containerRes = await fetch(`${BASE}/${me.id}/threads`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        access_token: token,
        media_type: "TEXT",
        text: body.trim(),
        reply_to_id: replyToId,
      }),
    });
    if (!containerRes.ok) {
      return {
        ok: false,
        error: `Threads 컨테이너 생성 실패: ${await containerRes.text()}`,
      };
    }
    const container = (await containerRes.json()) as { id: string };

    // 3) 컨테이너 FINISHED 대기 (최대 15초)
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const statusRes = await fetch(
        `${BASE}/${container.id}?fields=status&access_token=${encodeURIComponent(token)}`,
        { cache: "no-store" }
      );
      if (statusRes.ok) {
        const s = (await statusRes.json()) as { status?: string };
        if (s.status === "FINISHED") break;
        if (s.status === "ERROR") {
          return { ok: false, error: "Threads 컨테이너 처리 에러" };
        }
      }
    }

    // 4) 게시
    const publishRes = await fetch(`${BASE}/${me.id}/threads_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        access_token: token,
        creation_id: container.id,
      }),
    });
    if (!publishRes.ok) {
      return {
        ok: false,
        error: `Threads 게시 실패: ${await publishRes.text()}`,
      };
    }
    const published = (await publishRes.json()) as { id: string };

    // DB에 내 답장 기록
    await ingestMessage({
      brand: thread.brand as CsBrandId,
      channel: "threads",
      externalThreadId: thread.external_thread_id,
      externalMessageId: published.id,
      bodyText: body,
      sentAt: new Date(),
      direction: "out",
      raw: { sent_via: "inbox_ui", reply_to_id: replyToId },
    });

    const db = getCsSupabase();
    await db
      .from("cs_threads")
      .update({ status: "waiting" })
      .eq("id", threadId);

    return { ok: true, externalMessageId: published.id };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function sendCrispReply(
  threadId: string,
  body: string
): Promise<ReplyResult> {
  const data = await getThread(threadId);
  if (!data) return { ok: false, error: "thread not found" };
  const { thread } = data;

  const accounts = await listCrispAccounts();
  const account = accounts.find((a) => a.brand === thread.brand);
  if (!account) return { ok: false, error: "Crisp 계정 미등록" };

  try {
    const result = await sendCrispMessage(
      account,
      thread.external_thread_id,
      body
    );

    await ingestMessage({
      brand: thread.brand as CsBrandId,
      channel: "crisp",
      externalThreadId: thread.external_thread_id,
      externalMessageId: `${thread.external_thread_id}:${result.fingerprint}`,
      bodyText: body,
      sentAt: new Date(),
      direction: "out",
      raw: { sent_via: "inbox_ui" },
    });

    const db = getCsSupabase();
    await db
      .from("cs_threads")
      .update({ status: "waiting" })
      .eq("id", threadId);

    return { ok: true, externalMessageId: String(result.fingerprint) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function encodeMimeHeader(text: string): string {
  // RFC 2047: ASCII가 아닌 문자는 base64 encoded-word로
  if (/^[\x20-\x7E]*$/.test(text)) return text;
  const b64 = Buffer.from(text, "utf-8").toString("base64");
  return `=?UTF-8?B?${b64}?=`;
}
