export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { cafe24Get, cafe24Put } from "@/lib/cafe24Client";
import { getAccessTokenFromStore } from "@/lib/cafe24TokenStore";
import { createClient } from "@supabase/supabase-js";
import type { InventoryEntry } from "@/lib/inventoryStorage";

const INVENTORY_KEY = "paulvice_inventory_v1";

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

async function loadInventoryFromStore(): Promise<Record<string, InventoryEntry>> {
  const supabase = getSupabase();
  if (!supabase) return {};
  const { data } = await supabase
    .from("kv_store")
    .select("data")
    .eq("key", INVENTORY_KEY)
    .maybeSingle();
  return (data?.data as Record<string, InventoryEntry>) ?? {};
}

async function fetchProductNo(token: string, sku: string): Promise<number | null> {
  try {
    const data = await cafe24Get(
      `/api/v2/admin/products?product_code=${encodeURIComponent(sku)}&fields=product_no`,
      token
    );
    return data.products?.[0]?.product_no ?? null;
  } catch {
    return null;
  }
}

async function updateVariantStock(token: string, productNo: number, quantity: number) {
  const variantData = await cafe24Get(
    `/api/v2/admin/products/${productNo}/variants`,
    token
  );
  const variants: any[] = variantData.variants ?? [];
  let updated = 0;

  for (const v of variants) {
    await cafe24Put(
      `/api/v2/admin/products/${productNo}/variants/${v.variant_code}`,
      token,
      { shop_no: 1, request: { quantity } }
    );
    updated++;
  }
  return updated;
}

/**
 * 매일 오전 7시(KST) 실행
 * 대시보드 재고 데이터를 Cafe24에 동기화
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const token = await getAccessTokenFromStore();
    if (!token) {
      return NextResponse.json(
        { error: "카페24 토큰 없음 — 대시보드에서 카페24 로그인 필요" },
        { status: 401 }
      );
    }

    const entries = await loadInventoryFromStore();
    const skus = Object.keys(entries).filter(
      (sku) => entries[sku].initialStock > 0
    );

    if (skus.length === 0) {
      return NextResponse.json({ success: true, message: "동기화할 재고 없음", synced: 0 });
    }

    // Cafe24 판매 데이터 가져오기 (currentStock 계산용)
    let salesBySku: Record<string, number> = {};
    try {
      const salesRes = await cafe24Get(
        "/api/v2/admin/orders?start_date=" +
          new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10) +
          "&end_date=" +
          new Date().toISOString().slice(0, 10) +
          "&limit=100&fields=items",
        token
      );
      // 주문 데이터에서 SKU별 판매량 집계
      for (const order of salesRes.orders ?? []) {
        for (const item of order.items ?? []) {
          const sku = item.product_code;
          if (sku) {
            salesBySku[sku] = (salesBySku[sku] ?? 0) + (item.quantity ?? 0);
          }
        }
      }
    } catch (e) {
      console.log("[Cron:inventory-sync] 판매 데이터 조회 실패, 조정값만으로 계산:", e);
    }

    const results: { sku: string; quantity: number; ok: boolean; error?: string }[] = [];

    for (const sku of skus) {
      const entry = entries[sku];
      const sold = salesBySku[sku] ?? 0;
      const currentStock = Math.max(0, entry.initialStock + entry.manualAdjustment - sold);

      try {
        const productNo = await fetchProductNo(token, sku);
        if (!productNo) {
          results.push({ sku, quantity: currentStock, ok: false, error: "product_not_found" });
          continue;
        }
        await updateVariantStock(token, productNo, currentStock);
        results.push({ sku, quantity: currentStock, ok: true });
      } catch (e: any) {
        results.push({ sku, quantity: currentStock, ok: false, error: e.message });
      }
    }

    const synced = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok).length;
    console.log(`[Cron:inventory-sync] 완료 — 성공 ${synced}건, 실패 ${failed}건`);

    return NextResponse.json({ success: true, synced, failed, results });
  } catch (e: any) {
    console.error("[Cron:inventory-sync] 실패:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
