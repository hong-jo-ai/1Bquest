/**
 * POST /api/inventory/entry  { brand, sku, patch }
 * 재고 대장에서 **한 SKU 만** 서버 최신값 위에 덮어쓴다.
 *
 * 🔴 왜 필요한가(2026-09-30): 재고 화면은 수정할 때마다 브라우저에 있던 대장 **전체**를 /api/store 로 올렸다.
 * 브라우저 사본이 낡았으면(다른 기기·스크립트가 그 사이 반품 +1·메모를 적었으면) 그게 통째로 지워졌다
 * — 9/22 에끌라 골드 반품 메모가 이렇게 사라졌다. 이제 화면은 고친 SKU 의 고친 칸만 보낸다.
 */
import { type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const FIELDS = ["initialStock", "stockInDate", "manualAdjustment", "notes", "categoryOverride", "discontinued"] as const;

export async function POST(req: NextRequest) {
  const { brand, sku, patch } = (await req.json().catch(() => ({}))) as {
    brand?: string; sku?: string; patch?: Record<string, unknown>;
  };
  if (!sku || !patch || typeof patch !== "object") return Response.json({ ok: false, error: "sku/patch 없음" }, { status: 400 });
  const key = brand === "harriot" ? "harriot_inventory_v1" : "paulvice_inventory_v1";
  const url = process.env.SUPABASE_URL, sk = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !sk) return Response.json({ ok: false, error: "Supabase 미설정" }, { status: 500 });
  const db = createClient(url, sk);

  const { data, error } = await db.from("kv_store").select("data").eq("key", key).maybeSingle();
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  const ledger = (data?.data ?? {}) as Record<string, Record<string, unknown>>;
  const clean: Record<string, unknown> = {};
  for (const f of FIELDS) if (f in patch) clean[f] = patch[f];
  const prev = ledger[sku] ?? { sku, initialStock: 0, manualAdjustment: 0, stockInDate: "", notes: "" };
  ledger[sku] = { ...prev, ...clean, sku };

  const { error: wErr } = await db.from("kv_store")
    .upsert({ key, data: ledger, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (wErr) return Response.json({ ok: false, error: wErr.message }, { status: 500 });
  return Response.json({ ok: true, entry: ledger[sku] });
}
