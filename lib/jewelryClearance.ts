import { cafe24Get, cafe24Put } from "./cafe24Client";
import { fetchAllOrders, buildRanking } from "./cafe24Data";
import { createClient } from "@supabase/supabase-js";

// ── 타입 ──────────────────────────────────────────────────────────────────

export interface ClearanceProduct {
  productNo: number;
  sku: string;
  name: string;
  image: string;
  currentPrice: number;        // 현재 판매가
  originalPrice: number;       // 최초 판매가 (첫 실행 시 기록)
  floorPrice: number;          // 하한가 (판매가의 30%)
  hits: number;                // 조회수
  sales: number;               // 판매수 (최근 7일)
  conversionRate: number;      // 전환율 = sales / hits
  velocity: number;            // 판매속도 = 7일 판매수 / 7
  prevVelocity: number;        // 전일 판매속도 (이력에서 가져옴)
  elasticity: ElasticityGrade; // 탄력성 등급
  adjustmentPct: number;       // 이번에 적용할 할인율 (%)
  newPrice: number;            // 조정 후 가격
  displayOrder: number;        // 진열 순서
}

export type ElasticityGrade =
  | "responsive"    // 가격 내리니 잘 팔림 → 유지/소폭 추가
  | "neutral"       // 변화 없음 → 공격적 할인
  | "unresponsive"  // 내려도 안 팔림 → 진열 변경에 집중
  | "no_data";      // 첫 실행 or 데이터 부족

export interface ClearanceHistoryEntry {
  date: string;               // YYYY-MM-DD
  sku: string;
  name: string;
  prevPrice: number;
  newPrice: number;
  adjustmentPct: number;
  velocity: number;
  conversionRate: number;
  elasticity: ElasticityGrade;
  displayOrder: number;
}

export interface ClearanceHistory {
  entries: ClearanceHistoryEntry[];
  originalPrices: Record<string, number>; // sku → 최초 판매가
}

export interface ClearanceResult {
  executedAt: string;
  products: ClearanceProduct[];
  priceChanges: number;
  displayChanges: number;
  totalDiscountAmount: number;
  errors: string[];
  debug?: {
    totalProducts: number;
    allCategories: string[];
    jewelryKeywords: string[];
  };
}

// ── 상수 ──────────────────────────────────────────────────────────────────

const FLOOR_PRICE_RATIO = 0.30;   // 하한가 = 원래가의 30%
const HISTORY_STORAGE_KEY = "paulvice_clearance_history_v1";
const JEWELRY_CATEGORY_NO = 44;   // 주얼리 카테고리 번호 (cafe24)
const JEWELRY_CATEGORY_KEYWORDS = ["주얼리", "jewelry", "쥬얼리", "악세사리", "악세서리", "액세서리"];

// ── KST 유틸 ──────────────────────────────────────────────────────────────

function kstNow() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}
function kstStr(d: Date) {
  return d.toISOString().slice(0, 10);
}

// ── Supabase 클라이언트 ───────────────────────────────────────────────────

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

// ── 이력 관리 (Supabase 영속 저장) ────────────────────────────────────────

const KV_HISTORY_KEY = "clearance_history_v1";

export async function loadServerHistory(): Promise<ClearanceHistory> {
  const supabase = getSupabase();
  if (!supabase) return { entries: [], originalPrices: {} };

  try {
    const { data, error } = await supabase
      .from("kv_store")
      .select("data")
      .eq("key", KV_HISTORY_KEY)
      .maybeSingle();
    if (error || !data?.data) return { entries: [], originalPrices: {} };
    return data.data as ClearanceHistory;
  } catch {
    return { entries: [], originalPrices: {} };
  }
}

export async function saveServerHistory(history: ClearanceHistory): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

  try {
    await supabase
      .from("kv_store")
      .upsert(
        { key: KV_HISTORY_KEY, data: history, updated_at: new Date().toISOString() },
        { onConflict: "key" }
      );
  } catch (e) {
    console.error("[Clearance] 이력 저장 실패:", e);
  }
}

// ── 1단계: 주얼리 카테고리 상품 수집 ──────────────────────────────────────

async function fetchJewelryProducts(token: string): Promise<{ products: any[]; debug: { totalProducts: number; allCategories: string[] } }> {
  // 카테고리 44번(주얼리) 상품을 직접 조회
  const allProducts: any[] = [];
  let offset = 0;
  while (true) {
    const data = await cafe24Get(
      `/api/v2/admin/products?limit=100&display=T&offset=${offset}&category=${JEWELRY_CATEGORY_NO}&embed=categories`,
      token
    );
    const batch: any[] = data.products ?? [];
    allProducts.push(...batch);
    if (batch.length < 100) break;
    offset += 100;
  }

  // 카테고리 44로 못 찾으면 키워드 폴백
  if (allProducts.length === 0) {
    let fallbackAll: any[] = [];
    let fbOffset = 0;
    while (true) {
      const data = await cafe24Get(
        `/api/v2/admin/products?limit=100&display=T&offset=${fbOffset}&embed=categories`,
        token
      );
      const batch: any[] = data.products ?? [];
      fallbackAll.push(...batch);
      if (batch.length < 100) break;
      fbOffset += 100;
    }

    // 카테고리 맵
    let catMap: Record<number, string> = {};
    try {
      const catData = await cafe24Get("/api/v2/admin/categories?limit=200&shop_no=1", token);
      for (const cat of (catData.categories ?? [])) {
        if (cat.category_no && cat.category_name) {
          catMap[Number(cat.category_no)] = cat.category_name;
        }
      }
    } catch { /* ignore */ }

    // 디버그: 전체 카테고리 수집
    const allCatNames = new Set<string>();
    for (const p of fallbackAll) {
      const cats: string[] = (p.categories ?? []).map((c: any) => catMap[Number(c.category_no)] ?? c.category_name ?? "");
      cats.filter(Boolean).forEach(n => allCatNames.add(n));
    }

    // 키워드 매칭 필터
    const filtered = fallbackAll.filter((p) => {
      const cats: string[] = (p.categories ?? []).map((c: any) => {
        const mapped = catMap[Number(c.category_no)] ?? "";
        const embedded = c.category_name ?? "";
        return `${mapped} ${embedded}`.toLowerCase();
      });
      return cats.some(name =>
        JEWELRY_CATEGORY_KEYWORDS.some(kw => name.includes(kw))
      );
    });

    return {
      products: filtered,
      debug: {
        totalProducts: fallbackAll.length,
        allCategories: [...allCatNames].sort(),
      },
    };
  }

  return {
    products: allProducts,
    debug: {
      totalProducts: allProducts.length,
      allCategories: [`카테고리 #${JEWELRY_CATEGORY_NO} (직접 조회)`],
    },
  };
}

// ── 2단계: 판매 데이터 수집 (최근 7일) ────────────────────────────────────

async function fetchRecentSales(token: string): Promise<Record<string, number>> {
  const now = kstNow();
  const weekAgo = new Date(now);
  weekAgo.setUTCDate(now.getUTCDate() - 7);

  const orders = await fetchAllOrders(token, kstStr(weekAgo), kstStr(now));
  const salesMap: Record<string, number> = {};

  for (const order of orders) {
    for (const item of (order.items ?? [])) {
      const sku = item.product_code ?? String(item.product_no);
      const qty = item.actual_quantity ?? item.quantity ?? 1;
      salesMap[sku] = (salesMap[sku] ?? 0) + qty;
    }
  }
  return salesMap;
}

// ── 3단계: 아마존식 탄력성 분석 ───────────────────────────────────────────

function analyzeElasticity(
  currentVelocity: number,
  prevVelocity: number,
  hadPriceChange: boolean,
): ElasticityGrade {
  if (!hadPriceChange) return "no_data";

  const velocityChange = prevVelocity > 0
    ? (currentVelocity - prevVelocity) / prevVelocity
    : currentVelocity > 0 ? 1 : 0;

  if (velocityChange > 0.1) return "responsive";      // 판매속도 10%↑ → 반응 있음
  if (velocityChange > -0.1) return "neutral";         // -10%~+10% → 변화 없음
  return "unresponsive";                                // 10%↓ → 반응 없음
}

// ── 4단계: 스마트 가격 결정 ───────────────────────────────────────────────

function decideAdjustment(elasticity: ElasticityGrade, conversionRate: number): number {
  switch (elasticity) {
    case "responsive":
      // 가격 내리니 잘 팔림 → 유지 or 소폭 추가 (탐욕적으로 더 내려 매출 극대화)
      return conversionRate > 0.05 ? 0 : 1;

    case "neutral":
      // 변화 없음 → 공격적 할인
      return conversionRate > 0.03 ? 3 : 5;

    case "unresponsive":
      // 내려도 안 팔림 → 가격 문제가 아님, 소폭만 (진열 변경에 집중)
      return 1;

    case "no_data":
      // 첫 실행 → 탐색적 2% 할인으로 반응 테스트
      return 2;
  }
}

// ── 5단계: 진열 순서 결정 ─────────────────────────────────────────────────

function decideDisplayOrder(products: ClearanceProduct[]): ClearanceProduct[] {
  return [...products].sort((a, b) => {
    // 1순위: 판매속도 상승 중 (responsive) → 최상위 (잘 팔리는 건 더 밀어줌)
    if (a.elasticity === "responsive" && b.elasticity !== "responsive") return -1;
    if (b.elasticity === "responsive" && a.elasticity !== "responsive") return 1;

    // 2순위: 조회수 0 (노출 부족) → 상위로 올려 테스트
    if (a.hits === 0 && b.hits > 0) return -1;
    if (b.hits === 0 && a.hits > 0) return 1;

    // 3순위: 전환율 높은 순
    return b.conversionRate - a.conversionRate;
  }).map((p, i) => ({ ...p, displayOrder: i + 1 }));
}

// ── 메인 실행 함수 ────────────────────────────────────────────────────────

export async function runJewelryClearance(token: string): Promise<ClearanceResult> {
  const now = kstNow();
  const todayStr = kstStr(now);

  // 이력 로드
  const history = await loadServerHistory();

  // 데이터 수집
  const [jewelryResult, salesMap] = await Promise.all([
    fetchJewelryProducts(token),
    fetchRecentSales(token),
  ]);

  const { products: rawProducts, debug } = jewelryResult;

  if (rawProducts.length === 0) {
    return {
      executedAt: todayStr,
      products: [],
      priceChanges: 0,
      displayChanges: 0,
      totalDiscountAmount: 0,
      errors: [`주얼리 상품 0개 (전체 ${debug.totalProducts}개 중). 카테고리: ${debug.allCategories.join(", ") || "없음"}`],
      debug: {
        totalProducts: debug.totalProducts,
        allCategories: debug.allCategories,
        jewelryKeywords: JEWELRY_CATEGORY_KEYWORDS,
      },
    };
  }

  // 상품별 분석
  let products: ClearanceProduct[] = rawProducts.map((p) => {
    const sku = p.product_code ?? String(p.product_no);
    const currentPrice = parseFloat(p.price ?? "0");
    const originalPrice = history.originalPrices[sku] ?? currentPrice;
    const floorPrice = Math.round(originalPrice * FLOOR_PRICE_RATIO);
    const hits = p.hits ?? 0;
    const sales = salesMap[sku] ?? 0;
    const conversionRate = hits > 0 ? sales / hits : 0;
    const velocity = sales / 7;

    // 전일 판매속도 (이력에서 가장 최근 값)
    const prevEntries = history.entries
      .filter(e => e.sku === sku)
      .sort((a, b) => b.date.localeCompare(a.date));
    const prevVelocity = prevEntries.length > 0 ? prevEntries[0].velocity : 0;
    const hadPriceChange = prevEntries.length > 0;

    const elasticity = analyzeElasticity(velocity, prevVelocity, hadPriceChange);
    const stepPct = decideAdjustment(elasticity, conversionRate);

    // 현재까지의 누적 할인율 (원래 가격 대비)
    const currentDiscountPct = originalPrice > 0
      ? Math.round((1 - currentPrice / originalPrice) * 100)
      : 0;

    // 새 총 할인율 = 기존 누적 할인율 + 이번 단계 할인율 (원래 가격 기준)
    const totalDiscountPct = currentDiscountPct + stepPct;

    // 새 가격 = 원래 가격에서 총 할인율 적용 (하한선 체크)
    const rawNewPrice = Math.round(originalPrice * (1 - totalDiscountPct / 100));
    const newPrice = Math.max(rawNewPrice, floorPrice);

    return {
      productNo: p.product_no,
      sku,
      name: p.product_name ?? "알 수 없음",
      image: p.list_image ?? p.small_image ?? "",
      currentPrice,
      originalPrice,
      floorPrice,
      hits,
      sales,
      conversionRate,
      velocity,
      prevVelocity,
      elasticity,
      adjustmentPct: originalPrice > 0 ? Math.round((1 - newPrice / originalPrice) * 100) : 0,
      newPrice,
      displayOrder: 0,
    };
  });

  // 진열 순서 결정
  products = decideDisplayOrder(products);

  // 카페24 API 속도 제한: 40건/분
  // → 429 에러 시 2초 대기 후 재시도 (최대 3회)
  const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

  async function putWithRetry(path: string, body: unknown, maxRetries = 3) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await cafe24Put(path, token, body);
      } catch (err: any) {
        if (err.message?.includes("429") && attempt < maxRetries - 1) {
          await delay(2000 * (attempt + 1)); // 2초, 4초, 6초
          continue;
        }
        throw err;
      }
    }
  }

  let priceChanges = 0;
  let displayChanges = 0;
  let totalDiscountAmount = 0;
  const errors: string[] = [];

  // 가격 변경 + 진열 순서를 하나의 PUT으로 합쳐서 API 호출 절약
  const sortedProducts = [...products].sort((a, b) => a.displayOrder - b.displayOrder);

  for (let i = 0; i < sortedProducts.length; i++) {
    const product = sortedProducts[i];
    const needsPriceChange = product.newPrice !== product.currentPrice && product.newPrice >= product.floorPrice;
    const requestBody: Record<string, unknown> = {
      display_sequence: i + 1,
    };
    // retail_price(소비자가)를 항상 원래 가격으로 보장 (할인 표시용)
    requestBody.retail_price = String(product.originalPrice);
    if (needsPriceChange) {
      requestBody.price = String(product.newPrice);
    }

    try {
      await putWithRetry(
        `/api/v2/admin/products/${product.productNo}`,
        { request: requestBody }
      );
      if (needsPriceChange) {
        totalDiscountAmount += product.currentPrice - product.newPrice;
        priceChanges++;
      }
      displayChanges++;
    } catch (err: any) {
      const msg = `API 실패 [${product.sku} / productNo:${product.productNo}]: ${err.message}`;
      console.error(`[Clearance] ${msg}`);
      errors.push(msg);
    }

    // 최초 원가 기록
    if (!history.originalPrices[product.sku]) {
      history.originalPrices[product.sku] = product.originalPrice;
    }

    // 이력 저장
    history.entries.push({
      date: todayStr,
      sku: product.sku,
      name: product.name,
      prevPrice: product.currentPrice,
      newPrice: product.newPrice,
      adjustmentPct: product.adjustmentPct,
      velocity: product.velocity,
      conversionRate: product.conversionRate,
      elasticity: product.elasticity,
      displayOrder: product.displayOrder,
    });
  }

  // 오래된 이력 정리 (90일 이전 삭제)
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - 90);
  const cutoffStr = kstStr(cutoff);
  history.entries = history.entries.filter(e => e.date >= cutoffStr);

  await saveServerHistory(history);

  return {
    executedAt: todayStr,
    products,
    priceChanges,
    displayChanges,
    totalDiscountAmount,
    errors,
  };
}

// ── 현황 조회 ─────────────────────────────────────────────────────────────

export async function getClearanceStatus(): Promise<{
  lastRun: string | null;
  recentHistory: ClearanceHistoryEntry[];
  originalPrices: Record<string, number>;
  totalProducts: number;
  totalDiscount: number;
}> {
  const history = await loadServerHistory();
  const dates = [...new Set(history.entries.map(e => e.date))].sort().reverse();
  const lastRun = dates[0] ?? null;

  // 최근 7일 이력
  const now = kstNow();
  const weekAgo = new Date(now);
  weekAgo.setUTCDate(now.getUTCDate() - 7);
  const weekAgoStr = kstStr(weekAgo);
  const recentHistory = history.entries.filter(e => e.date >= weekAgoStr);

  // 총 할인액 계산
  const totalDiscount = recentHistory.reduce((sum, e) => sum + (e.prevPrice - e.newPrice), 0);
  const totalProducts = new Set(recentHistory.map(e => e.sku)).size;

  return {
    lastRun,
    recentHistory,
    originalPrices: history.originalPrices,
    totalProducts,
    totalDiscount,
  };
}
