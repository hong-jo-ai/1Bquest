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
  // 재고 대장 통째 덮어쓰기 차단 — 새로고침 안 한 옛 탭·기기가 낡은 대장을 올려 반품 +1·메모를 지웠다(2026-09-30).
  // 대장은 /api/inventory/entry(SKU 단위 병합)로만 쓴다.
  if (/_inventory_v1$/.test(String(key))) {
    return Response.json({ ok: false, error: "재고 대장은 /api/inventory/entry 로 저장 — 새로고침 필요" }, { status: 409 });
  }

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
