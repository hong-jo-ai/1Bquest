/**
 * /today 보드의 할일 저장소 (kv_store: today:tasks).
 *
 * 라우트와 MCP 툴이 같이 쓴다 — 이월 규칙이 두 군데로 갈라지면
 * 화면과 클로드가 서로 다른 목록을 보게 된다.
 */
import { createClient } from "@supabase/supabase-js";
import { kstDateStr } from "./date";
import type { Task } from "./types";

export const TASKS_KEY = "today:tasks";

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

/** 어제 미완료는 오늘로 이월하고, 어제 완료한 건 목록에서 내린다. */
export function normalizeTasks(tasks: Task[]): Task[] {
  const today = kstDateStr();
  const out: Task[] = [];
  for (const t of tasks) {
    if (t.date === today) out.push(t);
    else if (t.date < today && !t.done) out.push({ ...t, date: today });
  }
  return out;
}

export async function getTasks(): Promise<{ tasks: Task[]; error?: string }> {
  const db = getDb();
  if (!db) return { tasks: [], error: "Supabase 미설정" };

  const { data, error } = await db.from("kv_store").select("data").eq("key", TASKS_KEY).maybeSingle();
  if (error) return { tasks: [], error: error.message };

  const raw = Array.isArray(data?.data) ? (data.data as Task[]) : [];
  return { tasks: normalizeTasks(raw) };
}

export async function putTasks(tasks: Task[]): Promise<{ ok: boolean; error?: string }> {
  const db = getDb();
  if (!db) return { ok: false, error: "Supabase 미설정" };

  const { error } = await db
    .from("kv_store")
    .upsert({ key: TASKS_KEY, data: tasks, updated_at: new Date().toISOString() }, { onConflict: "key" });
  return error ? { ok: false, error: error.message } : { ok: true };
}
