import { refreshGoogleToken } from "../ga4Client";
import { getCsSupabase } from "./store";
import type { CsBrandId } from "./types";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

export interface GmailAccount {
  id: string;
  brand: CsBrandId;
  displayName: string;
  refreshToken: string;
  lastHistoryId: string | null;
  lastSyncedAt: string | null;
}

interface GmailMessage {
  id: string;
  threadId: string;
  internalDate: string;
  payload?: {
    headers?: Array<{ name: string; value: string }>;
    mimeType?: string;
    body?: { data?: string };
    parts?: GmailMessage["payload"][];
  };
  snippet?: string;
  labelIds?: string[];
}

export async function listGmailAccounts(): Promise<GmailAccount[]> {
  const db = getCsSupabase();
  // 'paused'만 제외 — 'error' 상태도 자동 재시도 대상에 포함
  const { data, error } = await db
    .from("cs_accounts")
    .select("*")
    .eq("channel", "gmail")
    .in("status", ["active", "error"]);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const creds = (row.credentials ?? {}) as Record<string, unknown>;
    return {
      id: row.id as string,
      brand: row.brand as CsBrandId,
      displayName: (row.display_name as string) ?? "",
      refreshToken: (creds.refresh_token as string) ?? "",
      lastHistoryId: (creds.last_history_id as string) ?? null,
      lastSyncedAt: row.last_synced_at as string | null,
    };
  });
}

export async function updateGmailSyncState(
  accountId: string,
  patch: { lastHistoryId?: string; error?: string | null }
): Promise<void> {
  const db = getCsSupabase();
  const { data: row } = await db
    .from("cs_accounts")
    .select("credentials")
    .eq("id", accountId)
    .single();
  const creds = (row?.credentials ?? {}) as Record<string, unknown>;
  if (patch.lastHistoryId) creds.last_history_id = patch.lastHistoryId;
  await db
    .from("cs_accounts")
    .update({
      credentials: creds,
      last_synced_at: new Date().toISOString(),
      status: patch.error ? "error" : "active",
      error_message: patch.error ?? null,
    })
    .eq("id", accountId);
}

async function gmailFetch<T>(
  accessToken: string,
  path: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(`${GMAIL_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(`Gmail API ${path} 실패: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

export async function getGmailAccessToken(account: GmailAccount): Promise<string> {
  return refreshGoogleToken(account.refreshToken);
}

/**
 * 계정의 INBOX에서 최근 메시지를 가져온다.
 * historyId가 없으면 초기 sync (최근 N건).
 */
export async function fetchRecentInboxMessages(
  accessToken: string,
  opts: { maxResults?: number; query?: string } = {}
): Promise<GmailMessage[]> {
  const q = opts.query ?? "in:inbox -category:promotions -category:social newer_than:7d";
  const listUrl = `/messages?maxResults=${opts.maxResults ?? 30}&q=${encodeURIComponent(q)}`;
  const list = await gmailFetch<{ messages?: Array<{ id: string; threadId: string }> }>(
    accessToken,
    listUrl
  );
  const ids = list.messages ?? [];
  const fetched: GmailMessage[] = [];
  for (const { id } of ids) {
    try {
      const msg = await gmailFetch<GmailMessage>(
        accessToken,
        `/messages/${id}?format=full`
      );
      fetched.push(msg);
    } catch {
      // 개별 실패는 건너뜀
    }
  }
  return fetched;
}

export function extractHeader(
  msg: GmailMessage,
  name: string
): string | undefined {
  return msg.payload?.headers?.find(
    (h) => h.name.toLowerCase() === name.toLowerCase()
  )?.value;
}

export function extractBody(msg: GmailMessage): { text: string; html: string } {
  let text = "";
  let html = "";
  function walk(part: GmailMessage["payload"]): void {
    if (!part) return;
    const mime = part.mimeType ?? "";
    const data = part.body?.data;
    if (data) {
      const decoded = decodeBase64Url(data);
      if (mime === "text/plain") text += decoded;
      else if (mime === "text/html") html += decoded;
    }
    part.parts?.forEach(walk);
  }
  walk(msg.payload);
  if (!text && msg.snippet) text = msg.snippet;
  return { text, html };
}

function decodeBase64Url(data: string): string {
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  if (typeof atob === "function") {
    try {
      return decodeURIComponent(
        Array.from(atob(b64))
          .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
          .join("")
      );
    } catch {
      return atob(b64);
    }
  }
  return Buffer.from(b64, "base64").toString("utf-8");
}

export function parseFrom(header: string | undefined): {
  name: string | null;
  email: string | null;
} {
  if (!header) return { name: null, email: null };
  const m = header.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || null, email: m[2].trim() };
  if (header.includes("@")) return { name: null, email: header.trim() };
  return { name: header.trim(), email: null };
}
