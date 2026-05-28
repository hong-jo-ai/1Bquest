/**
 * Reddit 받은편지함 → CS 인박스 동기화 (폴링).
 *
 * /message/inbox 의 각 항목을 IngestPayload 로 정규화해 ingestMessage 로 저장.
 * 중복은 externalMessageId(= 레딧 fullname)로 ingestMessage 가 전역 dedup.
 *
 *   - 쪽지(t4)  : DM 스레드 단위(first_message_name 루트)로 그룹핑
 *   - 댓글(t1)  : 댓글이 달린 글(post) 단위로 그룹핑 (멘션/댓글답글/글답글 공통)
 */
import { ingestMessage } from "./store";
import { listRedditAccounts, fetchInbox, postIdFromContext, type RedditAccount, type RedditInboxItem } from "./reddit";
import type { IngestPayload } from "./types";

interface SyncResult {
  accounts: number;
  inserted: number;
  skipped: number;
  errors: string[];
}

function toPayload(acc: RedditAccount, item: RedditInboxItem): IngestPayload | null {
  if (!item.name) return null;
  // 우리가 보낸 메시지는 받은편지함에 없지만, 혹시라도 author가 우리면 제외
  if (item.author && item.author.toLowerCase() === acc.username.toLowerCase()) return null;

  const author = item.author ?? "[deleted]";
  const isDm = item.kind === "t4";

  let externalThreadId: string;
  let subject: string;
  if (isDm) {
    externalThreadId = `dm:${item.firstMessageName ?? item.name}`;
    subject = item.subject || "Reddit 쪽지";
  } else {
    const postId = postIdFromContext(item.context);
    externalThreadId = postId ? `post:${postId}` : `cmt:${item.name}`;
    // 글 제목 우선, 없으면 subject(comment reply/username mention 등)
    subject = item.linkTitle || item.subject || "Reddit 댓글";
  }

  return {
    brand: acc.brand,
    channel: "reddit",
    externalThreadId,
    externalMessageId: item.name, // 레딧 fullname — 전역 유니크
    customerHandle: author,
    customerName: author,
    subject,
    bodyText: item.body || undefined,
    bodyHtml: item.bodyHtml ?? undefined,
    sentAt: new Date((item.createdUtc || Date.now() / 1000) * 1000),
    direction: "in",
    raw: item,
  };
}

export async function syncAllRedditAccounts(): Promise<SyncResult> {
  const accounts = await listRedditAccounts();
  let inserted = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const acc of accounts) {
    if (!acc.clientId || !acc.username) {
      errors.push(`${acc.displayName}: client_id/username 미설정`);
      continue;
    }
    try {
      const items = await fetchInbox(acc);
      for (const item of items) {
        const payload = toPayload(acc, item);
        if (!payload) { skipped++; continue; }
        try {
          const res = await ingestMessage(payload);
          if (res.inserted) inserted++; else skipped++;
        } catch (e) {
          errors.push(`${acc.displayName}/${item.name}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    } catch (e) {
      errors.push(`${acc.displayName}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { accounts: accounts.length, inserted, skipped, errors };
}
