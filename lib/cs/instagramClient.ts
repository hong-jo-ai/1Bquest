import { getCsSupabase } from "./store";
import type { CsBrandId } from "./types";

const META_BASE = "https://graph.facebook.com/v22.0";

// 각 브랜드의 예상 IG 유저네임 (잘못된 계정 연결 방지)
// 여러 대체 유저네임 허용 (브랜드 리네임·다계정 운영 대비)
export const EXPECTED_IG_USERNAMES: Record<CsBrandId, string[]> = {
  paulvice: ["plve_seoul", "paulvicedesign", "paulvice"],
  harriot: ["harriotwatches"],
};

// 호환용 단일 값 (에러 메시지 표기)
export const EXPECTED_IG_USERNAME: Record<CsBrandId, string> = {
  paulvice: "plve_seoul",
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
 * 최근 업데이트된 IG DM 대화 목록.
 * Meta 문서: GET /{PAGE-ID}/conversations?platform=instagram
 * PAGE access token 사용.
 */
export async function listIgConversations(
  account: IgAccount
): Promise<IgConversation[]> {
  const url = `${META_BASE}/${account.pageId}/conversations?platform=instagram&fields=id,updated_time,participants&access_token=${encodeURIComponent(account.pageAccessToken)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`IG 대화 조회 실패: ${await res.text()}`);
  const json = (await res.json()) as { data?: IgConversation[] };
  return json.data ?? [];
}

export async function fetchIgMessages(
  account: IgAccount,
  conversationId: string
): Promise<IgMessage[]> {
  const url = `${META_BASE}/${conversationId}?fields=messages.limit(25){id,created_time,from,to,message}&access_token=${encodeURIComponent(account.pageAccessToken)}`;
  const res = await fetch(url, { cache: "no-store" });
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
