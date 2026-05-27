/**
 * 모리가 "오늘 할일"을 읽는 얇은 헬퍼.
 *
 * Today Hub 위젯이 kv_store(`today_hub:tasks`)에 StoredTask[]로 저장한다(lib/todayHub/addTask.ts).
 * 그 저장소를 모리가 읽기 전용으로 들여다본다 — 채팅 컨텍스트 주입 + 능동 코칭 발화에 함께 쓴다.
 * (addTask.ts의 loadTasks는 export 안 돼 있어 kv를 직접 조회한다. 키만 재사용.)
 */

import { createClient } from "@supabase/supabase-js";
import { TASKS_KEY, type StoredTask } from "@/lib/todayHub/addTask";

/** KST 기준 오늘 날짜 YYYY-MM-DD. */
export function kstDateStr(d: Date = new Date()): string {
  return new Date(d.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function db() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export interface TodayTasks {
  all: StoredTask[];
  pending: StoredTask[];
  doneCount: number;
  total: number;
}

/** 오늘 날짜(KST)의 할일만 추려서 미완료/완료를 분리해 돌려준다. */
export async function loadTodayTasks(): Promise<TodayTasks> {
  const empty: TodayTasks = { all: [], pending: [], doneCount: 0, total: 0 };
  const d = db();
  if (!d) return empty;
  let rows: StoredTask[] = [];
  try {
    const { data } = await d.from("kv_store").select("data").eq("key", TASKS_KEY).maybeSingle();
    rows = (data?.data as StoredTask[]) ?? [];
  } catch {
    return empty;
  }
  const today = kstDateStr();
  const all = rows.filter((t) => t.date === today);
  const pending = all.filter((t) => !t.done);
  return { all, pending, doneCount: all.length - pending.length, total: all.length };
}
