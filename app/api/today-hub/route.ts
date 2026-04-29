/**
 * 오늘의 운영 허브 영속 저장 (Supabase kv_store).
 *
 * GET  /api/today-hub                              → tasks/routines/goal/events 일괄 반환
 * PUT  /api/today-hub  body { type, payload }      → 해당 type 만 업서트
 */
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const KEYS = {
  tasks:    "today_hub:tasks",
  routines: "today_hub:routines",
  goal:     "today_hub:goal",
  events:   "today_hub:events",
} as const;

type Slot = keyof typeof KEYS;

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export async function GET() {
  const db = getDb();
  if (!db) return Response.json({ ok: false, error: "Supabase 미설정" }, { status: 500 });

  const { data, error } = await db
    .from("kv_store")
    .select("key, data")
    .in("key", Object.values(KEYS));

  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  const result: { ok: true } & Partial<Record<Slot, unknown>> = { ok: true };
  for (const row of data ?? []) {
    for (const slot of Object.keys(KEYS) as Slot[]) {
      if (row.key === KEYS[slot]) result[slot] = row.data;
    }
  }
  return Response.json(result);
}

export async function PUT(req: Request) {
  const db = getDb();
  if (!db) return Response.json({ ok: false, error: "Supabase 미설정" }, { status: 500 });

  let body: { type?: string; payload?: unknown };
  try { body = await req.json(); }
  catch { return Response.json({ ok: false, error: "잘못된 본문" }, { status: 400 }); }

  if (!body.type || !(body.type in KEYS)) {
    return Response.json({ ok: false, error: "type 잘못됨" }, { status: 400 });
  }
  if (body.payload === undefined) {
    return Response.json({ ok: false, error: "payload 필수" }, { status: 400 });
  }

  const key = KEYS[body.type as Slot];
  const { error } = await db
    .from("kv_store")
    .upsert(
      { key, data: body.payload, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  return Response.json({ ok: true, type: body.type });
}
