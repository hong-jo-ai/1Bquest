/**
 * 모리 메모 큐 — 받아쓰기("메모") 모드 적재함.
 *
 * "메모"로 시작하는 받아쓰기는 모리 응답 없이 여기에 쌓인다(스펙 §5).
 * Supabase kv_store(key=mori:memos). 미설정 시 빈 배열로 degrade.
 */

import { createClient } from "@supabase/supabase-js";

const KEY = "mori:memos";
const MAX = 200;

export interface Memo {
  id: string;
  text: string;
  ts: string; // ISO
}

function db() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export async function listMemos(): Promise<Memo[]> {
  const d = db();
  if (!d) return [];
  try {
    const { data } = await d.from("kv_store").select("data").eq("key", KEY).maybeSingle();
    const arr = data?.data;
    return Array.isArray(arr) ? (arr as Memo[]) : [];
  } catch {
    return [];
  }
}

async function save(list: Memo[]): Promise<void> {
  const d = db();
  if (!d) return;
  try {
    await d
      .from("kv_store")
      .upsert({ key: KEY, data: list.slice(-MAX), updated_at: new Date().toISOString() }, { onConflict: "key" });
  } catch {
    /* noop */
  }
}

export async function addMemo(text: string): Promise<Memo> {
  const memo: Memo = {
    id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    text: text.trim(),
    ts: new Date().toISOString(),
  };
  const list = await listMemos();
  list.push(memo);
  await save(list);
  return memo;
}

export async function deleteMemo(id: string): Promise<void> {
  const list = await listMemos();
  await save(list.filter((m) => m.id !== id));
}
