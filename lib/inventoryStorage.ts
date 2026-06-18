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
  discontinued?: boolean;   // 단종 — 저재고/품절이어도 재입고 알림 제외
  dutyfreeOut?: number;     // 면세점 출고 누적 차감(매출과 별개, 발주제안서 출고분)
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

const ARCHIVE_STOCK_DATE = "2024-01-01";

const ARCHIVE_NOTES_PREFIX =
  "2026-06-09 사진 실사 기준으로 추가한 이전 인기 모델 아카이브 재고입니다. 모델명/SKU 확정 전까지 외형별 임시 그룹으로 관리합니다.";

const ARCHIVE_PRODUCTS: ProductInfo[] = [
  {
    sku: "PV-ARCH-SQ-LTH-RG",
    name: "아카이브 사각 가죽 워치 - 로즈골드 케이스",
    image: "/inventory/archive/archive-square-leather-rosegold.jpg",
    category: "아카이브 워치",
    isManual: true,
  },
  {
    sku: "PV-ARCH-SQ-LTH-SV",
    name: "아카이브 사각 가죽 워치 - 실버 케이스",
    image: "/inventory/archive/archive-square-leather-silver.jpg",
    category: "아카이브 워치",
    isManual: true,
  },
  {
    sku: "PV-ARCH-SQ-MESH-GD",
    name: "아카이브 사각 메쉬 워치 - 골드",
    image: "/inventory/archive/archive-square-mesh-gold.jpg",
    category: "아카이브 워치",
    isManual: true,
  },
  {
    sku: "PV-ARCH-SQ-MESH-RG",
    name: "아카이브 사각 메쉬 워치 - 로즈골드",
    image: "/inventory/archive/archive-square-mesh-rosegold.jpg",
    category: "아카이브 워치",
    isManual: true,
  },
  {
    sku: "PV-ARCH-SQ-MESH-SV",
    name: "아카이브 사각 메쉬 워치 - 실버",
    image: "/inventory/archive/archive-square-mesh-silver.jpg",
    category: "아카이브 워치",
    isManual: true,
  },
  {
    sku: "PV-ARCH-RD-BRC-SV",
    name: "아카이브 라운드 브레이슬릿 워치 - 실버",
    image: "/inventory/archive/archive-round-bracelet-silver.jpg",
    category: "아카이브 워치",
    isManual: true,
  },
  {
    sku: "PV-ARCH-RD-BRC-GD",
    name: "아카이브 라운드 브레이슬릿 워치 - 골드/로즈골드",
    image: "/inventory/archive/archive-round-bracelet-gold.jpg",
    category: "아카이브 워치",
    isManual: true,
  },
  {
    sku: "PV-ARCH-RD-STR-PK",
    name: "아카이브 라운드 패턴 스트랩 워치 - 핑크/누드",
    image: "/inventory/archive/archive-round-strap-pink.jpg",
    category: "아카이브 워치",
    isManual: true,
  },
  {
    sku: "PV-ARCH-RD-STR-GN",
    name: "아카이브 라운드 텍스처 스트랩 워치 - 그린",
    image: "/inventory/archive/archive-round-strap-green.jpg",
    category: "아카이브 워치",
    isManual: true,
  },
  {
    sku: "PV-ARCH-RD-STR-BK",
    name: "아카이브 라운드 텍스처 스트랩 워치 - 블랙",
    image: "/inventory/archive/archive-round-strap-black.jpg",
    category: "아카이브 워치",
    isManual: true,
  },
  {
    sku: "PV-ARCH-RD-STR-BR",
    name: "아카이브 라운드 텍스처 스트랩 워치 - 브라운",
    image: "/inventory/archive/archive-round-strap-brown.jpg",
    category: "아카이브 워치",
    isManual: true,
  },
];

const ARCHIVE_ENTRIES: Record<string, InventoryEntry> = {
  "PV-ARCH-SQ-LTH-RG": {
    ...defaultEntry("PV-ARCH-SQ-LTH-RG"),
    initialStock: 6,
    stockInDate: ARCHIVE_STOCK_DATE,
    notes: `${ARCHIVE_NOTES_PREFIX} 사각 가죽 로즈골드 케이스 6개(브라운 스트랩 3, 블랙 스트랩 3)로 판독.`,
    categoryOverride: "아카이브 워치",
    discontinued: true,
  },
  "PV-ARCH-SQ-LTH-SV": {
    ...defaultEntry("PV-ARCH-SQ-LTH-SV"),
    initialStock: 2,
    stockInDate: ARCHIVE_STOCK_DATE,
    notes: `${ARCHIVE_NOTES_PREFIX} 사각 가죽 실버 케이스 2개(화이트 다이얼 1, 블랙 다이얼 1)로 판독.`,
    categoryOverride: "아카이브 워치",
    discontinued: true,
  },
  "PV-ARCH-SQ-MESH-GD": {
    ...defaultEntry("PV-ARCH-SQ-MESH-GD"),
    initialStock: 2,
    stockInDate: ARCHIVE_STOCK_DATE,
    notes: `${ARCHIVE_NOTES_PREFIX} 사각 골드 메쉬 2개로 판독.`,
    categoryOverride: "아카이브 워치",
    discontinued: true,
  },
  "PV-ARCH-SQ-MESH-RG": {
    ...defaultEntry("PV-ARCH-SQ-MESH-RG"),
    initialStock: 2,
    stockInDate: ARCHIVE_STOCK_DATE,
    notes: `${ARCHIVE_NOTES_PREFIX} 사각 로즈골드 메쉬 2개로 판독.`,
    categoryOverride: "아카이브 워치",
    discontinued: true,
  },
  "PV-ARCH-SQ-MESH-SV": {
    ...defaultEntry("PV-ARCH-SQ-MESH-SV"),
    initialStock: 1,
    stockInDate: ARCHIVE_STOCK_DATE,
    notes: `${ARCHIVE_NOTES_PREFIX} 사각 실버 메쉬 1개로 판독.`,
    categoryOverride: "아카이브 워치",
    discontinued: true,
  },
  "PV-ARCH-RD-BRC-SV": {
    ...defaultEntry("PV-ARCH-RD-BRC-SV"),
    initialStock: 3,
    stockInDate: ARCHIVE_STOCK_DATE,
    notes: `${ARCHIVE_NOTES_PREFIX} 라운드 실버 브레이슬릿 3개로 판독.`,
    categoryOverride: "아카이브 워치",
    discontinued: true,
  },
  "PV-ARCH-RD-BRC-GD": {
    ...defaultEntry("PV-ARCH-RD-BRC-GD"),
    initialStock: 4,
    stockInDate: ARCHIVE_STOCK_DATE,
    notes: `${ARCHIVE_NOTES_PREFIX} 라운드 골드/로즈골드 브레이슬릿 4개로 판독.`,
    categoryOverride: "아카이브 워치",
    discontinued: true,
  },
  "PV-ARCH-RD-STR-PK": {
    ...defaultEntry("PV-ARCH-RD-STR-PK"),
    initialStock: 2,
    stockInDate: ARCHIVE_STOCK_DATE,
    notes: `${ARCHIVE_NOTES_PREFIX} 라운드 핑크/누드 패턴 스트랩 2개로 판독.`,
    categoryOverride: "아카이브 워치",
    discontinued: true,
  },
  "PV-ARCH-RD-STR-GN": {
    ...defaultEntry("PV-ARCH-RD-STR-GN"),
    initialStock: 2,
    stockInDate: ARCHIVE_STOCK_DATE,
    notes: `${ARCHIVE_NOTES_PREFIX} 라운드 그린 텍스처 스트랩 2개로 판독.`,
    categoryOverride: "아카이브 워치",
    discontinued: true,
  },
  "PV-ARCH-RD-STR-BK": {
    ...defaultEntry("PV-ARCH-RD-STR-BK"),
    initialStock: 1,
    stockInDate: ARCHIVE_STOCK_DATE,
    notes: `${ARCHIVE_NOTES_PREFIX} 라운드 블랙 텍스처 스트랩 1개로 판독.`,
    categoryOverride: "아카이브 워치",
    discontinued: true,
  },
  "PV-ARCH-RD-STR-BR": {
    ...defaultEntry("PV-ARCH-RD-STR-BR"),
    initialStock: 1,
    stockInDate: ARCHIVE_STOCK_DATE,
    notes: `${ARCHIVE_NOTES_PREFIX} 라운드 브라운 텍스처 스트랩 1개로 판독.`,
    categoryOverride: "아카이브 워치",
    discontinued: true,
  },
};

function mergeArchiveEntries(entries: Record<string, InventoryEntry>): Record<string, InventoryEntry> {
  if (!isPaulviceBrand()) return entries; // 아카이브는 폴바이스 전용
  return { ...ARCHIVE_ENTRIES, ...entries };
}

function mergeArchiveProducts(products: ProductInfo[]): ProductInfo[] {
  if (!isPaulviceBrand()) return products; // 아카이브는 폴바이스 전용
  const seen = new Set(products.map((p) => p.sku));
  return [...products, ...ARCHIVE_PRODUCTS.filter((p) => !seen.has(p.sku))];
}

// ── 멀티몰: 현재 브랜드(폴바이스/해리엇)별로 키 분리 ─────────────────────
// 폴바이스는 기존 키(paulvice_*) 그대로 유지(데이터 보존). 해리엇은 harriot_* 로 분리.
// 아카이브(PV-ARCH-*)는 폴바이스 전용 — 해리엇엔 주입하지 않는다.
let ACTIVE_BRAND: "paulvice" | "harriot" = "paulvice";
export function setInventoryBrand(b: "paulvice" | "harriot"): void { ACTIVE_BRAND = b; }
export function getInventoryBrand(): "paulvice" | "harriot" { return ACTIVE_BRAND; }
const isPaulviceBrand = () => ACTIVE_BRAND === "paulvice";

// ── localStorage 키 (브랜드별) ────────────────────────────────────────────
const STORAGE_KEY         = () => `${ACTIVE_BRAND}_inventory_v1`;
const PRODUCTS_CACHE_KEY  = () => `${ACTIVE_BRAND}_products_cache_v2`;
const MANUAL_PRODUCTS_KEY = () => `${ACTIVE_BRAND}_manual_products_v1`;
const HIDDEN_SKUS_KEY     = () => `${ACTIVE_BRAND}_hidden_skus_v1`;

function readLocalJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

export function ensureArchiveInventorySeeded(): void {
  if (typeof window === "undefined") return;
  if (!isPaulviceBrand()) return; // 아카이브 시드는 폴바이스만

  const manual = readLocalJson<ProductInfo[]>(MANUAL_PRODUCTS_KEY(), []);
  const manualBySku = new Map(manual.map((p) => [p.sku, p]));
  for (const product of ARCHIVE_PRODUCTS) manualBySku.set(product.sku, {
    ...product,
    ...manualBySku.get(product.sku),
    image: manualBySku.get(product.sku)?.image || product.image,
    category: manualBySku.get(product.sku)?.category || product.category,
    isManual: true,
  });
  saveWithSync(MANUAL_PRODUCTS_KEY(), Array.from(manualBySku.values()));

  const inventory = readLocalJson<Record<string, InventoryEntry>>(STORAGE_KEY(), {});
  saveWithSync(STORAGE_KEY(), { ...ARCHIVE_ENTRIES, ...inventory });

  // 주의: 여기서 숨김 목록(HIDDEN_SKUS_KEY())을 건드리지 않는다.
  // 과거엔 아카이브 SKU를 숨김에서 강제로 제거(항상 노출)했는데,
  // 그 때문에 아카이브 제품을 삭제(숨김)해도 30초 폴링마다 되살아나는 버그가 있었다.
  // 아카이브 제품도 일반 제품처럼 숨길 수 있어야 하며(렌더 단계에서 hidden 필터로 제외),
  // 다시 보려면 "모두 복원"으로 숨김을 해제하면 된다.
}

// ── InventoryEntry ─────────────────────────────────────────────────────────

export function defaultEntry(sku: string): InventoryEntry {
  return {
    sku,
    initialStock: 0,
    stockInDate: new Date().toISOString().slice(0, 10),
    manualAdjustment: 0,
    notes: "",
    categoryOverride: "",
    discontinued: false,
    dutyfreeOut: 0,
  };
}

export function loadInventory(): Record<string, InventoryEntry> {
  if (typeof window === "undefined") return mergeArchiveEntries({});
  try {
    const raw = localStorage.getItem(STORAGE_KEY());
    return mergeArchiveEntries(raw ? JSON.parse(raw) : {});
  } catch { return mergeArchiveEntries({}); }
}

export function saveInventory(data: Record<string, InventoryEntry>): void {
  if (typeof window === "undefined") return;
  saveWithSync(STORAGE_KEY(), data);
}

export function updateEntry(sku: string, patch: Partial<InventoryEntry>): void {
  const all = loadInventory();
  all[sku] = { ...defaultEntry(sku), ...all[sku], ...patch };
  saveInventory(all);
}

export async function syncInventoryFromServer(): Promise<Record<string, InventoryEntry> | null> {
  return loadFromServer<Record<string, InventoryEntry>>(STORAGE_KEY());
}

// ── Cafe24 제품 캐시 (기기별 캐시 유지 — 서버 동기화 불필요) ─────────────

export function saveProductsCache(products: ProductInfo[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(PRODUCTS_CACHE_KEY(), JSON.stringify(products));
}

export function loadProductsCache(): ProductInfo[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(PRODUCTS_CACHE_KEY());
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

// ── 수동 추가 제품 ────────────────────────────────────────────────────────

export function loadManualProducts(): ProductInfo[] {
  if (typeof window === "undefined") return mergeArchiveProducts([]);
  try {
    const raw = localStorage.getItem(MANUAL_PRODUCTS_KEY());
    return mergeArchiveProducts(raw ? JSON.parse(raw) : []);
  } catch { return mergeArchiveProducts([]); }
}

export function saveManualProducts(products: ProductInfo[]): void {
  if (typeof window === "undefined") return;
  saveWithSync(MANUAL_PRODUCTS_KEY(), products);
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
  return loadFromServer<ProductInfo[]>(MANUAL_PRODUCTS_KEY());
}

// ── 숨김 처리 ─────────────────────────────────────────────────────────────

/** 서버에서 받은 숨김 SKU 목록을 현재 브랜드 키로 로컬 저장. */
export function saveHiddenSkusLocal(arr: string[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(HIDDEN_SKUS_KEY(), JSON.stringify(arr));
}

export function loadHiddenSkus(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(HIDDEN_SKUS_KEY());
    return new Set(raw ? JSON.parse(raw) : []);
  } catch { return new Set(); }
}

export function hideProduct(sku: string): void {
  const set = loadHiddenSkus();
  set.add(sku);
  saveWithSync(HIDDEN_SKUS_KEY(), [...set]);
}

export function unhideProduct(sku: string): void {
  const set = loadHiddenSkus();
  set.delete(sku);
  saveWithSync(HIDDEN_SKUS_KEY(), [...set]);
}

export function clearHiddenSkus(): void {
  saveWithSync(HIDDEN_SKUS_KEY(), []);
}

export async function syncHiddenSkusFromServer(): Promise<string[] | null> {
  return loadFromServer<string[]>(HIDDEN_SKUS_KEY());
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
    const currentStock = Math.max(0, entry.initialStock + entry.manualAdjustment - totalSold - (entry.dutyfreeOut ?? 0));
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
