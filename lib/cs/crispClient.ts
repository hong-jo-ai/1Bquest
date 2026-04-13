import { getCsSupabase } from "./store";
import type { CsBrandId } from "./types";

const CRISP_BASE = "https://api.crisp.chat/v1";
const TIER = "plugin";

export interface CrispAccount {
  id: string;
  brand: CsBrandId;
  displayName: string;
  websiteId: string;
  identifier: string;
  key: string;
}

interface CrispConversationMeta {
  session_id: string;
  website_id: string;
  state: string; // unresolved | resolved | pending
  last_message?: string;
  updated_at?: number;
  created_at?: number;
  meta?: {
    nickname?: string;
    email?: string;
    phone?: string;
    avatar?: string;
  };
}

interface CrispMessage {
  session_id: string;
  fingerprint: number;
  type: string; // text | file | picker | ...
  from: "user" | "operator";
  origin?: string;
  content: string | Record<string, unknown>;
  timestamp: number;
}

function authHeader(account: CrispAccount): string {
  const raw = `${account.identifier}:${account.key}`;
  const b64 = Buffer.from(raw, "utf-8").toString("base64");
  return `Basic ${b64}`;
}

async function crispFetch<T>(
  account: CrispAccount,
  path: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(`${CRISP_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: authHeader(account),
      "X-Crisp-Tier": TIER,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Crisp API ${path} 실패: ${res.status} ${text}`);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

export async function listCrispAccounts(): Promise<CrispAccount[]> {
  const db = getCsSupabase();
  const { data, error } = await db
    .from("cs_accounts")
    .select("*")
    .eq("channel", "crisp")
    .in("status", ["active", "error"]);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const creds = (row.credentials ?? {}) as Record<string, unknown>;
    return {
      id: row.id as string,
      brand: row.brand as CsBrandId,
      displayName: (row.display_name as string) ?? "",
      websiteId: (creds.website_id as string) ?? "",
      identifier: (creds.identifier as string) ?? "",
      key: (creds.key as string) ?? "",
    };
  });
}

/**
 * 최근 N일 이내 업데이트된 대화 목록 (resolved 포함 전부 가져와서 상태 동기화).
 */
export async function listCrispConversations(
  account: CrispAccount,
  opts: { perPage?: number; pages?: number } = {}
): Promise<CrispConversationMeta[]> {
  const perPage = opts.perPage ?? 20;
  const pages = opts.pages ?? 1;
  const all: CrispConversationMeta[] = [];
  for (let p = 1; p <= pages; p++) {
    const json = await crispFetch<{ data: CrispConversationMeta[] }>(
      account,
      `/website/${account.websiteId}/conversations/${p}?per_page=${perPage}`
    );
    const batch = json.data ?? [];
    all.push(...batch);
    if (batch.length < perPage) break;
  }
  return all;
}

export async function fetchCrispMessages(
  account: CrispAccount,
  sessionId: string
): Promise<CrispMessage[]> {
  const json = await crispFetch<{ data: CrispMessage[] }>(
    account,
    `/website/${account.websiteId}/conversation/${sessionId}/messages`
  );
  return json.data ?? [];
}

export async function sendCrispMessage(
  account: CrispAccount,
  sessionId: string,
  content: string
): Promise<{ fingerprint: number }> {
  const json = await crispFetch<{ data: { fingerprint: number } }>(
    account,
    `/website/${account.websiteId}/conversation/${sessionId}/message`,
    {
      method: "POST",
      body: JSON.stringify({
        type: "text",
        from: "operator",
        origin: "chat",
        content,
      }),
    }
  );
  return json.data;
}

export function extractTextContent(msg: CrispMessage): string {
  if (typeof msg.content === "string") return msg.content;
  if (msg.content && typeof msg.content === "object") {
    const c = msg.content as Record<string, unknown>;
    if (typeof c.text === "string") return c.text;
    return JSON.stringify(c);
  }
  return "";
}
