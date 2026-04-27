/**
 * P&L 설정값 — Supabase kv_store에 저장.
 * 채널별 수수료율, 고정비, 택배 단가, 부가세율 등.
 */
import { createClient } from "@supabase/supabase-js";

const KEYS = {
  channelFees: "cost_settings:channel_fees",
  fixedCosts: "cost_settings:fixed_costs",
  shipping: "cost_settings:shipping",
  vatRate: "cost_settings:vat_rate",
  productCogs: "cost_settings:product_cogs",
} as const;

export interface FixedCost {
  id: string; // uuid or simple unique
  name: string;
  monthly: number; // 원
}

export interface ProfitSettings {
  channelFees: Record<string, number>; // 퍼센트 (e.g. 3.85)
  fixedCosts: FixedCost[];
  shippingPerOrder: number; // 원
  vatRate: number; // 퍼센트 (10 = 10%)
}

export const DEFAULT_SETTINGS: ProfitSettings = {
  channelFees: {
    cafe24: 3.85,
    wconcept: 30,
    musinsa: 30,
    "29cm": 30,
    sixshop: 1.85,
    naver_smartstore: 5.563,
    sixshop_global: 1.85,
    groupbuy: 0,
    kakao_gift: 30, // 카카오 + 피오르드(중간 벤더) 통합 수수료. 정산서 검증으로 30% 확정
  },
  fixedCosts: [],
  shippingPerOrder: 2500,
  vatRate: 10,
};

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

async function readKv<T>(key: string, fallback: T): Promise<T> {
  const db = getDb();
  if (!db) return fallback;
  const { data } = await db
    .from("kv_store")
    .select("data")
    .eq("key", key)
    .maybeSingle();
  if (!data?.data) return fallback;
  return data.data as T;
}

async function writeKv(key: string, value: unknown): Promise<void> {
  const db = getDb();
  if (!db) throw new Error("Supabase 미설정");
  const { error } = await db
    .from("kv_store")
    .upsert(
      { key, data: value as object, updated_at: new Date().toISOString() },
      { onConflict: "key" }
    );
  if (error) throw new Error(error.message);
}

// ── 제품별 매입원가 (COGS) ─────────────────────────────────────────────

export type ProductCogsMap = Record<string, number>; // SKU → 원가

export async function getProductCogs(): Promise<ProductCogsMap> {
  return readKv<ProductCogsMap>(KEYS.productCogs, {});
}

export async function saveProductCogs(map: ProductCogsMap): Promise<void> {
  await writeKv(KEYS.productCogs, map);
}

export async function updateProductCogs(
  patch: ProductCogsMap
): Promise<ProductCogsMap> {
  const current = await getProductCogs();
  const next: ProductCogsMap = { ...current };
  for (const [sku, cost] of Object.entries(patch)) {
    if (cost === 0 || cost === null) {
      delete next[sku];
    } else {
      next[sku] = cost;
    }
  }
  await saveProductCogs(next);
  return next;
}

export async function getProfitSettings(): Promise<ProfitSettings> {
  const [channelFees, fixedCosts, shipping, vat] = await Promise.all([
    readKv(KEYS.channelFees, DEFAULT_SETTINGS.channelFees),
    readKv(KEYS.fixedCosts, DEFAULT_SETTINGS.fixedCosts),
    readKv(KEYS.shipping, { perOrder: DEFAULT_SETTINGS.shippingPerOrder }),
    readKv(KEYS.vatRate, DEFAULT_SETTINGS.vatRate),
  ]);

  return {
    channelFees: { ...DEFAULT_SETTINGS.channelFees, ...channelFees },
    fixedCosts,
    shippingPerOrder: (shipping as { perOrder: number }).perOrder ?? DEFAULT_SETTINGS.shippingPerOrder,
    vatRate: vat,
  };
}

export async function saveProfitSettings(patch: Partial<ProfitSettings>): Promise<void> {
  const tasks: Promise<void>[] = [];
  if (patch.channelFees) tasks.push(writeKv(KEYS.channelFees, patch.channelFees));
  if (patch.fixedCosts) tasks.push(writeKv(KEYS.fixedCosts, patch.fixedCosts));
  if (patch.shippingPerOrder !== undefined) {
    tasks.push(writeKv(KEYS.shipping, { perOrder: patch.shippingPerOrder }));
  }
  if (patch.vatRate !== undefined) tasks.push(writeKv(KEYS.vatRate, patch.vatRate));
  await Promise.all(tasks);
}
