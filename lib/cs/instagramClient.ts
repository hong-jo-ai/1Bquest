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

export interface IgAccount {
  id: string;
  brand: CsBrandId;
  displayName: string; // IG username
  igUserId: string; // instagram business account id
  pageId: string;
  pageAccessToken: string;
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
    };
  });
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

  // `participants` 확장을 붙이면 Meta가 500 "reduce the amount of data" 를 자주 던진다.
  // → 목록에선 id,updated_time 만 가볍게 받고(limit 5), 상대방 식별은 메시지의 from/to 에서 도출한다.
  let nextUrl: string | null =
    `${META_BASE}/${account.pageId}/conversations?platform=instagram&fields=id,updated_time&limit=5&access_token=${encodeURIComponent(account.pageAccessToken)}`;

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
  const url = `${META_BASE}/${conversationId}?fields=messages.limit(25){id,created_time,from,to,message}&access_token=${encodeURIComponent(account.pageAccessToken)}`;
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
  const url = `${META_BASE}/${account.pageId}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: recipientIgsid },
      message: { text },
      messaging_type: "RESPONSE",
      access_token: account.pageAccessToken,
    }),
  });
  if (!res.ok) throw new Error(`IG 메시지 전송 실패: ${await res.text()}`);
  return res.json() as Promise<{ message_id: string }>;
}
