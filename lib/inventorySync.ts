/**
 * 재고 동기화 공통 로직
 * 크론 + 수동 동기화에서 공유
 */
import { cafe24Get, cafe24Put } from "@/lib/cafe24Client";
import { fetchAllOrders } from "@/lib/cafe24Data";
import {
  buildKakaoToCafe24Map,
  buildKakaoOptionToCafe24Map,
  loadKakaoGiftSkuMap,
} from "@/lib/finance/kakaoGiftSkuMap";
import { createClient } from "@supabase/supabase-js";
import type { InventoryEntry } from "@/lib/inventoryStorage";
import type { KakaoGiftPo } from "@/lib/finance/kakaoGiftPo";

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

/** 청크 단위 병렬 처리 + 청크 간 지연으로 Cafe24 40req/sec rate limit 보호 */
async function processInChunks<T, R>(
  items: T[],
  chunkSize: number,
  fn: (item: T) => Promise<R>,
  delayMs = 300,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const part = await Promise.all(chunk.map(fn));
    out.push(...part);
    if (i + chunkSize < items.length) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return out;
}

/** 429 자동 재시도 wrapper — 1s/2s/4s 백오프 */
async function withRateLimitRetry<T>(fn: () => Promise<T>, attempt = 0): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const isRateLimit = /\b429\b|Too much requests/i.test(msg);
    if (isRateLimit && attempt < 3) {
      const delay = 1000 * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, delay));
      return withRateLimitRetry(fn, attempt + 1);
    }
    throw e;
  }
}

async function updateVariantStock(token: string, productNo: number, quantity: number) {
  const variantData = await withRateLimitRetry(() =>
    cafe24Get(`/api/v2/admin/products/${productNo}/variants`, token),
  );
  const variants: Array<{ variant_code: string }> = variantData.variants ?? [];
  // 같은 product 내 variants 도 sequential — rate limit 안전 우선
  for (const v of variants) {
    await withRateLimitRetry(() =>
      cafe24Put(
        `/api/v2/admin/products/${productNo}/variants/${v.variant_code}`,
        token,
        { shop_no: 1, request: { quantity } },
      ),
    );
  }
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

  // 카카오 매핑 사전 로드 (single-SKU + option-aware 둘 다)
  const [kakaoSkuToCafe24, kakaoOptionMap, fullMap] = await Promise.all([
    buildKakaoToCafe24Map(),
    buildKakaoOptionToCafe24Map(),
    loadKakaoGiftSkuMap(),
  ]);

  // 카카오 상품명 → 부모 sku Map (PO product 매칭용)
  const kakaoNameToSku = new Map<string, string>();
  for (const m of fullMap) {
    if (m.kakaoName) kakaoNameToSku.set(m.kakaoName, m.kakaoSku);
  }

  const { data } = await supabase
    .from("kv_store")
    .select("key, data")
    .like("key", "channel_upload:%");

  for (const row of (data ?? []) as Array<{ key: string; data: unknown }>) {
    // 신 포맷: { uploads: [{ data: { topProducts }, ... }] } — 모든 업로드의 topProducts 합산
    // 구 포맷: { data: { topProducts }, meta }              — 그대로
    const r = row.data as Record<string, unknown> | null;
    const tpList: Array<{ sku: string; sold: number }> = [];
    if (r && Array.isArray((r as { uploads?: unknown }).uploads)) {
      const uploads = (r as { uploads: Array<{ data?: { topProducts?: Array<{ sku: string; sold: number }> } }> }).uploads;
      for (const up of uploads) {
        for (const p of up.data?.topProducts ?? []) tpList.push(p);
      }
    } else {
      const tp = (r as { data?: { topProducts?: Array<{ sku: string; sold: number }> } } | null)?.data?.topProducts;
      if (tp) tpList.push(...tp);
    }
    if (tpList.length === 0) continue;
    const isKakao = row.key === "channel_upload:kakao_gift";
    for (const p of tpList) {
      if (!p.sku || !p.sold) continue;
      let targetSku = p.sku;
      if (isKakao) {
        // 카카오 정산서 topProducts: 부모 SKU 만 들어옴 → 1:1 매핑만 적용. 1:N(시계) 은 PO 로 처리.
        const mapped = kakaoSkuToCafe24.get(p.sku);
        if (!mapped) continue;
        targetSku = mapped;
      }
      out[targetSku] = (out[targetSku] ?? 0) + p.sold;
    }
  }

  // 카카오 PO 데이터에서 옵션-aware 차감 — 시계처럼 부모 SKU + 옵션 → 색상별 Cafe24 코드
  const { data: poRows } = await supabase
    .from("kv_store")
    .select("data")
    .like("key", "kakao_gift_po:%");
  const pos: KakaoGiftPo[] = ((poRows ?? []) as Array<{ data: unknown }>)
    .map((r) => r.data)
    .filter((d): d is KakaoGiftPo =>
      !!d && typeof d === "object" && Array.isArray((d as { orders?: unknown }).orders),
    );
  for (const po of pos) {
    for (const o of po.orders) {
      const cleanedOption = (o.option ?? "").replace(/^[^:：]+[:：]\s*/, "").trim();
      const sku = kakaoNameToSku.get(o.product);
      if (!sku || !cleanedOption) continue;
      // 1차: 정확
      let code = kakaoOptionMap.get(`${sku}|${cleanedOption}`);
      // 2차: substring fallback
      if (!code) {
        for (const [key, val] of kakaoOptionMap) {
          const [keySku, keyOption] = key.split("|");
          if (keySku !== sku) continue;
          if (keyOption.includes(cleanedOption) || cleanedOption.includes(keyOption)) { code = val; break; }
        }
      }
      if (!code) continue;
      out[code] = (out[code] ?? 0) + (o.qty ?? 1);
    }
  }

  return out;
}

export interface InventoryLevel {
  sku: string;
  initialStock: number;
  currentStock: number;
  totalSold: number;
}

/**
 * 현재고 계산 (카페24 push 없음) — 저재고 알림 등 읽기 전용 용도.
 * currentStock = initialStock + manualAdjustment − (카페24 판매 + 타채널 판매).
 */
export async function computeInventoryLevels(token: string): Promise<InventoryLevel[]> {
  const entries = await loadInventoryFromStore();
  // 재고 입력된 상품: initialStock>0 또는 실사로 명시 카운트(stockInDate 존재) → 0개 품절도 포함.
  // 단, 단종(discontinued) 상품은 제외 — 저재고/품절이어도 재입고 알림 대상 아님.
  const skus = Object.keys(entries).filter(
    (sku) => (entries[sku].initialStock > 0 || !!entries[sku].stockInDate) && !entries[sku].discontinued,
  );
  if (skus.length === 0) return [];
  const today = new Date().toISOString().slice(0, 10);
  const earliest = skus
    .map((sku) => entries[sku].stockInDate)
    .filter((d): d is string => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= today)
    .sort()[0];
  const startDate = earliest ?? new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  const [cafe24SalesBySku, otherChannelsSales] = await Promise.all([
    fetchSalesBySku(token, startDate),
    fetchOtherChannelsSales(),
  ]);
  return skus.map((sku) => {
    const e = entries[sku];
    const totalSold = (cafe24SalesBySku[sku] ?? 0) + (otherChannelsSales[sku] ?? 0);
    return {
      sku,
      initialStock: e.initialStock,
      totalSold,
      currentStock: Math.max(0, e.initialStock + e.manualAdjustment - totalSold - (e.dutyfreeOut ?? 0)),
    };
  });
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

  // SKU별 처리 — 청크 2개 동시 + 청크 간 300ms 지연 (카페24 40 req/sec 보수적 운영)
  const results = await processInChunks(skus, 2, async (sku): Promise<SyncResult> => {
    const entry = entries[sku];
    const cafe24Sold = cafe24SalesBySku[sku] ?? 0;
    const otherSold = otherChannelsSales[sku] ?? 0;
    const totalSold = cafe24Sold + otherSold;
    const currentStock = Math.max(0, entry.initialStock + entry.manualAdjustment - totalSold - (entry.dutyfreeOut ?? 0));

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
