import { saveWithSync, loadFromServer } from "./syncStorage";

// ── 타입 ──────────────────────────────────────────────────────────────────

export interface ProductInfo {
  sku: string;
  name: string;
  image: string;
  category: string;   // 카테고리명 (Cafe24 API or 수동 입력)
  isManual: boolean;  // true = 수동 추가 제품
}

export interface InventoryEntry {
  sku: string;
  initialStock: number;
  stockInDate: string;      // YYYY-MM-DD
  manualAdjustment: number; // 수동 조정 (+/-)
  notes: string;
  categoryOverride: string; // 대시보드에서 직접 지정한 카테고리 (빈 문자열 = Cafe24 기본값 사용)
}

export type AgingStatus = "normal" | "caution" | "urgent" | "critical";

export interface InventoryProduct extends ProductInfo {
  entry: InventoryEntry;
  /** 채널별 판매 수량 — { cafe24: 123, wconcept: 50, musinsa: 20, ... } */
  soldByChannel: Record<string, number>;
  totalSold: number;
  currentStock: number;
  daysInStock: number;
  agingStatus: AgingStatus;
  stockPct: number;
}

// ── localStorage 키 ───────────────────────────────────────────────────────

const STORAGE_KEY         = "paulvice_inventory_v1";
const PRODUCTS_CACHE_KEY  = "paulvice_products_cache_v2";
const MANUAL_PRODUCTS_KEY = "paulvice_manual_products_v1";
const HIDDEN_SKUS_KEY     = "paulvice_hidden_skus_v1";

// ── InventoryEntry ─────────────────────────────────────────────────────────

export function defaultEntry(sku: string): InventoryEntry {
  return {
    sku,
    initialStock: 0,
    stockInDate: new Date().toISOString().slice(0, 10),
    manualAdjustment: 0,
    notes: "",
    categoryOverride: "",
  };
}

export function loadInventory(): Record<string, InventoryEntry> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

export function saveInventory(data: Record<string, InventoryEntry>): void {
  if (typeof window === "undefined") return;
  saveWithSync(STORAGE_KEY, data);
}

export function updateEntry(sku: string, patch: Partial<InventoryEntry>): void {
  const all = loadInventory();
  all[sku] = { ...defaultEntry(sku), ...all[sku], ...patch };
  saveInventory(all);
}

export async function syncInventoryFromServer(): Promise<Record<string, InventoryEntry> | null> {
  return loadFromServer<Record<string, InventoryEntry>>(STORAGE_KEY);
}

// ── Cafe24 제품 캐시 (기기별 캐시 유지 — 서버 동기화 불필요) ─────────────

export function saveProductsCache(products: ProductInfo[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(PRODUCTS_CACHE_KEY, JSON.stringify(products));
}

export function loadProductsCache(): ProductInfo[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(PRODUCTS_CACHE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

// ── 수동 추가 제품 ────────────────────────────────────────────────────────

export function loadManualProducts(): ProductInfo[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(MANUAL_PRODUCTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function saveManualProducts(products: ProductInfo[]): void {
  if (typeof window === "undefined") return;
  saveWithSync(MANUAL_PRODUCTS_KEY, products);
}

export function addManualProduct(product: ProductInfo): void {
  const list = loadManualProducts();
  list.push({ ...product, isManual: true });
  saveManualProducts(list);
}

export function deleteManualProduct(sku: string): void {
  const list = loadManualProducts().filter((p) => p.sku !== sku);
  saveManualProducts(list);
}

export async function syncManualProductsFromServer(): Promise<ProductInfo[] | null> {
  return loadFromServer<ProductInfo[]>(MANUAL_PRODUCTS_KEY);
}

// ── 숨김 처리 ─────────────────────────────────────────────────────────────

export function loadHiddenSkus(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(HIDDEN_SKUS_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch { return new Set(); }
}

export function hideProduct(sku: string): void {
  const set = loadHiddenSkus();
  set.add(sku);
  saveWithSync(HIDDEN_SKUS_KEY, [...set]);
}

export function unhideProduct(sku: string): void {
  const set = loadHiddenSkus();
  set.delete(sku);
  saveWithSync(HIDDEN_SKUS_KEY, [...set]);
}

export function clearHiddenSkus(): void {
  saveWithSync(HIDDEN_SKUS_KEY, []);
}

export async function syncHiddenSkusFromServer(): Promise<string[] | null> {
  return loadFromServer<string[]>(HIDDEN_SKUS_KEY);
}

// ── 에이징 계산 ────────────────────────────────────────────────────────────

export function calcAgingStatus(daysInStock: number, currentStock: number): AgingStatus {
  if (currentStock <= 0) return "normal";
  if (daysInStock >= 545) return "critical"; // 18개월↑ → 긴급소진
  if (daysInStock >= 365) return "urgent";   // 12개월(1년)↑ → 소진필요
  if (daysInStock >= 180) return "caution";  // 6개월↑ → 판매촉진
  return "normal";
}

export const AGING_CONFIG: Record<AgingStatus, { label: string; color: string; bg: string; description: string }> = {
  normal:   { label: "정상",     color: "text-emerald-600", bg: "bg-emerald-100", description: "재고 상태 양호" },
  caution:  { label: "판매촉진", color: "text-yellow-600",  bg: "bg-yellow-100",  description: "6개월 이상 — 판매 촉진 권장" },
  urgent:   { label: "소진필요", color: "text-orange-600",  bg: "bg-orange-100",  description: "1년 이상 — 할인 또는 프로모션 필요" },
  critical: { label: "긴급소진", color: "text-red-600",     bg: "bg-red-100",     description: "18개월 이상 — 즉시 처분 필요" },
};

// ── 통합 계산 ─────────────────────────────────────────────────────────────

export function buildInventoryProducts(
  products: ProductInfo[],
  /** sku → { channelId: sold } — 모든 채널의 판매 수량 (cafe24, wconcept, musinsa, "29cm", groupbuy, sixshop, ...) */
  soldBySku: Record<string, Record<string, number>>
): InventoryProduct[] {
  const entries = loadInventory();
  const today = new Date();

  return products.map((product) => {
    const entry = entries[product.sku] ?? defaultEntry(product.sku);
    const soldByChannel = soldBySku[product.sku] ?? {};
    const totalSold = Object.values(soldByChannel).reduce((s, n) => s + (n || 0), 0);
    const currentStock = Math.max(0, entry.initialStock + entry.manualAdjustment - totalSold);
    const stockInDate = new Date(entry.stockInDate);
    const daysInStock = Math.floor((today.getTime() - stockInDate.getTime()) / (1000 * 60 * 60 * 24));
    const agingStatus = calcAgingStatus(daysInStock, currentStock);
    const stockPct = entry.initialStock > 0
      ? Math.round((currentStock / entry.initialStock) * 100)
      : 0;

    const category = entry.categoryOverride || product.category;

    return {
      ...product,
      category,
      entry,
      soldByChannel,
      totalSold,
      currentStock,
      daysInStock,
      agingStatus,
      stockPct,
    };
  });
}
