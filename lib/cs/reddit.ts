/**
 * Reddit CS 클라이언트 — "script" 앱 OAuth(password grant).
 *
 * 단일 브랜드 소유 계정의 받은편지함을 폴링하고 답글을 작성한다.
 * cs_accounts(channel='reddit').credentials JSON:
 *   { client_id, client_secret, username, password, user_agent? }
 *
 * Reddit API 규칙: 모든 요청에 식별 가능한 User-Agent 필수. 토큰은 1시간 만료.
 */
import type { CsBrandId } from "./types";
import { getCsSupabase } from "./store";

export interface RedditAccount {
  id: string;
  brand: CsBrandId;
  displayName: string;
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  userAgent: string;
}

export interface RedditInboxItem {
  kind: "t1" | "t4" | string; // t1=댓글, t4=쪽지(DM)
  name: string;               // fullname (예: t1_abc, t4_def)
  id: string;
  author: string | null;      // 보낸 사람(레딧 유저명)
  subject: string;
  body: string;
  bodyHtml: string | null;
  createdUtc: number;         // unix sec
  wasComment: boolean;
  context: string | null;     // 댓글 permalink (/r/sub/comments/<postId>/.../<cid>/)
  linkTitle: string | null;   // 댓글이 달린 글 제목
  subreddit: string | null;
  firstMessageName: string | null; // DM 스레드 루트
  parentId: string | null;
}

export async function listRedditAccounts(): Promise<RedditAccount[]> {
  const db = getCsSupabase();
  const { data, error } = await db
    .from("cs_accounts")
    .select("*")
    .eq("channel", "reddit")
    .in("status", ["active", "error"]);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const c = (row.credentials ?? {}) as Record<string, unknown>;
    const username = (c.username as string) ?? "";
    return {
      id: row.id as string,
      brand: row.brand as CsBrandId,
      displayName: (row.display_name as string) ?? username,
      clientId: (c.client_id as string) ?? "",
      clientSecret: (c.client_secret as string) ?? "",
      username,
      password: (c.password as string) ?? "",
      userAgent: (c.user_agent as string) || `paulwise-cs/1.0 by /u/${username || "unknown"}`,
    };
  });
}

// access_token 캐시 (계정별, 만료 1분 전까지 재사용)
const tokenCache = new Map<string, { token: string; exp: number }>();

export async function getRedditToken(acc: RedditAccount): Promise<string> {
  const cached = tokenCache.get(acc.id);
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;

  const basic = Buffer.from(`${acc.clientId}:${acc.clientSecret}`).toString("base64");
  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": acc.userAgent,
    },
    body: new URLSearchParams({
      grant_type: "password",
      username: acc.username,
      password: acc.password,
      scope: "read privatemessages submit history identity",
    }),
  });
  if (!res.ok) {
    throw new Error(`Reddit 토큰 발급 실패 (${res.status}): ${await res.text().catch(() => "")}`);
  }
  const j = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!j.access_token) throw new Error(`Reddit 토큰 응답 오류: ${j.error ?? "no access_token"}`);
  tokenCache.set(acc.id, { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 });
  return j.access_token;
}

async function redditFetch(acc: RedditAccount, path: string, init?: RequestInit): Promise<Response> {
  const token = await getRedditToken(acc);
  return fetch(`https://oauth.reddit.com${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `bearer ${token}`,
      "User-Agent": acc.userAgent,
    },
  });
}

/** 받은편지함(쪽지 + 댓글답글 + 멘션) 최신 항목. */
export async function fetchInbox(acc: RedditAccount, limit = 100): Promise<RedditInboxItem[]> {
  const res = await redditFetch(acc, `/message/inbox?limit=${limit}`);
  if (!res.ok) throw new Error(`Reddit 받은편지함 조회 실패 (${res.status})`);
  const j = (await res.json()) as { data?: { children?: { kind: string; data: Record<string, unknown> }[] } };
  const children = j?.data?.children ?? [];
  return children.map(({ kind, data: d }) => ({
    kind,
    name: (d.name as string) ?? "",
    id: (d.id as string) ?? "",
    author: (d.author as string) ?? null,
    subject: (d.subject as string) ?? "",
    body: (d.body as string) ?? "",
    bodyHtml: (d.body_html as string) ?? null,
    createdUtc: (d.created_utc as number) ?? 0,
    wasComment: Boolean(d.was_comment),
    context: (d.context as string) ?? null,
    linkTitle: (d.link_title as string) ?? null,
    subreddit: (d.subreddit as string) ?? null,
    firstMessageName: (d.first_message_name as string) ?? null,
    parentId: (d.parent_id as string) ?? null,
  }));
}

/** thing_id(t1_/t4_)에 답글/답장 작성. 성공 시 새 댓글 fullname 반환. */
export async function postRedditReply(
  acc: RedditAccount,
  thingId: string,
  text: string,
): Promise<{ name?: string }> {
  const res = await redditFetch(acc, "/api/comment", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ api_type: "json", thing_id: thingId, text }),
  });
  if (!res.ok) {
    throw new Error(`Reddit 답글 전송 실패 (${res.status}): ${await res.text().catch(() => "")}`);
  }
  const j = (await res.json()) as {
    json?: { errors?: unknown[][]; data?: { things?: { data?: { name?: string } }[] } };
  };
  const errors = j?.json?.errors ?? [];
  if (errors.length > 0) throw new Error(`Reddit 오류: ${JSON.stringify(errors)}`);
  return { name: j?.json?.data?.things?.[0]?.data?.name };
}

/** 댓글 permalink(context)에서 글(post) id 추출 → 스레드 그룹핑 키로 사용. */
export function postIdFromContext(context: string | null): string | null {
  if (!context) return null;
  const m = context.match(/\/comments\/([a-z0-9]+)\//i);
  return m ? m[1] : null;
}
