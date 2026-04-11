/**
 * 재고 동기화 공통 로직
 * 크론 + 수동 동기화에서 공유
 */
import { cafe24Get, cafe24Put } from "@/lib/cafe24Client";
import { createClient } from "@supabase/supabase-js";
import type { InventoryEntry } from "@/lib/inventoryStorage";

const INVENTORY_KEY = "paulvice_inventory_v1";
const SYNC_LOG_KEY = "inventory_sync_log";

export interface SyncResult {
  sku: string;
  name?: string;
  quantity: number;
  ok: boolean;
  error?: string;
}

export interface SyncLog {
  timestamp: string;
  trigger: "cron" | "manual";
  synced: number;
  failed: number;
  results: SyncResult[];
}

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export async function loadInventoryFromStore(): Promise<Record<string, InventoryEntry>> {
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
      token,
    );
    return data.products?.[0]?.product_no ?? null;
  } catch {
    return null;
  }
}

async function updateVariantStock(token: string, productNo: number, quantity: number) {
  const variantData = await cafe24Get(
    `/api/v2/admin/products/${productNo}/variants`,
    token,
  );
  const variants: any[] = variantData.variants ?? [];
  let updated = 0;

  for (const v of variants) {
    await cafe24Put(
      `/api/v2/admin/products/${productNo}/variants/${v.variant_code}`,
      token,
      { shop_no: 1, request: { quantity } },
    );
    updated++;
  }
  return updated;
}

async function fetchSalesBySku(token: string): Promise<Record<string, number>> {
  const salesBySku: Record<string, number> = {};
  try {
    const salesRes = await cafe24Get(
      "/api/v2/admin/orders?start_date=" +
        new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10) +
        "&end_date=" +
        new Date().toISOString().slice(0, 10) +
        "&limit=100&fields=items",
      token,
    );
    for (const order of salesRes.orders ?? []) {
      for (const item of order.items ?? []) {
        const sku = item.product_code;
        if (sku) {
          salesBySku[sku] = (salesBySku[sku] ?? 0) + (item.quantity ?? 0);
        }
      }
    }
  } catch (e) {
    console.log("[inventorySync] 판매 데이터 조회 실패:", e);
  }
  return salesBySku;
}

/**
 * 재고 동기화 실행
 * @param token - Cafe24 access token
 * @param trigger - "cron" | "manual"
 * @param targetSkus - 특정 SKU만 동기화 (없으면 전체)
 */
export async function runInventorySync(
  token: string,
  trigger: "cron" | "manual",
  targetSkus?: string[],
): Promise<{ synced: number; failed: number; results: SyncResult[] }> {
  const entries = await loadInventoryFromStore();
  let skus = Object.keys(entries).filter((sku) => entries[sku].initialStock > 0);

  if (targetSkus?.length) {
    skus = skus.filter((sku) => targetSkus.includes(sku));
  }

  if (skus.length === 0) {
    return { synced: 0, failed: 0, results: [] };
  }

  const salesBySku = await fetchSalesBySku(token);
  const results: SyncResult[] = [];

  for (const sku of skus) {
    const entry = entries[sku];
    const sold = salesBySku[sku] ?? 0;
    const currentStock = Math.max(0, entry.initialStock + entry.manualAdjustment - sold);

    try {
      const productNo = await fetchProductNo(token, sku);
      if (!productNo) {
        results.push({ sku, quantity: currentStock, ok: false, error: "상품 없음" });
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

  // 동기화 이력 저장
  await saveSyncLog({ timestamp: new Date().toISOString(), trigger, synced, failed, results });

  return { synced, failed, results };
}

/** 동기화 이력 저장 (최근 20건 유지) */
async function saveSyncLog(log: SyncLog) {
  const supabase = getSupabase();
  if (!supabase) return;

  let logs: SyncLog[] = [];
  try {
    const { data } = await supabase
      .from("kv_store")
      .select("data")
      .eq("key", SYNC_LOG_KEY)
      .maybeSingle();
    logs = (data?.data as SyncLog[]) ?? [];
  } catch {}

  logs.unshift(log);
  logs = logs.slice(0, 20);

  await supabase
    .from("kv_store")
    .upsert(
      { key: SYNC_LOG_KEY, data: logs, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
}

/** 동기화 이력 조회 */
export async function getSyncLogs(): Promise<SyncLog[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  const { data } = await supabase
    .from("kv_store")
    .select("data")
    .eq("key", SYNC_LOG_KEY)
    .maybeSingle();
  return (data?.data as SyncLog[]) ?? [];
}
