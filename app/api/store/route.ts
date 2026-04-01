/**
 * 범용 KV 스토어 API — Supabase REST 기반
 * GET  /api/store?key=xxx        → { data: any }
 * POST /api/store { key, data }  → { ok: true }
 */
import { createClient } from "@supabase/supabase-js";
import { type NextRequest } from "next/server";

function getClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (!key) return Response.json({ error: "key 없음" }, { status: 400 });

  const supabase = getClient();
  if (!supabase) return Response.json({ data: null, reason: "DB_NOT_CONFIGURED" });

  try {
    const { data, error } = await supabase
      .from("kv_store")
      .select("data")
      .eq("key", key)
      .maybeSingle();

    if (error) throw error;
    return Response.json({ data: data?.data ?? null });
  } catch (e: any) {
    return Response.json({ data: null, error: e.message });
  }
}

export async function POST(req: NextRequest) {
  const { key, data } = await req.json();
  if (!key) return Response.json({ error: "key 없음" }, { status: 400 });

  const supabase = getClient();
  if (!supabase) return Response.json({ ok: false, reason: "DB_NOT_CONFIGURED" });

  try {
    const { error } = await supabase
      .from("kv_store")
      .upsert({ key, data, updated_at: new Date().toISOString() }, { onConflict: "key" });

    if (error) throw error;
    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json({ ok: false, error: e.message });
  }
}
