import { getCsSupabase } from "./store";
import type { CsBrandId } from "./types";

const META_BASE = "https://graph.facebook.com/v22.0";

/**
 * Meta Graph fetch — 타임아웃 + "reduce the amount of data"(code 1) / 5xx 재시도.
 *
 * IG DM 대화 목록(`/{page}/conversations?platform=instagram`)은 Meta 쪽에서
 * 간헐적으로 500 "Please reduce the amount of data you're asking for" 를 던지거나
 * 응답이 지연(행)된다. 크론이 한 번에 죽지 않도록 타임아웃·백오프 재시도로 감싼다.
 */
async function metaFetch(
  url: string,
  opts: { tries?: number; timeoutMs?: number } = {}
): Promise<Response> {
  const tries = opts.tries ?? 4;
  const timeoutMs = opts.timeoutMs ?? 15000;
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { cache: "no-store", signal: controller.signal });
      clearTimeout(timer);
      // 5xx(대개 code 1 "reduce data") 는 재시도 대상
      if (res.status >= 500 && i < tries - 1) {
        await new Promise((r) => setTimeout(r, 800 * (i + 1)));
        continue;
      }
      return res;
    } catch (e) {
      clearTimeout(timer);
      lastErr = e; // AbortError(타임아웃) 등 → 재시도
      if (i < tries - 1) {
        await new Promise((r) => setTimeout(r, 800 * (i + 1)));
        continue;
      }
    }
  }
  throw new Error(
    `Meta 요청 실패(재시도 ${tries}회): ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`
  );
}

// 각 브랜드의 예상 IG 유저네임 (잘못된 계정 연결 방지)
// 공식 계정만 허용한다. 구 계정은 잘못 연결되면 콘텐츠/DM 데이터가 섞일 수 있어 제외.
export const EXPECTED_IG_USERNAMES: Record<CsBrandId, string[]> = {
  paulvice: ["paulvice.kr"],
  harriot: ["harriotwatches"],
};

// 호환용 단일 값 (에러 메시지 표기) — 현재 공식 계정
export const EXPECTED_IG_USERNAME: Record<CsBrandId, string> = {
  paulvice: "paulvice.kr",
  harriot: "harriotwatches",
};

/**
 * 브랜드별 Meta 앱 자격증명.
 * - paulvice: META_APP_ID / META_APP_SECRET (기존 env)
 * - harriot:  META_APP_ID_HARRIOT / META_APP_SECRET_HARRIOT (신규 env)
 */
export function getMetaAppCredentials(brand: CsBrandId): {
  appId: string;
  appSecret: string;
} {
  if (brand === "harriot") {
    return {
      appId: (process.env.META_APP_ID_HARRIOT ?? "").trim(),
      appSecret: (process.env.META_APP_SECRET_HARRIOT ?? "").trim(),
    };
  }
  return {
    appId: (process.env.META_APP_ID ?? "").trim(),
    appSecret: (process.env.META_APP_SECRET ?? "").trim(),
  };
}

// Instagram API with Instagram Login (graph.instagram.com). DM 읽기/답장의 실제 동작 경로.
// Facebook 로그인(페이지) 경로는 code3/flaky 라 IG 로그인 토큰이 있으면 이 경로를 우선한다.
const IG_LOGIN_BASE = "https://graph.instagram.com/v22.0";
const IG_LOGIN_ROOT = "https://graph.instagram.com"; // refresh_access_token 는 버전 프리픽스 없음

export interface IgAccount {
  id: string;
  brand: CsBrandId;
  displayName: string; // IG username
  igUserId: string; // instagram business account id
  pageId: string;
  pageAccessToken: string;
  /** Instagram 로그인 토큰(IGAA…). 있으면 graph.instagram.com 경로 사용. */
  igLoginToken?: string;
  /** IG 로그인 토큰 만료(epoch ms). 만료 임박 시 자동 갱신. */
  igLoginExpiresAt?: number;
}

interface MetaPageData {
  id: string;
  name: string;
  access_token: string;
  instagram_business_account?: { id: string };
}

interface IgBusinessAccount {
  id: string;
  username: string;
  name?: string;
}

export async function exchangeCodeForToken(
  brand: CsBrandId,
  code: string,
  redirectUri: string
): Promise<string> {
  const { appId, appSecret } = getMetaAppCredentials(brand);
  if (!appId || !appSecret) {
    throw new Error(
      `${brand} Meta 앱 자격증명 누락 (${brand === "harriot" ? "META_APP_ID_HARRIOT / META_APP_SECRET_HARRIOT" : "META_APP_ID / META_APP_SECRET"})`
    );
  }
  const params = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    redirect_uri: redirectUri,
    code,
  });
  const res = await fetch(`${META_BASE}/oauth/access_token?${params}`);
  if (!res.ok) throw new Error(`Meta 코드 교환 실패: ${await res.text()}`);
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

export async function getLongLivedUserToken(
  brand: CsBrandId,
  shortToken: string
): Promise<string> {
  const { appId, appSecret } = getMetaAppCredentials(brand);
  const params = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: shortToken,
  });
  const res = await fetch(`${META_BASE}/oauth/access_token?${params}`);
  if (!res.ok) throw new Error(`Meta 장기 토큰 교환 실패: ${await res.text()}`);
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

/**
 * 사용자가 관리하는 모든 Facebook 페이지 조회.
 * Page access_token은 이미 long-lived 상태로 반환됨 (user token이 long-lived일 때).
 */
export async function listManagedPages(
  userToken: string
): Promise<MetaPageData[]> {
  const url = `${META_BASE}/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=${encodeURIComponent(userToken)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`페이지 목록 조회 실패: ${await res.text()}`);
  const json = (await res.json()) as { data?: MetaPageData[] };
  return json.data ?? [];
}

export async function getIgBusinessAccount(
  igUserId: string,
  pageAccessToken: string
): Promise<IgBusinessAccount> {
  const url = `${META_BASE}/${igUserId}?fields=id,username,name&access_token=${encodeURIComponent(pageAccessToken)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`IG 비즈니스 계정 조회 실패: ${await res.text()}`);
  return res.json() as Promise<IgBusinessAccount>;
}

export async function listIgAccounts(): Promise<IgAccount[]> {
  const db = getCsSupabase();
  const { data, error } = await db
    .from("cs_accounts")
    .select("*")
    .eq("channel", "ig_dm")
    .in("status", ["active", "error"]);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const creds = (row.credentials ?? {}) as Record<string, unknown>;
    return {
      id: row.id as string,
      brand: row.brand as CsBrandId,
      displayName: (row.display_name as string) ?? "",
      igUserId: (creds.ig_user_id as string) ?? "",
      pageId: (creds.page_id as string) ?? "",
      pageAccessToken: (creds.page_access_token as string) ?? "",
      igLoginToken: (creds.ig_login_token as string) || undefined,
      igLoginExpiresAt: (creds.ig_login_expires_at as number) || undefined,
    };
  });
}

/**
 * IG 로그인 토큰(60일)이 만료 임박(10일 이내)이면 자동 갱신 후 저장.
 * ig_refresh_token 은 앱 시크릿 불필요 — 토큰만으로 갱신되며 매번 60일 연장된다.
 * 시간 크론(매시)에서 호출되므로 사실상 무기한 유지(수동 갱신 불필요).
 */
export async function refreshIgLoginTokenIfNeeded(account: IgAccount): Promise<IgAccount> {
  if (!account.igLoginToken) return account;
  const daysLeft = account.igLoginExpiresAt
    ? (account.igLoginExpiresAt - Date.now()) / 86_400_000
    : 0;
  if (daysLeft > 10) return account; // 아직 여유
  try {
    const res = await fetch(
      `${IG_LOGIN_ROOT}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(account.igLoginToken)}`,
      { cache: "no-store" },
    );
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) return account;
    const newExp = Date.now() + (json.expires_in ?? 60 * 86400) * 1000;
    const db = getCsSupabase();
    const { data } = await db.from("cs_accounts").select("credentials").eq("id", account.id).single();
    const creds = {
      ...((data?.credentials as Record<string, unknown>) ?? {}),
      ig_login_token: json.access_token,
      ig_login_expires_at: newExp,
      ig_login_refreshed_at: new Date().toISOString(),
    };
    await db.from("cs_accounts").update({ credentials: creds }).eq("id", account.id);
    return { ...account, igLoginToken: json.access_token, igLoginExpiresAt: newExp };
  } catch {
    return account; // 갱신 실패해도 기존 토큰으로 계속 시도
  }
}

interface IgConversation {
  id: string;
  updated_time: string;
  participants?: { data: Array<{ id: string; username?: string; name?: string }> };
}

interface IgMessage {
  id: string;
  created_time: string;
  from: { id: string; username?: string; name?: string };
  to?: { data: Array<{ id: string; username?: string }> };
  message?: string;
}

/**
 * IG DM 대화 목록. 페이지네이션으로 since 날짜까지 거슬러 올라간다.
 * Meta 문서: GET /{PAGE-ID}/conversations?platform=instagram
 */
export async function listIgConversations(
  account: IgAccount,
  opts: { since?: Date; maxPages?: number } = {}
): Promise<IgConversation[]> {
  const sinceMs = opts.since ? opts.since.getTime() : 0;
  const maxPages = opts.maxPages ?? 1;
  const all: IgConversation[] = [];

  // IG 로그인 토큰이 있으면 graph.instagram.com/me/conversations (실제 동작 경로).
  // 없으면 레거시 Facebook 페이지 경로(참고: participants 확장은 500 유발 → 경량 필드).
  let nextUrl: string | null = account.igLoginToken
    ? `${IG_LOGIN_BASE}/me/conversations?fields=id,updated_time&limit=20&access_token=${encodeURIComponent(account.igLoginToken)}`
    : `${META_BASE}/${account.pageId}/conversations?platform=instagram&fields=id,updated_time&limit=5&access_token=${encodeURIComponent(account.pageAccessToken)}`;

  for (let page = 0; page < maxPages && nextUrl; page++) {
    // 대화 목록은 Meta가 특히 잘 죽는다(500/행) → 재시도 예산을 넉넉히.
    const res = await metaFetch(nextUrl, { tries: 8, timeoutMs: 22000 });
    if (!res.ok) throw new Error(`IG 대화 조회 실패: ${await res.text()}`);
    const json = (await res.json()) as {
      data?: IgConversation[];
      paging?: { next?: string };
    };
    const batch = json.data ?? [];
    all.push(...batch);

    // since보다 이전 대화만 있으면 중단
    if (
      sinceMs &&
      batch.length > 0 &&
      batch.every((c) => new Date(c.updated_time).getTime() < sinceMs)
    ) {
      break;
    }

    nextUrl = json.paging?.next ?? null;
  }

  // since 필터 적용
  if (sinceMs) {
    return all.filter((c) => new Date(c.updated_time).getTime() >= sinceMs);
  }
  return all;
}

export async function fetchIgMessages(
  account: IgAccount,
  conversationId: string
): Promise<IgMessage[]> {
  const base = account.igLoginToken ? IG_LOGIN_BASE : META_BASE;
  const token = account.igLoginToken ?? account.pageAccessToken;
  const url = `${base}/${conversationId}?fields=messages.limit(25){id,created_time,from,to,message}&access_token=${encodeURIComponent(token)}`;
  const res = await metaFetch(url);
  if (!res.ok) throw new Error(`IG 메시지 조회 실패: ${await res.text()}`);
  const json = (await res.json()) as {
    messages?: { data?: IgMessage[] };
  };
  return json.messages?.data ?? [];
}

/**
 * IG DM 전송: Messenger Platform의 /me/messages 엔드포인트 사용.
 * 페이지 액세스 토큰 + recipient.id (IGSID).
 */
export async function sendIgMessage(
  account: IgAccount,
  recipientIgsid: string,
  text: string
): Promise<{ message_id: string }> {
  // IG 로그인: POST graph.instagram.com/me/messages (Instagram Login send).
  // 레거시: Messenger Platform /{page}/messages.
  const url = account.igLoginToken
    ? `${IG_LOGIN_BASE}/me/messages`
    : `${META_BASE}/${account.pageId}/messages`;
  const body: Record<string, unknown> = account.igLoginToken
    ? {
        recipient: { id: recipientIgsid },
        message: { text },
        access_token: account.igLoginToken,
      }
    : {
        recipient: { id: recipientIgsid },
        message: { text },
        messaging_type: "RESPONSE",
        access_token: account.pageAccessToken,
      };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`IG 메시지 전송 실패: ${await res.text()}`);
  return res.json() as Promise<{ message_id: string }>;
}

// ── 댓글 (ig_comment) ──────────────────────────────────────────
// IG 로그인 토큰(IGAA) + graph.instagram.com 경로만 쓴다.
// 페이지 토큰 경로(/{ig_user}/media)는 2026-07 진단에서 code 3 로 죽었다.

export interface IgMedia {
  id: string;
  caption?: string;
  permalink?: string;
  timestamp: string;
}

export interface IgComment {
  id: string;
  text?: string;
  timestamp: string;
  username?: string;
  from?: { id: string; username?: string };
  replies?: { data: IgComment[] };
}

/** 최근 게시물. 댓글은 게시물 단위로만 조회할 수 있어 먼저 목록이 필요하다. */
export async function listIgMedia(
  account: IgAccount,
  opts: { limit?: number } = {},
): Promise<IgMedia[]> {
  if (!account.igLoginToken) return [];
  const limit = Math.min(50, Math.max(1, opts.limit ?? 10));
  const url =
    `${IG_LOGIN_BASE}/me/media?fields=id,caption,permalink,timestamp&limit=${limit}` +
    `&access_token=${encodeURIComponent(account.igLoginToken)}`;
  const res = await metaFetch(url, { tries: 4, timeoutMs: 15000 });
  if (!res.ok) throw new Error(`IG 게시물 조회 실패: ${await res.text()}`);
  const json = (await res.json()) as { data?: IgMedia[] };
  return json.data ?? [];
}

/** 답글 1건의 작성자를 채운다. 중첩 확장에선 안 오고 개별 조회로만 온다. */
async function hydrateAuthor(account: IgAccount, c: IgComment): Promise<void> {
  const url =
    `${IG_LOGIN_BASE}/${c.id}?fields=from{id,username}` +
    `&access_token=${encodeURIComponent(account.igLoginToken!)}`;
  const res = await metaFetch(url, { tries: 2, timeoutMs: 10000 });
  if (!res.ok) return; // 못 채우면 작성자 미상 — 방향 판정은 호출측이 보수적으로 처리
  const json = (await res.json()) as { from?: { id: string; username?: string } };
  if (json.from) c.from = json.from;
}

/**
 * 게시물의 최상위 댓글 + 대댓글.
 *
 * ⚠️ 작성자 정보가 두 단계로 갈린다(2026-09-01 실측).
 *  - 최상위 댓글: `from{id,username}` 을 **명시해야** 남이 쓴 댓글의 작성자가 온다.
 *    `username` 만 요청하면 우리가 쓴 것만 채워지고 고객 댓글은 빈 값이다.
 *  - 대댓글: 중첩 확장(`replies{...from}`)에도, 전용 `/replies` 엔드포인트에도 **작성자가 안 온다.**
 *    답글 id 로 **개별 조회**해야만 나온다. 그래서 답글만 따로 채운다.
 *
 * 이걸 안 하면 우리가 단 답글이 전부 "고객 문의"로 들어와 인박스가 미답변으로 가득 찬다.
 */
export async function igCommentsForMedia(
  account: IgAccount,
  mediaId: string,
  opts: { hydrateRepliesSince?: Date; maxHydrate?: number } = {},
): Promise<IgComment[]> {
  if (!account.igLoginToken) return [];
  const fields =
    "id,text,timestamp,username,from{id,username}," +
    "replies{id,text,timestamp,username}";
  const url =
    `${IG_LOGIN_BASE}/${mediaId}/comments?fields=${encodeURIComponent(fields)}&limit=50` +
    `&access_token=${encodeURIComponent(account.igLoginToken)}`;
  const res = await metaFetch(url, { tries: 4, timeoutMs: 15000 });
  if (!res.ok) throw new Error(`IG 댓글 조회 실패: ${await res.text()}`);
  const json = (await res.json()) as { data?: IgComment[] };
  const comments = json.data ?? [];

  // 답글 작성자 채우기 — 개별 호출이라 창(기본: 최근 것만)과 상한으로 묶는다.
  const sinceMs = opts.hydrateRepliesSince?.getTime() ?? 0;
  let budget = opts.maxHydrate ?? 60;
  for (const root of comments) {
    for (const r of root.replies?.data ?? []) {
      if (budget <= 0) break;
      if (r.from?.username || r.username) continue;
      if (sinceMs && new Date(r.timestamp).getTime() < sinceMs) continue;
      budget--;
      await hydrateAuthor(account, r);
    }
  }
  return comments;
}
