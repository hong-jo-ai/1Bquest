/**
 * /today 보드의 할일 (조직 축 domain 을 가진다).
 *
 *   GET → { ok, tasks }
 *   PUT { tasks } → 통째 저장
 *
 * 기존 today-hub 의 today_hub:tasks 와는 별도 키다. 저쪽은 기능 축(category)이고
 * 이쪽은 조직 축(domain)이라 스키마가 다르다. 섞으면 둘 다 깨진다.
 */
import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import type { Task } from "@/lib/today/types";
import { kstDateStr } from "@/lib/today/date";

export const dynamic = "force-dynamic";

const KEY = "today:tasks";

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

/** 어제 미완료는 오늘로 이월하고, 어제 완료한 건 화면에서 내린다. */
function normalize(tasks: Task[]): Task[] {
  const today = kstDateStr();
  const out: Task[] = [];
  for (const t of tasks) {
    if (t.date === today) out.push(t);
    else if (t.date < today && !t.done) out.push({ ...t, date: today });
  }
  return out;
}

export async function GET() {
  const db = getDb();
  if (!db) return Response.json({ ok: false, error: "Supabase 미설정" }, { status: 500 });

  const { data, error } = await db.from("kv_store").select("data").eq("key", KEY).maybeSingle();
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  const tasks = Array.isArray(data?.data) ? (data.data as Task[]) : [];
  return Response.json({ ok: true, tasks: normalize(tasks) });
}

export async function PUT(req: NextRequest) {
  const db = getDb();
  if (!db) return Response.json({ ok: false, error: "Supabase 미설정" }, { status: 500 });

  let body: { tasks?: unknown };
  try { body = await req.json(); }
  catch { return Response.json({ ok: false, error: "잘못된 본문" }, { status: 400 }); }

  if (!Array.isArray(body.tasks)) {
    return Response.json({ ok: false, error: "tasks 배열 필수" }, { status: 400 });
  }

  const { error } = await db
    .from("kv_store")
    .upsert({ key: KEY, data: body.tasks, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  return Response.json({ ok: true });
}
