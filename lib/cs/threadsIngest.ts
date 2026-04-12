/**
 * Threads 답글/멘션 수집.
 *
 * 사용하는 엔드포인트 (Threads Graph API):
 *  - GET /me/threads?fields=id,timestamp,text — 내 최근 글 목록
 *  - GET /{thread_id}/replies?fields=id,username,text,timestamp,from — 해당 글의 답글
 *  - GET /me/mentions?fields=id,username,text,timestamp — 나를 멘션한 글 (스코프 필요)
 *
 * 권한: threads_read_replies (이미 OAuth 스코프에 포함됨)
 *
 * 1단계에서는 "내 최근 7일 포스트의 답글 중 내가 쓰지 않은 것"을 unanswered로 올린다.
 */

import { getThreadsTokenFromStore } from "../threadsTokenStore";
import { ingestMessage } from "./store";
import type { CsBrandId, IngestPayload } from "./types";

const GRAPH = "https://graph.threads.net/v1.0";

interface ThreadPost {
  id: string;
  text?: string;
  timestamp: string;
  username?: string;
}

interface ThreadReply {
  id: string;
  text?: string;
  timestamp: string;
  username?: string;
  from?: { id: string; username: string };
  hide_status?: string;
}

async function tfetch<T>(url: string, token: string): Promise<T> {
  const sep = url.includes("?") ? "&" : "?";
  const res = await fetch(`${url}${sep}access_token=${encodeURIComponent(token)}`);
  if (!res.ok) {
    throw new Error(`Threads API ${url} 실패: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

async function fetchRecentPosts(token: string, sinceDays = 7): Promise<ThreadPost[]> {
  const since = Math.floor((Date.now() - sinceDays * 24 * 60 * 60 * 1000) / 1000);
  const url = `${GRAPH}/me/threads?fields=id,text,timestamp,username&limit=25&since=${since}`;
  const json = await tfetch<{ data?: ThreadPost[] }>(url, token);
  return json.data ?? [];
}

async function fetchRepliesForPost(
  token: string,
  postId: string
): Promise<ThreadReply[]> {
  const url = `${GRAPH}/${postId}/replies?fields=id,text,timestamp,username,from,hide_status&reverse=true&limit=50`;
  const json = await tfetch<{ data?: ThreadReply[] }>(url, token);
  return json.data ?? [];
}

async function fetchMyUsername(token: string): Promise<string | null> {
  try {
    const url = `${GRAPH}/me?fields=id,username`;
    const json = await tfetch<{ username?: string }>(url, token);
    return json.username ?? null;
  } catch {
    return null;
  }
}

async function syncBrand(brand: CsBrandId): Promise<{
  inserted: number;
  skipped: number;
}> {
  const token = await getThreadsTokenFromStore(brand);
  if (!token) return { inserted: 0, skipped: 0 };

  const myUsername = await fetchMyUsername(token);
  const posts = await fetchRecentPosts(token);

  let inserted = 0;
  let skipped = 0;

  for (const post of posts) {
    let replies: ThreadReply[] = [];
    try {
      replies = await fetchRepliesForPost(token, post.id);
    } catch {
      continue;
    }

    for (const reply of replies) {
      const replierUsername = reply.from?.username ?? reply.username;
      // 내가 쓴 답글은 건너뜀 (in-bound만 수집)
      if (myUsername && replierUsername === myUsername) {
        skipped++;
        continue;
      }

      const payload: IngestPayload = {
        brand,
        channel: "threads",
        externalThreadId: post.id, // 원글 ID로 스레드 묶음
        externalMessageId: reply.id,
        customerHandle: replierUsername ?? undefined,
        customerName: replierUsername ?? undefined,
        subject: post.text?.slice(0, 80) ?? "(Threads 답글)",
        bodyText: reply.text ?? "",
        sentAt: new Date(reply.timestamp),
        direction: "in",
        raw: reply,
      };

      const result = await ingestMessage(payload);
      if (result.inserted) inserted++;
      else skipped++;
    }
  }

  return { inserted, skipped };
}

export async function syncAllThreadsBrands(): Promise<{
  inserted: number;
  skipped: number;
  errors: string[];
}> {
  const brands: CsBrandId[] = ["paulvice", "harriot"];
  let inserted = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const brand of brands) {
    try {
      const r = await syncBrand(brand);
      inserted += r.inserted;
      skipped += r.skipped;
    } catch (err) {
      errors.push(`${brand}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { inserted, skipped, errors };
}
