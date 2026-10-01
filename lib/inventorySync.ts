/**
 * 재고 동기화 공통 로직
 * 크론 + 수동 동기화에서 공유
 */
import { cafe24Get, cafe24Put, type MallId } from "@/lib/cafe24Client";
import { fetchAllOrders } from "@/lib/cafe24Data";
import {
  buildKakaoToCafe24Map,
  buildKakaoOptionToCafe24Map,
  loadKakaoGiftSkuMap,
} from "@/lib/finance/kakaoGiftSkuMap";
import { createClient } from "@supabase/supabase-js";
import type { InventoryEntry } from "@/lib/inventoryStorage";
import type { KakaoGiftPo } from "@/lib/finance/kakaoGiftPo";

// 멀티몰: 폴바이스는 기존 키 유지, 해리엇은 브랜드 접미. (mall === brand: "paulvice"|"harriot")
const invKey = (mall: MallId) => (mall === "paulvice" ? "paulvice_inventory_v1" : `${mall}_inventory_v1`);
const syncLogKey = (mall: MallId) => (mall === "paulvice" ? "inventory_sync_log" : `inventory_sync_log:${mall}`);
const aliasKey = (mall: MallId) => (mall === "paulvice" ? "inventory_sku_alias" : `inventory_sku_alias:${mall}`);
const sharedKey = (mall: MallId) => (mall === "paulvice" ? "inventory_shared_stock" : `inventory_shared_stock:${mall}`);

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

export async function loadInventoryFromStore(mall: MallId = "paulvice"): Promise<Record<string, InventoryEntry>> {
  const supabase = getSupabase();
  if (!supabase) return {};
  const { data } = await supabase
    .from("kv_store")
    .select("data")
    .eq("key", invKey(mall))
    .maybeSingle();
  return (data?.data as Record<string, InventoryEntry>) ?? {};
}

/**
 * 카페24 상품코드 별칭맵 { 별칭코드: 정식코드 } — 같은 물건의 중복/임시 listing 을 정식 재고 SKU로 합침.
 * 예) 인플루언서 협업용 임시상품 P00000IZ(에끌라 실버) → 정식 P00000HO. kv `inventory_sku_alias`.
 */
export async function loadSkuAlias(mall: MallId = "paulvice"): Promise<Record<string, string>> {
  const supabase = getSupabase();
  if (!supabase) return {};
  const { data } = await supabase.from("kv_store").select("data").eq("key", aliasKey(mall)).maybeSingle();
  return (data?.data as Record<string, string>) ?? {};
}

/** 판매 합계 레코드의 키(product_code)를 별칭맵으로 합산 치환. 별칭 대상 코드는 정식 코드로 합쳐짐. */
export function applySkuAlias(rec: Record<string, number>, alias: Record<string, string>): Record<string, number> {
  if (!alias || Object.keys(alias).length === 0) return rec;
  const out: Record<string, number> = {};
  for (const [sku, qty] of Object.entries(rec)) {
    const target = alias[sku] ?? sku;
    out[target] = (out[target] ?? 0) + qty;
  }
  return out;
}

/**
 * 모든 상품의 SKU → product_no 매핑을 한 번에 페이징 조회.
 * 이전에는 SKU 하나당 fetch 1번 (N=100이면 100번) → timeout 빈발.
 * 페이징은 보통 한국 셀러 상품 수 기준 수~십 회로 끝남.
 */
async function buildSkuProductNoMap(token: string, mall: MallId = "paulvice"): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const limit = 100;
  let offset = 0;
  // 안전 상한: 100 * 30 = 3,000개 상품까지 (그 이상이면 timeout 위험)
  for (let page = 0; page < 30; page++) {
    const data = await cafe24Get(
      `/api/v2/admin/products?fields=product_no,product_code&limit=${limit}&offset=${offset}`,
      token,
      mall,
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

async function updateVariantStock(token: string, productNo: number, quantity: number, mall: MallId = "paulvice") {
  const variantData = await withRateLimitRetry(() =>
    cafe24Get(`/api/v2/admin/products/${productNo}/variants`, token, mall),
  );
  const variants: Array<{ variant_code: string }> = variantData.variants ?? [];
  // 같은 product 내 variants 도 sequential — rate limit 안전 우선
  for (const v of variants) {
    await withRateLimitRetry(() =>
      cafe24Put(
        `/api/v2/admin/products/${productNo}/variants/${v.variant_code}`,
        token,
        { shop_no: 1, request: { quantity } },
        mall,
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
export async function fetchSalesBySku(
  token: string,
  startDate: string,
  mall: MallId = "paulvice",
  /** SKU별 실사일. 주문일이 그 이전이면 실사 수량에 이미 반영돼 있으므로 차감하지 않는다. */
  sinceBySku?: Record<string, string>,
): Promise<Record<string, number>> {
  const salesBySku: Record<string, number> = {};
  const endDate = new Date().toISOString().slice(0, 10);
  // 🔴 카페24 주문 API 는 embed=items 일 때 조회 범위가 3개월을 넘으면 422 를 낸다.
  // 예전엔 전 구간을 한 번에 불러 422 → catch 에서 삼켜 "판매 0" 이 됐고, 재고추적 OFF 상품은
  // 자사몰 판매가 한 개도 안 빠졌다(2026-10-01 느와르 실사 65 vs 카페24 91). 85일씩 쪼개 부른다.
  // 실패는 삼키지 않는다 — 판매를 0 으로 치고 재고를 밀어 넣는 것보다 동기화가 멈추는 편이 안전하다.
  const dayMs = 86400000;
  for (let from = new Date(`${startDate}T00:00:00Z`).getTime(); ; ) {
    const to = Math.min(from + 85 * dayMs, new Date(`${endDate}T00:00:00Z`).getTime());
    const fromDay = new Date(from).toISOString().slice(0, 10);
    const toDay = new Date(to).toISOString().slice(0, 10);
    // startDate 는 조회 범위일 뿐이다. SKU별 차감 여부는 sinceBySku 로 주문일을 다시 걸러야 한다 —
    // 안 그러면 늦게 실사한 SKU가 실사 이전 판매까지 다시 빼먹는다.
    const orders = (await fetchAllOrders(token, fromDay, toDay, true, mall)) as Array<{
      order_date?: string;
      items?: Array<{ product_code?: string; quantity?: number; order_status?: string }>;
    }>;
    for (const order of orders) {
      const orderDay = String(order.order_date ?? "").slice(0, 10);
      for (const item of order.items ?? []) {
        const sku = item.product_code;
        if (!sku) continue;
        // 취소(C*)는 물건이 안 나간 주문이다. 반품(R*)·교환(E*)은 나갔다 돌아오는 것이라
        // 판매로 세고, 회수·검수 후 manualAdjustment +1 로 되돌린다(기존 운영 방식).
        if (/^C/.test(item.order_status ?? "")) continue;
        const since = sinceBySku?.[sku];
        if (since && orderDay && orderDay < since) continue;
        salesBySku[sku] = (salesBySku[sku] ?? 0) + (item.quantity ?? 0);
      }
    }
    if (toDay >= endDate) break;
    from = to + dayMs;
  }
  return salesBySku;
}

/**
 * 재고 공유맵 { 공유코드: 원재고코드 } — 실물 재고가 따로 없고 다른 상품의 재고에서 꺼내 파는 상품.
 * 예) 에끌라 골드 브라운(P00000KE)은 골드(P00000HN) 본품에 밴드만 바꿔 내보낸다.
 * 판매는 원재고에서 빠지고(별칭과 같은 효과), 동기화 때 원재고 수량이 공유 상품에도 그대로 들어간다.
 * kv `inventory_shared_stock`.
 */
export async function loadSharedStock(mall: MallId = "paulvice"): Promise<Record<string, string>> {
  const supabase = getSupabase();
  if (!supabase) return {};
  const { data } = await supabase.from("kv_store").select("data").eq("key", sharedKey(mall)).maybeSingle();
  return (data?.data as Record<string, string>) ?? {};
}

/** 자사몰 판매를 역산해야 하는(=재고추적 OFF) SKU 중 가장 이른 실사일. 추적 ON 은 카페24 실재고를 쓰므로 주문을 볼 필요가 없다. */
function earliestUntrackedDate(
  entries: Record<string, InventoryEntry>,
  skus: string[],
  liveStock: Record<string, { quantity: number; tracked: boolean }>,
): string | null {
  const today = new Date().toISOString().slice(0, 10);
  return (
    skus
      .filter((sku) => !liveStock[sku]?.tracked)
      .map((sku) => entries[sku].stockInDate)
      .filter((d): d is string => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= today)
      .sort()[0] ?? null
  );
}

// 상품명 정규화 — 브랜드 접두어·공백·특수문자 제거(색상/옵션 단어는 유지: 색상별 SKU 구분).
export function normProductName(s: string): string {
  return String(s || "").normalize("NFC").toLowerCase()
    .replace(/^\s*(폴바이스|paulvice|벨피|바이린\s*x\s*폴바이스)\s*/i, "")
    .replace(/[\s\-_()[\]/.,·]+/g, "");
}

// 카페24 상품명(정규화) → product_code 사전. 채널 판매상품명을 재고 SKU로 이름매칭하는 폴백용.
// 한글명 + 영문명(eng_product_name) 둘 다 색인 → W컨셉 계정2 등 영문 상품명도 매칭.
export async function buildCafe24NameMap(token: string, mall: MallId = "paulvice"): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const limit = 100;
  for (let offset = 0, page = 0; page < 40; page++, offset += limit) {
    const data = await cafe24Get(
      `/api/v2/admin/products?fields=product_code,product_name,eng_product_name&limit=${limit}&offset=${offset}`,
      token,
      mall,
    ) as { products?: Array<{ product_code: string; product_name: string; eng_product_name?: string }> };
    const products = data.products ?? [];
    for (const p of products) {
      if (!p.product_code) continue;
      for (const nm of [p.product_name, p.eng_product_name]) {
        const n = normProductName(nm || "");
        if (n && !map.has(n)) map.set(n, p.product_code);
      }
    }
    if (products.length < limit) break;
  }
  return map;
}

/** channel_upload 채널ID → pp_shipments.channel 라벨 (출고 기록에서 색상 분포를 찾을 때 사용) */
const CHANNEL_SHIPMENT_LABEL: Record<string, string> = {
  musinsa: "무신사",
  wconcept: "W컨셉",
  "29cm": "29CM",
  naver_smartstore: "스마트스토어",
  sixshop: "식스샵",
  kakao_gift: "카카오선물하기",
};

/**
 * 출고 기록(pp_shipments)에서 채널·상품별 **색상 분포**를 만든다.
 *
 * 왜 필요한가: 무신사처럼 한 리스팅에서 여러 색을 파는 채널은 판매 리포트에 **옵션이 안 담긴다**
 * (`{sku:"5846276", name:"에끌라 오벌 워치 - 골드&실버", sold:14}`). 그대로 두면 채널코드 폴백이
 * 걸려 **실버 판매까지 골드 재고에서 차감**된다(2026-08-28 확인).
 * 출고 엑셀에는 옵션이 있으므로, 출고 기록의 색상 비율로 판매수량을 색상별로 쪼갠다.
 * 총량은 채널 리포트(정본)를 그대로 쓰고 **분배만** 출고 기록을 따른다.
 */
async function fetchShipmentColorRatios(): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  const supabase = getSupabase();
  if (!supabase) return out;
  const { data } = await supabase
    .from("pp_shipments")
    .select("channel, product_name, color, qty")
    .eq("req_type", "1")
    .eq("is_test", false)
    .not("color", "is", null)
    .neq("color", "");
  for (const r of (data ?? []) as Array<{ channel: string; product_name: string; color: string; qty: number | null }>) {
    if (!r.product_name || !r.color) continue;
    const key = `${r.channel}|${normProductName(r.product_name)}`;
    const m = out.get(key) ?? new Map<string, number>();
    m.set(r.color, (m.get(r.color) ?? 0) + (r.qty || 1));
    out.set(key, m);
  }
  return out;
}

/**
 * 옵션맵에서 색상값에 해당하는 SKU — 정확일치 → 정규화 일치 → **접두 일치**.
 * ⚠️ 단순 부분포함(includes)을 쓰면 "로즈골드"가 "골드"에 걸린다(로즈골드는 실제 취급 색상이다).
 *    "골드 FREE" 처럼 뒤에 수식어가 붙는 경우만 허용하려고 startsWith 로 제한한다.
 */
function skuForColor(om: Record<string, string>, color: string): string | null {
  if (om[color]) return om[color];
  const n = normProductName(color);
  if (!n) return null;
  for (const [k, v] of Object.entries(om)) {
    if (normProductName(k) === n) return v;
  }
  for (const [k, v] of Object.entries(om)) {
    const nk = normProductName(k);
    if (nk && n.startsWith(nk)) return v;
  }
  return null;
}

/**
 * 총 판매수량을 색상 분포에 따라 정수로 배분(최대잔여법 — 합계는 항상 sold 와 같다).
 * 반환: [{ sku, qty }]. 매핑 안 되는 색이 하나라도 있으면 null(오차감 방지 — 호출측이 폴백).
 */
export function splitSoldByColor(
  sold: number,
  colors: Map<string, number>,
  om: Record<string, string>,
): Array<{ sku: string; qty: number }> | null {
  const total = [...colors.values()].reduce((a, b) => a + b, 0);
  if (!total) return null;
  const parts: Array<{ sku: string; exact: number; floor: number }> = [];
  for (const [color, cnt] of colors) {
    const sku = skuForColor(om, color);
    if (!sku) return null; // 모르는 색이 섞여 있으면 통째로 폴백
    const exact = (sold * cnt) / total;
    parts.push({ sku, exact, floor: Math.floor(exact) });
  }
  let rest = sold - parts.reduce((a, p) => a + p.floor, 0);
  parts.sort((a, b) => (b.exact - b.floor) - (a.exact - a.floor));
  const merged = new Map<string, number>();
  for (const p of parts) {
    const add = rest > 0 ? 1 : 0;
    if (rest > 0) rest--;
    merged.set(p.sku, (merged.get(p.sku) ?? 0) + p.floor + add);
  }
  return [...merged].map(([sku, qty]) => ({ sku, qty })).filter((x) => x.qty > 0);
}

/**
 * 채널 판매항목(상품명/옵션/채널코드)을 재고 SKU(카페24 product_code)로 매칭.
 *   ① 옵션(색상) 기반 이름매칭 — "골드&실버" 합본을 옵션 색상으로 치환해 색상별 SKU 분리
 *   ② 상품명 그대로 매칭  ③ 채널 매핑사전(product-level) 폴백
 * nameMap: 정규화상품명→카페24코드(한글+영문). channelSkuMap: 채널코드→카페24코드.
 */
export function matchChannelItemToSku(
  item: { sku?: string; name?: string; option?: string },
  nameMap: Map<string, string>,
  channelSkuMap: Record<string, string>,
  optMap?: Record<string, Record<string, string>>,
): string | null {
  const name = item.name || "";
  const opt = (item.option || "").trim();
  // ⓪ 엄브렐러 옵션맵 — 한 listing이 여러 색/종류를 옵션으로 파는 상품(오드리·미니엘스퀘어 등).
  //    채널코드가 옵션맵 대상이면 옵션값으로 색상별 SKU 분리. 옵션 매칭 실패 시 폴백 금지(오차감 방지).
  if (item.sku && optMap && optMap[item.sku]) {
    const om = optMap[item.sku];
    return om[opt] ?? om[normProductName(opt)] ?? null;
  }
  if (opt) {
    // "골드&실버"·"골드/실버" 등 색상조합을 옵션 색상으로 치환 → "에끌라 오벌 워치 - 골드"
    const swapped = name.replace(/[^\s,]+(?:&|＆|\/|,)[^\s,]+/g, opt);
    for (const c of [swapped, `${name} ${opt}`]) {
      const t = nameMap.get(normProductName(c));
      if (t) return t;
    }
  }
  if (name) {
    const t = nameMap.get(normProductName(name));
    if (t) return t;
  }
  if (item.sku && item.sku !== "-" && channelSkuMap[item.sku]) return channelSkuMap[item.sku];
  return null;
}

/**
 * 다른 채널(W컨셉/무신사/29CM/공동구매 등)의 업로드 데이터에서 SKU별 판매량 합산.
 * 사용자가 대시보드에서 엑셀 업로드한 결과는 kv_store에 채널별로 저장됨.
 *   - 키: `channel_upload:<channelId>`
 *   - 값: `{ data: { topProducts: [{ sku, name, sold }, ...], ... }, meta: ... }`
 * 채널코드는 재고 SKU와 다르므로: ① channel_pricing:skumap:<채널>(채널코드→SKU) ② 상품명 매칭 으로 변환.
 */
async function fetchOtherChannelsSales(
  token: string,
  mall: MallId = "paulvice",
  /** SKU별 실사일(stockInDate). 그 이전에 끝난 업로드는 실사 수량에 이미 반영돼 있으므로 차감하지 않는다. */
  sinceBySku?: Record<string, string>,
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  // 실사일 이전에 종료된 업로드분은 스킵 — 안 그러면 실사로 센 물건을 판매로 또 뺀다.
  const add = (sku: string, qty: number, periodEnd?: string) => {
    const since = sinceBySku?.[sku];
    if (since && periodEnd && periodEnd <= since) return;
    out[sku] = (out[sku] ?? 0) + qty;
  };
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

  // 채널별 매핑사전(channel_pricing:skumap:<채널>: 채널코드→카페24 product_code) + 카페24 상품명 사전
  const channelSkuMaps = new Map<string, Record<string, string>>();
  const { data: smapRows } = await supabase
    .from("kv_store")
    .select("key, data")
    .like("key", "channel_pricing:skumap:%");
  for (const r of (smapRows ?? []) as Array<{ key: string; data: unknown }>) {
    const ch = r.key.replace("channel_pricing:skumap:", "");
    if (r.data && typeof r.data === "object") channelSkuMaps.set(ch, r.data as Record<string, string>);
  }
  // 엄브렐러 옵션맵(channel_pricing:optmap:<채널>: 채널코드 → { 옵션값: 카페24코드 })
  const channelOptMaps = new Map<string, Record<string, Record<string, string>>>();
  const { data: omapRows } = await supabase
    .from("kv_store")
    .select("key, data")
    .like("key", "channel_pricing:optmap:%");
  for (const r of (omapRows ?? []) as Array<{ key: string; data: unknown }>) {
    const ch = r.key.replace("channel_pricing:optmap:", "");
    if (r.data && typeof r.data === "object") channelOptMaps.set(ch, r.data as Record<string, Record<string, string>>);
  }
  const cafe24NameToCode = await buildCafe24NameMap(token, mall).catch(() => new Map<string, string>());
  // 출고 기록 기반 색상 분포 — 옵션이 없는 채널 리포트를 색상별로 쪼갤 때만 쓴다.
  const colorRatios = await fetchShipmentColorRatios().catch(() => new Map<string, Map<string, number>>());

  const { data } = await supabase
    .from("kv_store")
    .select("key, data")
    .like("key", "channel_upload:%");

  for (const row of (data ?? []) as Array<{ key: string; data: unknown }>) {
    const r = row.data as Record<string, unknown> | null;
    type Item = { sku?: string; name?: string; option?: string; sold: number };
    // 업로드별로 salesByOption(옵션·전체) 우선, 없으면 topProducts(상위10) — 채널 내 모든 업로드 합산.
    const uploads: Array<{ data?: { topProducts?: Item[]; salesByOption?: Item[] } }> =
      r && Array.isArray((r as { uploads?: unknown }).uploads)
        ? (r as { uploads: Array<{ data?: { topProducts?: Item[]; salesByOption?: Item[] } }> }).uploads
        : (r as { data?: { topProducts?: Item[]; salesByOption?: Item[] } } | null)?.data
          ? [{ data: (r as { data: { topProducts?: Item[]; salesByOption?: Item[] } }).data }]
          : [];
    const items: Array<Item & { periodEnd?: string }> = [];
    for (const up of uploads) {
      const periodEnd = (up as { period?: { end?: string } }).period?.end;
      const src = up.data?.salesByOption?.length ? up.data.salesByOption : (up.data?.topProducts ?? []);
      for (const p of src) items.push({ ...p, periodEnd });
    }
    if (items.length === 0) continue;
    const isKakao = row.key === "channel_upload:kakao_gift";
    // 카카오선물은 폴바이스 전용 채널 — 해리엇 몰 동기화 때는 건너뜀(코드 충돌 방지).
    if (isKakao && mall !== "paulvice") continue;
    // 단체·법인(b2b_harriot)은 해리엇 전용. ⚠️두 몰이 카페24 SKU 코드를 공유하지 않는데
    // 값은 겹친다(해리엇 P00000DW=서해 선레이 / 폴바이스 P00000DW=[증정] 가죽 스트랩 블랙).
    // 가드 없이 두면 폴바이스 동기화에서 엉뚱한 상품이 차감된다.
    if (row.key === "channel_upload:b2b_harriot" && mall !== "harriot") continue;
    // 같은 이유로 브랜드 전용 채널을 몰별로 가둔다. 조선몰=해리엇 상품만 판다.
    if (row.key === "channel_upload:chosunmall" && mall !== "harriot") continue;
    if (row.key === "channel_upload:direct_harriot" && mall !== "harriot") continue;
    if (row.key === "channel_upload:direct_paulvice" && mall !== "paulvice") continue;
    // 🔴 면세점 정산(lotte_dutyfree·shinsegae_dutyfree)은 재고 차감 대상이 아니다.
    // 면세점 매대에서 팔린 물건은 우리 창고에서 이미 나간 것 — 출고 시점에 dutyfreeOut 으로 뺐다.
    // 여기서 또 빼면 이중차감(2026-09-08 실사 12종 중 10종이 시스템<실물로 어긋난 주원인).
    if (/_dutyfree$/.test(row.key)) continue;
    const channelId = row.key.replace("channel_upload:", "");
    const smap = channelSkuMaps.get(channelId) ?? {};
    const omap = channelOptMaps.get(channelId);
    const shipLabel = CHANNEL_SHIPMENT_LABEL[channelId];
    for (const it of items) {
      if (!it.sold) continue;
      let targetSku: string | null = null;
      if (isKakao) {
        // 카카오는 부모 SKU 1:1 + 아래 PO 옵션매칭으로 별도 처리.
        if (it.sku) targetSku = kakaoSkuToCafe24.get(it.sku) ?? null;
      } else {
        // 옵션이 안 담기는 채널(무신사 등)의 엄브렐러 리스팅 — 출고 기록의 색상 분포로 쪼갠다.
        const om = it.sku ? omap?.[it.sku] : undefined;
        if (om && !(it.option || "").trim() && shipLabel && it.name) {
          const colors = colorRatios.get(`${shipLabel}|${normProductName(it.name)}`);
          const split = colors ? splitSoldByColor(it.sold, colors, om) : null;
          if (split) {
            for (const s of split) add(s.sku, s.qty, it.periodEnd);
            continue;
          }
        }
        targetSku = matchChannelItemToSku(it, cafe24NameToCode, smap, omap);
      }
      if (!targetSku) continue; // 매칭 실패 시 차감 안 함(오차감 방지)
      add(targetSku, it.sold, it.periodEnd);
    }
  }

  // 카카오 PO 데이터에서 옵션-aware 차감 — 시계처럼 부모 SKU + 옵션 → 색상별 Cafe24 코드.
  // 카카오선물은 폴바이스 전용이므로 해리엇 몰에서는 PO 차감도 건너뜀.
  if (mall !== "paulvice") return out;
  // 카카오 차감 컷오프: kv `kakao_gift_dedux_since`({since:"YYYY-MM-DD"}) 이후(포함) PO만 차감.
  // 카카오 PO가 4월부터 누적돼 전부 합산하면 실사(초기재고) 기준과 이중차감 → 컷오프로 방지.
  const { data: sinceRow } = await supabase
    .from("kv_store").select("data").eq("key", "kakao_gift_dedux_since").maybeSingle();
  const kakaoSince: string | null =
    sinceRow?.data && typeof sinceRow.data === "object"
      ? ((sinceRow.data as { since?: string }).since ?? null)
      : typeof sinceRow?.data === "string" ? (sinceRow.data as string) : null;
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
    if (kakaoSince && po.date && po.date < kakaoSince) continue; // 컷오프 이전 스킵(이중차감 방지)
    for (const o of po.orders) {
      // 옵션에서 색상/변형만 추출: "선택:" prefix 제거 + 각인문구/메세지카드 뒷부분 잘라냄.
      // 예) "선택: 큐빅…팔찌-실버, 메세지 카드: X" → "큐빅…팔찌-실버"
      //     "골드 / 각인문구: X" → "골드"  (시계류)
      const cleanedOption = (o.option ?? "")
        .replace(/^\s*선택\s*[:：]\s*/, "")
        .split(/\s*[/,]\s*(?:각인문구|메세지\s*?카드)\s*[:：]?/)[0]
        .trim();
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

/** SKU → 실사일(stockInDate). 유효한 과거 날짜만. 판매 차감을 실사 이후분으로 제한하는 데 쓴다. */
function buildSinceBySku(entries: Record<string, InventoryEntry>, skus: string[]): Record<string, string> {
  const today = new Date().toISOString().slice(0, 10);
  const out: Record<string, string> = {};
  for (const sku of skus) {
    const d = entries[sku]?.stockInDate;
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= today) out[sku] = d;
  }
  return out;
}

export interface InventoryLevel {
  sku: string;
  initialStock: number;
  currentStock: number;
  totalSold: number;
  liveTracked?: boolean; // 카페24 재고추적 ON → currentStock=카페24 실재고(역산 아님)
}

/**
 * 카페24 재고추적(use_inventory=T) 상품의 실재고를 대량 조회.
 * 추적 켠 상품은 카페24가 판매마다 정확히 차감하므로, 역산("실사−판매") 대신 이 값이 진실.
 * 반환: product_code → { quantity(변형 합), tracked }.
 */
async function fetchLiveCafe24Stock(token: string, mall: MallId): Promise<Record<string, { quantity: number; tracked: boolean }>> {
  const out: Record<string, { quantity: number; tracked: boolean }> = {};
  let offset = 0;
  for (let page = 0; page < 30; page++) {
    const d = (await cafe24Get(
      `/api/v2/admin/products?limit=100&offset=${offset}&embed=variants`,
      token, mall,
    )) as { products?: Array<{ product_code?: string; variants?: Array<{ quantity?: number; use_inventory?: string }> }> };
    const ps = d.products ?? [];
    for (const p of ps) {
      if (!p.product_code) continue;
      const vs = p.variants ?? [];
      if (vs.length === 0) continue;
      const qty = vs.reduce((s, v) => s + (Number(v.quantity) || 0), 0);
      const tracked = vs.every((v) => v.use_inventory === "T");
      out[p.product_code] = { quantity: qty, tracked };
    }
    if (ps.length < 100) break;
    offset += 100;
  }
  return out;
}

/**
 * 현재고 계산 (카페24 push 없음) — 저재고 알림 등 읽기 전용 용도.
 * currentStock = initialStock + manualAdjustment − (카페24 판매 + 타채널 판매).
 */
export async function computeInventoryLevels(token: string, mall: MallId = "paulvice"): Promise<InventoryLevel[]> {
  const entries = await loadInventoryFromStore(mall);
  // 재고 입력된 상품: initialStock>0 또는 실사로 명시 카운트(stockInDate 존재) → 0개 품절도 포함.
  // 단, 단종(discontinued) 상품은 제외 — 저재고/품절이어도 재입고 알림 대상 아님.
  const skus = Object.keys(entries).filter(
    (sku) => (entries[sku].initialStock > 0 || !!entries[sku].stockInDate) && !entries[sku].discontinued,
  );
  if (skus.length === 0) return [];
  const liveStock = await fetchLiveCafe24Stock(token, mall).catch(() => ({} as Record<string, { quantity: number; tracked: boolean }>));
  const startDate = earliestUntrackedDate(entries, skus, liveStock);
  const sinceBySku = buildSinceBySku(entries, skus);
  const [cafe24SalesRaw, otherChannelsRaw, aliasRaw, shared] = await Promise.all([
    // 읽기 전용 경로라 조회 실패는 화면을 깨지 않게 삼키되, 로그는 남긴다.
    startDate
      ? fetchSalesBySku(token, startDate, mall, sinceBySku).catch((e) => {
          console.error("[inventorySync] 카페24 판매 조회 실패(표시용):", e);
          return {} as Record<string, number>;
        })
      : Promise.resolve({} as Record<string, number>),
    fetchOtherChannelsSales(token, mall, sinceBySku),
    loadSkuAlias(mall),
    loadSharedStock(mall),
  ]);
  const alias = { ...aliasRaw, ...shared };
  const cafe24SalesBySku = applySkuAlias(cafe24SalesRaw, alias);
  const otherChannelsSales = applySkuAlias(otherChannelsRaw, alias);
  return skus.map((sku) => {
    const e = entries[sku];
    const totalSold = (cafe24SalesBySku[sku] ?? 0) + (otherChannelsSales[sku] ?? 0);
    const computed = Math.max(0, e.initialStock + e.manualAdjustment - totalSold - (e.dutyfreeOut ?? 0));
    // 카페24 재고추적 ON 상품은 역산 대신 카페24 실재고를 진실로 사용(드리프트 제거).
    const live = liveStock[sku];
    const useLive = !!live?.tracked;
    return {
      sku,
      initialStock: e.initialStock,
      totalSold,
      currentStock: useLive ? live.quantity : computed,
      liveTracked: useLive,
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
  mall: MallId = "paulvice",
): Promise<{ synced: number; failed: number; results: SyncResult[] }> {
  const entries = await loadInventoryFromStore(mall);
  let skus = Object.keys(entries).filter((sku) => entries[sku].initialStock > 0);

  if (targetSkus?.length) {
    skus = skus.filter((sku) => targetSkus.includes(sku));
  }

  if (skus.length === 0) {
    return { synced: 0, failed: 0, results: [] };
  }

  // 자사몰 주문은 재고추적 OFF 상품의 가장 이른 실사일부터만 본다 — 추적 ON 은 카페24 실재고를 쓴다.
  const liveStock = await fetchLiveCafe24Stock(token, mall).catch(() => ({} as Record<string, { quantity: number; tracked: boolean }>));
  const startDate = earliestUntrackedDate(entries, skus, liveStock);

  // 사전 일괄 조회 (병렬: 카페24 판매 페이징 + 다른 채널 판매 + SKU→productNo 매핑)
  const sinceBySku = buildSinceBySku(entries, skus);
  let cafe24SalesError: string | null = null;
  const [cafe24SalesRaw, otherChannelsRaw, productNoMap, aliasRaw, shared] = await Promise.all([
    startDate
      ? fetchSalesBySku(token, startDate, mall, sinceBySku).catch((e) => {
          cafe24SalesError = e instanceof Error ? e.message : String(e);
          console.error("[inventorySync] 카페24 판매 조회 실패:", e);
          return {} as Record<string, number>;
        })
      : Promise.resolve({} as Record<string, number>),
    fetchOtherChannelsSales(token, mall, sinceBySku),
    buildSkuProductNoMap(token, mall),
    loadSkuAlias(mall),
    loadSharedStock(mall),
  ]);
  const alias = { ...aliasRaw, ...shared };
  const cafe24SalesBySku = applySkuAlias(cafe24SalesRaw, alias);
  const otherChannelsSales = applySkuAlias(otherChannelsRaw, alias);

  // SKU별 처리 — 청크 2개 동시 + 청크 간 300ms 지연 (카페24 40 req/sec 보수적 운영)
  const results = await processInChunks(skus, 2, async (sku): Promise<SyncResult> => {
    const entry = entries[sku];
    const cafe24Sold = cafe24SalesBySku[sku] ?? 0;
    const otherSold = otherChannelsSales[sku] ?? 0;
    const totalSold = cafe24Sold + otherSold;
    const computed = Math.max(0, entry.initialStock + entry.manualAdjustment - totalSold - (entry.dutyfreeOut ?? 0));
    // 재고추적 ON 상품은 카페24가 판매마다 정확히 차감하므로 그 값이 진실 — 역산으로 덮어쓰지 않는다.
    // (computeInventoryLevels 와 동일 규칙. 이 가드가 없어 표시값과 실제 push 값이 갈렸다.)
    const live = liveStock[sku];
    const currentStock = live?.tracked ? live.quantity : computed;

    const productNo = productNoMap.get(sku);
    if (!productNo) {
      return { sku, quantity: currentStock, ok: false, error: "상품 없음" };
    }
    // 자사몰 판매를 못 읽었으면 추적 OFF 상품은 건드리지 않는다 — 판매 0 으로 친 값을 밀어 넣으면 재고가 부푼다.
    if (cafe24SalesError && !live?.tracked) {
      return { sku, quantity: currentStock, ok: false, error: `카페24 판매 조회 실패로 건너뜀: ${cafe24SalesError}` };
    }
    try {
      await updateVariantStock(token, productNo, currentStock, mall);
      return { sku, quantity: currentStock, ok: true };
    } catch (e: any) {
      return { sku, quantity: currentStock, ok: false, error: e.message ?? "업데이트 실패" };
    }
  });

  // 재고 공유 상품 — 원재고 수량을 그대로 넣는다(실물이 하나라 숫자도 하나여야 한다).
  for (const [sharedSku, sourceSku] of Object.entries(shared)) {
    const src = results.find((r) => r.sku === sourceSku);
    if (!src?.ok) continue;
    const productNo = productNoMap.get(sharedSku);
    if (!productNo) {
      results.push({ sku: sharedSku, quantity: src.quantity, ok: false, error: "상품 없음" });
      continue;
    }
    try {
      await updateVariantStock(token, productNo, src.quantity, mall);
      results.push({ sku: sharedSku, quantity: src.quantity, ok: true });
    } catch (e: any) {
      results.push({ sku: sharedSku, quantity: src.quantity, ok: false, error: e.message ?? "업데이트 실패" });
    }
  }

  const synced = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;

  // 동기화 이력 저장
  await saveSyncLog({ timestamp: new Date().toISOString(), trigger, synced, failed, results }, mall);

  return { synced, failed, results };
}

/** 동기화 이력 저장 (최근 20건 유지) */
async function saveSyncLog(log: SyncLog, mall: MallId = "paulvice") {
  const supabase = getSupabase();
  if (!supabase) return;

  let logs: SyncLog[] = [];
  try {
    const { data } = await supabase
      .from("kv_store")
      .select("data")
      .eq("key", syncLogKey(mall))
      .maybeSingle();
    logs = (data?.data as SyncLog[]) ?? [];
  } catch {}

  logs.unshift(log);
  logs = logs.slice(0, 20);

  await supabase
    .from("kv_store")
    .upsert(
      { key: syncLogKey(mall), data: logs, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
}

/** 동기화 이력 조회 */
export async function getSyncLogs(mall: MallId = "paulvice"): Promise<SyncLog[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  const { data } = await supabase
    .from("kv_store")
    .select("data")
    .eq("key", syncLogKey(mall))
    .maybeSingle();
  return (data?.data as SyncLog[]) ?? [];
}
