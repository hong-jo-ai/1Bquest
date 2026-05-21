/**
 * 발주(PO) · 재입고 관리.
 *
 * 생산발주를 기록하고, 발주일 + 리드타임(기본 2~3주)으로 재입고 예상일을 잡아
 * 재고/판매와 함께 관리한다. 저장: kv_store.purchase_orders (배열).
 */
import { createClient } from "@supabase/supabase-js";

const KEY = "purchase_orders";

/** 기본 리드타임 — 보통 발주일 기준 2~3주 안에 재입고. */
export const DEFAULT_LEAD_MIN_DAYS = 14;
export const DEFAULT_LEAD_MAX_DAYS = 21;

export type POStatus = "ordered" | "received" | "cancelled";

export interface PurchaseOrder {
  id: string;
  sku: string;            // Cafe24 product_code (없으면 빈 문자열)
  productName: string;
  supplier: string;       // 공급사 (예: 나비스트)
  orderDate: string;      // YYYY-MM-DD (KST)
  qty: number;
  unitPrice?: number | null; // 단가 (매가 기준)
  amount?: number | null;    // 금액
  leadMinDays: number;
  leadMaxDays: number;
  status: POStatus;
  receivedDate?: string | null;
  receivedQty?: number | null;
  /** 입고 시 재고에 반영했는지 */
  stockApplied?: boolean;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export async function listPurchaseOrders(): Promise<PurchaseOrder[]> {
  const db = getDb();
  if (!db) return [];
  const { data } = await db.from("kv_store").select("data").eq("key", KEY).maybeSingle();
  const arr = data?.data;
  return Array.isArray(arr) ? (arr as PurchaseOrder[]) : [];
}

async function saveAll(list: PurchaseOrder[]): Promise<void> {
  const db = getDb();
  if (!db) throw new Error("Supabase 미설정");
  const { error } = await db
    .from("kv_store")
    .upsert({ key: KEY, data: list, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

function newId(): string {
  return `po_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

export interface CreatePOInput {
  sku?: string;
  productName: string;
  supplier?: string;
  orderDate: string;
  qty: number;
  unitPrice?: number | null;
  amount?: number | null;
  leadMinDays?: number;
  leadMaxDays?: number;
  notes?: string | null;
}

export async function createPurchaseOrder(input: CreatePOInput): Promise<PurchaseOrder> {
  const now = new Date().toISOString();
  const po: PurchaseOrder = {
    id: newId(),
    sku: (input.sku ?? "").trim(),
    productName: input.productName.trim(),
    supplier: (input.supplier ?? "").trim(),
    orderDate: input.orderDate,
    qty: Number(input.qty) || 0,
    unitPrice: input.unitPrice ?? null,
    amount: input.amount ?? null,
    leadMinDays: input.leadMinDays ?? DEFAULT_LEAD_MIN_DAYS,
    leadMaxDays: input.leadMaxDays ?? DEFAULT_LEAD_MAX_DAYS,
    status: "ordered",
    notes: input.notes ?? null,
    createdAt: now,
    updatedAt: now,
  };
  const list = await listPurchaseOrders();
  list.push(po);
  await saveAll(list);
  return po;
}

export async function updatePurchaseOrder(
  id: string,
  patch: Partial<Omit<PurchaseOrder, "id" | "createdAt">>,
): Promise<PurchaseOrder | null> {
  const list = await listPurchaseOrders();
  const idx = list.findIndex((p) => p.id === id);
  if (idx < 0) return null;
  list[idx] = { ...list[idx], ...patch, updatedAt: new Date().toISOString() };
  await saveAll(list);
  return list[idx];
}

export async function deletePurchaseOrder(id: string): Promise<boolean> {
  const list = await listPurchaseOrders();
  const next = list.filter((p) => p.id !== id);
  if (next.length === list.length) return false;
  await saveAll(next);
  return true;
}

/** 재입고 예상 범위 + 상태 계산 (today: YYYY-MM-DD KST). */
export function restockEta(po: PurchaseOrder): {
  start: string;
  end: string;
} {
  // UTC 자정 기준으로 일수만 더해 캘린더 날짜를 안정적으로 계산 (TZ off-by-one 방지)
  const d = new Date(po.orderDate + "T00:00:00Z");
  const fmt = (addDays: number) =>
    new Date(d.getTime() + addDays * 86400000).toISOString().slice(0, 10);
  return { start: fmt(po.leadMinDays), end: fmt(po.leadMaxDays) };
}
