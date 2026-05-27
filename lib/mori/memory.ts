/**
 * 모리 대화 메모리 — Supabase kv_store 백엔드.
 *
 * 1인 비서이므로 단일 롤링 대화(key=mori:conversation)로 둔다. 멀티 스레드는 후에.
 * 매 턴마다 user/assistant 텍스트를 누적하고, 최근 MAX_TURNS개만 유지.
 * Supabase 미설정/실패 시 빈 배열로 우아하게 degrade(메모리 없이도 채팅은 동작).
 */

import { createClient } from "@supabase/supabase-js";

const KEY = "mori:conversation";
const MAX_TURNS = 80;

export interface StoredMessage {
  role: "user" | "assistant";
  content: string;
  ts: string; // ISO
}

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

/** 저장된 대화 로드(오래된 → 최신 순). 실패 시 []. */
export async function loadConversation(): Promise<StoredMessage[]> {
  const db = getDb();
  if (!db) return [];
  try {
    const { data } = await db.from("kv_store").select("data").eq("key", KEY).maybeSingle();
    const arr = data?.data;
    return Array.isArray(arr) ? (arr as StoredMessage[]) : [];
  } catch {
    return [];
  }
}

async function save(list: StoredMessage[]): Promise<void> {
  const db = getDb();
  if (!db) return;
  const trimmed = list.slice(-MAX_TURNS);
  try {
    await db
      .from("kv_store")
      .upsert({ key: KEY, data: trimmed, updated_at: new Date().toISOString() }, { onConflict: "key" });
  } catch {
    // 영속 실패해도 현재 응답엔 영향 없음
  }
}

/** user 메시지 + assistant 응답을 한 턴으로 append. */
export async function appendTurn(userText: string, assistantText: string): Promise<void> {
  const now = new Date().toISOString();
  const list = await loadConversation();
  list.push({ role: "user", content: userText, ts: now });
  list.push({ role: "assistant", content: assistantText, ts: now });
  await save(list);
}

/** 대화 전체 삭제. */
export async function clearConversation(): Promise<void> {
  await save([]);
}
