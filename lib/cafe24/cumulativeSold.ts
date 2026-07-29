/**
 * SKU별 "누적" 판매 수량 — 재고관리 현재고 차감용.
 *
 * 배경(2026-07-29 버그):
 *   재고관리 현재고 = 초기재고 + 수동조정 − 판매 − 면세출고.
 *   기존 판매 소스가 cafe24Data.topProducts = `buildRanking(monthOrders, 10)` 였다.
 *   → ① 이번 달 판매 TOP 10 밖 상품은 판매=0 으로 잡혀 초기재고가 그대로 현재고로 뜨는
 *        "유령재고"(에끌라 오벌 골드가 품절·예약전환으로 TOP10에서 밀려나 재고 있음처럼 표시),
 *      ② 매월 1일이면 monthOrders 가 리셋돼 전 품목 판매가 0 → 재고 부풀림.
 *
 *   초기재고(initialStock)는 입고 시점(대개 몰 오픈 시드) 기준 수량이므로,
 *   판매도 그 시점 이후 "전 주문"을 SKU별로 누적 집계해야 정확히 차감된다.
 *   (재입고는 stockInDate 를 바꾸지 않고 manualAdjustment 로 더하므로, 누적 판매 하한은
 *    몰 주문 이력 시작일 고정으로 충분하다.)
 *
 * 비용: 라이브 주문 조회(수 개월치)가 무거워 KV(cafe24_cumulative_sold:{brand})에 TTL 캐시.
 *       카페24 orders API 기간 제한을 피하려 월 단위로 청크 조회.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  fetchAllOrders,
  isPaidOrder,
  isCanceledOrder,
  getGroupBuyProductNos,
} from "@/lib/cafe24Data";
import { type MallId } from "@/lib/cafe24Client";

const TTL_MS = 30 * 60 * 1000;         // 30분 캐시
const FLOOR_SINCE = "2026-03-01";      // 카페24 신몰 주문 이력 시작 하한(전 SKU stockInDate 이전)

export interface CumulativeSold {
  since: string;                       // 집계 시작일 (YYYY-MM-DD)
  computedAt: string;                  // 계산 시각 ISO
  soldBySku: Record<string, number>;   // 재고 SKU(product_code) → 누적 판매 수량
}

function kv(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function kstToday(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

/** since..until(포함)을 달력 월 단위 [start,end] 로 쪼갠다 (카페24 기간 제한 회피). */
function monthlyChunks(since: string, until: string): [string, string][] {
  const out: [string, string][] = [];
  let [y, m] = since.split("-").map(Number);       // m: 1~12
  const [uy, um] = until.split("-").map(Number);
  while (y < uy || (y === uy && m <= um)) {
    const mm = String(m).padStart(2, "0");
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate(); // 해당 월 말일
    const monthStart = `${y}-${mm}-01`;
    const monthEnd = `${y}-${mm}-${String(lastDay).padStart(2, "0")}`;
    out.push([monthStart < since ? since : monthStart, monthEnd > until ? until : monthEnd]);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

interface OrderItem {
  product_code?: string;
  product_no?: number | string;
  quantity?: number | string;
  actual_quantity?: number | string;
}
interface Order { items?: OrderItem[]; payment_date?: string | null; canceled?: string | null; actual_payment_amount?: string | number }

/** since 부터 오늘까지 결제·미취소 주문을 SKU별로 누적. 공구 상품은 별도 채널이라 제외(기존 동작 유지). */
export async function computeCumulativeSold(token: string, brand: MallId, since: string): Promise<Record<string, number>> {
  const gbNos = await getGroupBuyProductNos();
  const sold: Record<string, number> = {};
  for (const [start, end] of monthlyChunks(since, kstToday())) {
    const orders = (await fetchAllOrders(token, start, end, true, brand)) as Order[];
    for (const o of orders) {
      if (!isPaidOrder(o) || isCanceledOrder(o)) continue;
      for (const it of o.items ?? []) {
        if (gbNos.has(Number(it.product_no))) continue;   // 공구는 재고 차감을 bundle-stock-sync 등 별도 경로에서 처리
        const sku = it.product_code;
        if (!sku) continue;
        const qty = Number(it.actual_quantity ?? it.quantity ?? 1) || 0; // 실수량(부분취소 반영)
        if (qty > 0) sold[sku] = (sold[sku] ?? 0) + qty;
      }
    }
  }
  return sold;
}

/** KV TTL 캐시 경유 누적 판매. force=true 면 캐시 무시하고 재계산. */
export async function getCumulativeSoldBySku(token: string, brand: MallId, force = false): Promise<CumulativeSold> {
  const sb = kv();
  const cacheKey = `cafe24_cumulative_sold:${brand}`;
  if (sb && !force) {
    const { data } = await sb.from("kv_store").select("data").eq("key", cacheKey).maybeSingle();
    const cached = data?.data as CumulativeSold | undefined;
    if (cached?.computedAt && Date.now() - new Date(cached.computedAt).getTime() < TTL_MS) {
      return cached;
    }
  }
  const soldBySku = await computeCumulativeSold(token, brand, FLOOR_SINCE);
  const result: CumulativeSold = { since: FLOOR_SINCE, computedAt: new Date().toISOString(), soldBySku };
  if (sb) {
    await sb.from("kv_store").upsert(
      { key: cacheKey, data: result, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  }
  return result;
}
