/**
 * 재고 동기화 공통 로직
 * 크론 + 수동 동기화에서 공유
 */
import { cafe24Get, cafe24Put } from "@/lib/cafe24Client";
import { fetchAllOrders } from "@/lib/cafe24Data";
import { buildKakaoToCafe24Map } from "@/lib/finance/kakaoGiftSkuMap";
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

/**
 * 모든 상품의 SKU → product_no 매핑을 한 번에 페이징 조회.
 * 이전에는 SKU 하나당 fetch 1번 (N=100이면 100번) → timeout 빈발.
 * 페이징은 보통 한국 셀러 상품 수 기준 수~십 회로 끝남.
 */
async function buildSkuProductNoMap(token: string): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const limit = 100;
  let offset = 0;
  // 안전 상한: 100 * 30 = 3,000개 상품까지 (그 이상이면 timeout 위험)
  for (let page = 0; page < 30; page++) {
    const data = await cafe24Get(
      `/api/v2/admin/products?fields=product_no,product_code&limit=${limit}&offset=${offset}`,
      token,
    );
    const products: Array<{ product_no: number; product_code: string }> = data.products ?? [];
    for (const p of products) {
      if (p.product_code) map.set(p.product_code, p.product_no);
    }
    if (products.length < limit) break;
    offset += limit;
  }
  return map;
}

/** 청크 단위 병렬 처리 (rate-limit 보호용 concurrency 제한) */
async function processInChunks<T, R>(
  items: T[],
  chunkSize: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const part = await Promise.all(chunk.map(fn));
    out.push(...part);
  }
  return out;
}

async function updateVariantStock(token: string, productNo: number, quantity: number) {
  const variantData = await cafe24Get(
    `/api/v2/admin/products/${productNo}/variants`,
    token,
  );
  const variants: Array<{ variant_code: string }> = variantData.variants ?? [];
  // 같은 product 내 variants는 독립 업데이트 — 병렬 안전
  await Promise.all(
    variants.map((v) =>
      cafe24Put(
        `/api/v2/admin/products/${productNo}/variants/${v.variant_code}`,
        token,
        { shop_no: 1, request: { quantity } },
      ),
    ),
  );
  return variants.length;
}

/**
 * Cafe24 주문에서 SKU별 판매 수량 합산.
 * @param startDate YYYY-MM-DD — 등록된 재고 기준일 중 가장 이른 날짜. 그 이후 주문만 합산.
 *
 * v2: fetchAllOrders 로 페이징 (이전엔 limit=100 한 페이지만 → 누락 발생).
 */
async function fetchSalesBySku(token: string, startDate: string): Promise<Record<string, number>> {
  const salesBySku: Record<string, number> = {};
  try {
    const endDate = new Date().toISOString().slice(0, 10);
    const orders = (await fetchAllOrders(token, startDate, endDate, true)) as Array<{
      items?: Array<{ product_code?: string; quantity?: number }>;
    }>;
    for (const order of orders) {
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
 * 다른 채널(W컨셉/무신사/29CM/공동구매 등)의 업로드 데이터에서 SKU별 판매량 합산.
 * 사용자가 대시보드에서 엑셀 업로드한 결과는 kv_store에 채널별로 저장됨.
 *   - 키: `channel_upload:<channelId>`
 *   - 값: `{ data: { topProducts: [{ sku, sold }, ...], ... }, meta: ... }`
 */
async function fetchOtherChannelsSales(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const supabase = getSupabase();
  if (!supabase) return out;

  // 카카오 SKU 매핑 (kakao 내부 sku → Cafe24 product_code)
  const kakaoToCafe24 = await buildKakaoToCafe24Map();

  const { data } = await supabase
    .from("kv_store")
    .select("key, data")
    .like("key", "channel_upload:%");

  for (const row of (data ?? []) as Array<{
    key: string;
    data: { data?: { topProducts?: Array<{ sku: string; sold: number }> } };
  }>) {
    const tp = row.data?.data?.topProducts;
    if (!tp) continue;
    const isKakao = row.key === "channel_upload:kakao_gift";
    for (const p of tp) {
      if (!p.sku || !p.sold) continue;
      // 카카오 채널은 매핑 적용해서 Cafe24 코드로 변환 — 매핑 없으면 누적 안 함
      let targetSku = p.sku;
      if (isKakao) {
        const mapped = kakaoToCafe24.get(p.sku);
        if (!mapped) continue; // 매핑 없는 카카오 SKU 는 무시 (잘못된 매칭 방지)
        targetSku = mapped;
      }
      out[targetSku] = (out[targetSku] ?? 0) + p.sold;
    }
  }
  return out;
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

  // 가장 이른 stockInDate 부터만 주문 fetch — 그 이전 매출은 initialStock 등록 시점 이전이라 무관.
  // stockInDate 가 비어있거나 미래면 365일 전부터 (안전장치).
  const today = new Date().toISOString().slice(0, 10);
  const earliestStockDate = skus
    .map((sku) => entries[sku].stockInDate)
    .filter((d): d is string => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= today)
    .sort()[0];
  const startDate = earliestStockDate ?? new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);

  // 사전 일괄 조회 (병렬: 카페24 판매 페이징 + 다른 채널 판매 + SKU→productNo 매핑)
  const [cafe24SalesBySku, otherChannelsSales, productNoMap] = await Promise.all([
    fetchSalesBySku(token, startDate),
    fetchOtherChannelsSales(),
    buildSkuProductNoMap(token),
  ]);

  // SKU별 처리 — 청크 5개 동시 (카페24 rate-limit 안전선)
  const results = await processInChunks(skus, 5, async (sku): Promise<SyncResult> => {
    const entry = entries[sku];
    const cafe24Sold = cafe24SalesBySku[sku] ?? 0;
    const otherSold = otherChannelsSales[sku] ?? 0;
    const totalSold = cafe24Sold + otherSold;
    const currentStock = Math.max(0, entry.initialStock + entry.manualAdjustment - totalSold);

    const productNo = productNoMap.get(sku);
    if (!productNo) {
      return { sku, quantity: currentStock, ok: false, error: "상품 없음" };
    }
    try {
      await updateVariantStock(token, productNo, currentStock);
      return { sku, quantity: currentStock, ok: true };
    } catch (e: any) {
      return { sku, quantity: currentStock, ok: false, error: e.message ?? "업데이트 실패" };
    }
  });

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
