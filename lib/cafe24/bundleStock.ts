/**
 * 번들/프로모션 판매 → 기저 SKU 재고 차감.
 *
 * 프로모션·세트 상품(예: [시크릿프로모션] 에끌라 실버+메탈밴드)이 팔리면, 그 안에 든 실제
 * 기저 상품(에끌라 오벌 실버 #196) 재고를 함께 차감해 물리 재고를 일치시킨다.
 *
 * 트리거: 크론(bundle-stock-sync)이 최근 결제확정·미취소 주문을 조회 → 매핑된 프로모션 아이템의
 *         실수량 × 구성비만큼 기저 SKU 차감. 주문ID 멱등(한 번만 차감).
 *
 * 매핑(kv `cafe24_bundle_components:v1`): 사장님 확인 후 채운다. 비어있으면 아무 것도 안 함(안전).
 */
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { fetchAllOrders, isCanceledOrder } from "@/lib/cafe24Data";
import { getAccessTokenFromStore } from "@/lib/cafe24TokenStore";
import { getValidC24Token } from "@/lib/cafe24Auth";

export interface BundleComponent {
  productNo: number; variantCode?: string; qtyPer: number; mall?: "paulvice" | "harriot";
}
export interface BundleEntry { label: string; components: BundleComponent[] }
export type BundleMap = Record<string, BundleEntry>; // key = 프로모션 product_no (문자열)

const K_MAP = "cafe24_bundle_components:v1";
const K_DONE = "cafe24_bundle_done:v1"; // { [order_id]: iso } 처리완료 (60일 트림)

function kv(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}
async function kvGet<T>(key: string): Promise<T | null> {
  const sb = kv(); if (!sb) return null;
  const { data } = await sb.from("kv_store").select("data").eq("key", key).maybeSingle();
  return (data?.data as T) ?? null;
}
async function kvSet(key: string, data: unknown): Promise<void> {
  const sb = kv(); if (!sb) return;
  await sb.from("kv_store").upsert({ key, data, updated_at: new Date().toISOString() }, { onConflict: "key" });
}

export async function getBundleMap(): Promise<BundleMap> { return (await kvGet<BundleMap>(K_MAP)) ?? {}; }
export async function setBundleMap(m: BundleMap): Promise<void> { await kvSet(K_MAP, m); }

function kstDate(offset: number): string {
  const d = new Date(Date.now() + 9 * 3600_000 + offset * 86400_000);
  return d.toISOString().slice(0, 10);
}

interface OrderItem { product_no?: number | string; quantity?: number | string; actual_quantity?: number | string }
interface Order { order_id?: string; payment_date?: string; canceled?: string | null; items?: OrderItem[] }

async function decrementSku(c: BundleComponent, dec: number): Promise<string> {
  const mall = c.mall || "paulvice";
  const token = await getValidC24Token(mall);
  if (!token) return `SKU${c.productNo}: 토큰없음`;
  const mallId = mall === "harriot" ? process.env.HARRIOT_CAFE24_MALL_ID : process.env.CAFE24_MALL_ID;
  const base = `https://${mallId}.cafe24api.com/api/v2/admin`;
  const H = { Authorization: `Bearer ${token}`, "X-Cafe24-Api-Version": "2026-03-01", "Content-Type": "application/json" };
  const vRes = await fetch(`${base}/products/${c.productNo}/variants`, { headers: H }).then((r) => r.json());
  const variants = (vRes.variants || []) as Array<{ variant_code: string; quantity: number }>;
  const v = c.variantCode ? variants.find((x) => x.variant_code === c.variantCode) : variants[0];
  if (!v) return `SKU${c.productNo}: variant없음`;
  const next = Math.max(0, (v.quantity || 0) - dec);
  await fetch(`${base}/products/${c.productNo}/variants/${v.variant_code}/inventories`, {
    method: "PUT", headers: H, body: JSON.stringify({ request: { quantity: next } }),
  });
  return `#${c.productNo} -${dec}→${next}`;
}

export async function syncBundleDeductions(opts: { dryRun?: boolean; baseline?: boolean } = {}): Promise<{
  processed: number; applied: string[]; skipped: string; error?: string;
}> {
  const map = await getBundleMap();
  if (Object.keys(map).length === 0) return { processed: 0, applied: [], skipped: "매핑 없음(비활성)" };

  const token = await getAccessTokenFromStore();
  if (!token) return { processed: 0, applied: [], skipped: "", error: "Cafe24 토큰 없음" };

  let orders: Order[] = [];
  try {
    orders = (await fetchAllOrders(token, kstDate(-2), kstDate(0), true)) as Order[];
  } catch (e) {
    return { processed: 0, applied: [], skipped: "", error: `주문조회 실패: ${e instanceof Error ? e.message : String(e)}` };
  }

  const done = (await kvGet<Record<string, string>>(K_DONE)) ?? {};
  const applied: string[] = [];
  let processed = 0;

  for (const o of orders) {
    if (!o.order_id || done[o.order_id]) continue;
    if (!o.payment_date) continue;              // 결제확정만 (무통장 미입금 팬텀 차감 방지)
    if (isCanceledOrder(o)) continue;           // 전체취소 제외
    let touched = false;
    for (const it of o.items || []) {
      const entry = map[String(it.product_no)];
      if (!entry) continue;
      const qty = Number(it.actual_quantity ?? it.quantity ?? 0); // 실수량(부분취소 반영)
      if (qty <= 0) continue;
      for (const c of entry.components) {
        const dec = qty * c.qtyPer;
        const r = opts.baseline ? "baseline(차감안함)" : opts.dryRun ? `#${c.productNo} -${dec}(dry)` : await decrementSku(c, dec);
        applied.push(`${o.order_id} ${entry.label}×${qty} → ${r}`);
        touched = true;
      }
    }
    if (touched) { processed++; if (!opts.dryRun) done[o.order_id] = new Date().toISOString(); }
  }

  // 60일 지난 처리기록 트림
  if (!opts.dryRun) {
    const cutoff = Date.now() - 60 * 86400_000;
    for (const [k, v] of Object.entries(done)) if (new Date(v).getTime() < cutoff) delete done[k];
    await kvSet(K_DONE, done);
  }

  return { processed, applied, skipped: "" };
}
