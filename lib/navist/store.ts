/**
 * 나비스트(주얼리 공급처) 입고 저장소 — kv_store 기반 (경량, 단일 사용자).
 *  - navist:sku_map      : 제품명 → cafe24 SKU 매핑. 확인카드에서 처음 1회 지정하면 학습되어
 *                          다음 입고부터 자동 재고반영 (파쇼 cafe24Map과 동일 철학).
 *  - navist:receipts:v1  : 입고 원장(장부). 명세서 판독 결과를 그대로 적재.
 *
 * 파쇼와의 차이: 나비스트는 '열린 발주'가 없어 발주 매칭이 아니라 제품명→SKU 매핑이 앵커다.
 */
import { createClient, SupabaseClient } from "@supabase/supabase-js";

export interface Cafe24Ref {
  productNo: number;
  variantCode?: string;
  mall?: "paulvice" | "harriot";
}

export interface NavistReceiptItem {
  name: string;
  qty: number;
  unitPrice?: number;
  amount?: number;
}

export interface NavistReceiptRecord {
  id: string;
  vendor: string;
  date?: string;
  at: string;
  items: NavistReceiptItem[];
  total?: number;
  applied?: string; // cafe24 재고반영 요약
}

const K_SKU = "navist:sku_map";
const K_RECEIPTS = "navist:receipts:v1";

function kv(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

/** 제품명 정규화 — 공백 접힘·트림. SKU 맵 키로 사용해 OCR 미세차 흡수. */
export function normName(s: string): string {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

async function kvGet<T>(key: string): Promise<T | null> {
  const sb = kv(); if (!sb) return null;
  const { data } = await sb.from("kv_store").select("data").eq("key", key).maybeSingle();
  return (data?.data as T) ?? null;
}
async function kvSet(key: string, data: unknown): Promise<void> {
  const sb = kv(); if (!sb) return;
  await sb.from("kv_store").upsert(
    { key, data, updated_at: new Date().toISOString() }, { onConflict: "key" });
}

export async function getSkuMap(): Promise<Record<string, Cafe24Ref>> {
  return (await kvGet<Record<string, Cafe24Ref>>(K_SKU)) ?? {};
}

/** 매핑 학습 — read-modify-write. 제품명 키는 정규화해서 저장. */
export async function setSkuEntry(name: string, ref: Cafe24Ref): Promise<void> {
  const map = await getSkuMap();
  map[normName(name)] = ref;
  await kvSet(K_SKU, map);
}

/** 입고 원장에 1건 prepend. */
export async function addReceipt(rec: NavistReceiptRecord): Promise<void> {
  const list = (await kvGet<NavistReceiptRecord[]>(K_RECEIPTS)) ?? [];
  list.unshift(rec);
  await kvSet(K_RECEIPTS, list.slice(0, 500));
}

export async function listReceipts(limit = 50): Promise<NavistReceiptRecord[]> {
  const list = (await kvGet<NavistReceiptRecord[]>(K_RECEIPTS)) ?? [];
  return list.slice(0, limit);
}
