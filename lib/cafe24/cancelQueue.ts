/**
 * 카페24 주문취소 큐 — 텔레그램 트리거("주문취소 <번호>")로 적재, iMac 워커(cafe24CancelWorker.js)가 실행.
 *
 * 흐름: 텔레그램 명령 → fetchOrderSummary 로 주문 확인 → setCancelPending(확인게이트) →
 *   사장님 "예" → resolveCancelPending 이 kv `cafe24_cancel_job:<id>`(status=pending) 적재 →
 *   iMac 워커가 폴링·브라우저 취소·API 검증·결과 보고.
 *
 * ⚠️ 현재 폴바이스(icaruse2000)만. 취소 실행 스크립트(cafe24CancelOrder.js)가 폴바이스 전용이라
 *    해리엇은 별도 셋업 필요.
 */
import { createClient } from "@supabase/supabase-js";
import { getAccessTokenFromStore } from "@/lib/cafe24TokenStore";
import { cafe24Get } from "@/lib/cafe24Client";

const JOB_PREFIX = "cafe24_cancel_job:";
const PENDING_KEY = "cafe24_cancel_confirm";

// 취소사유 코드(cs_type) — cafe24CancelOrder.js 와 동일
export const CANCEL_REASONS: Record<string, string> = {
  A: "고객변심", B: "배송지연", J: "배송오류", C: "배송불가지역", L: "수출/통관불가",
  D: "포장불량", E: "상품불만족", F: "상품정보상이", K: "상품불량", G: "서비스불만족", H: "품절", I: "기타",
};
const REASON_KEYWORD: Record<string, string> = {
  고객변심: "A", 변심: "A", 잘못주문: "A", 재주문: "A", 품절: "H", 배송지연: "B", 불량: "K", 기타: "I",
};

function db() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export interface CancelPending {
  orderId: string;
  brand: "paulvice";
  reason: string; // cs_type 코드
  summary: string;
  at: string;
}

/** "주문취소 20260627-0000050 [사유]" 파싱. 사유는 코드(A~L) 또는 키워드. 기본 A(고객변심). */
export function parseCancelCommand(text: string): { orderId: string; reason: string } | null {
  const m = text.match(/(?:주문\s*취소|취소)\s+(\d{8}-\d{7})(?:\s+(\S+))?/);
  if (!m) return null;
  const orderId = m[1];
  let reason = "A";
  const tok = (m[2] || "").trim();
  if (tok) {
    const up = tok.toUpperCase();
    if (CANCEL_REASONS[up]) reason = up;
    else if (REASON_KEYWORD[tok]) reason = REASON_KEYWORD[tok];
  }
  return { orderId, reason };
}

/** 주문 요약(확인용). 폴바이스만. */
export async function fetchOrderSummary(orderId: string): Promise<
  { ok: true; summary: string; amount: number; canceled: boolean } | { ok: false; error: string }
> {
  const token = await getAccessTokenFromStore(); // 폴바이스
  if (!token) return { ok: false, error: "카페24 토큰 없음" };
  try {
    const data = (await cafe24Get(`/api/v2/admin/orders/${orderId}?embed=items`, token)) as {
      order?: { canceled?: string; payment_amount?: string; payment_method_name?: string[]; items?: Array<{ product_name?: string; quantity?: number; order_status?: string }> };
    };
    const o = data.order;
    if (!o) return { ok: false, error: "주문 없음" };
    const amount = Number(o.payment_amount ?? 0);
    const items = (o.items ?? []).map((it) => `· ${it.product_name ?? "?"} ×${it.quantity ?? 1} [${it.order_status ?? ""}]`).join("\n");
    const pay = Array.isArray(o.payment_method_name) ? o.payment_method_name.join(",") : "";
    const summary = `주문번호 ${orderId}\n결제 ${pay} ${amount.toLocaleString("ko-KR")}원\n${items}`;
    return { ok: true, summary, amount, canceled: o.canceled === "T" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function setCancelPending(p: CancelPending): Promise<void> {
  const sb = db(); if (!sb) return;
  await sb.from("kv_store").upsert({ key: PENDING_KEY, data: p, updated_at: new Date().toISOString() }, { onConflict: "key" });
}

export async function getCancelPending(): Promise<CancelPending | null> {
  const sb = db(); if (!sb) return null;
  const { data } = await sb.from("kv_store").select("data").eq("key", PENDING_KEY).maybeSingle();
  return ((data as { data?: CancelPending } | null)?.data) ?? null;
}

/**
 * 텔레그램 예/아니오로 취소 확인게이트 해소. 대기중 취소건 없으면 null(웹훅이 다른 처리 계속).
 * approved=true → kv `cafe24_cancel_job:<id>` 적재. false → 취소(폐기).
 */
export async function resolveCancelPending(approved: boolean): Promise<{ orderId: string; enqueued: boolean } | null> {
  const sb = db(); if (!sb) return null;
  const pending = await getCancelPending();
  if (!pending) return null;
  await sb.from("kv_store").delete().eq("key", PENDING_KEY); // 소비
  if (!approved) return { orderId: pending.orderId, enqueued: false };
  const id = `${pending.orderId}-${Date.now().toString(36)}`;
  await sb.from("kv_store").upsert({
    key: JOB_PREFIX + id,
    data: { id, orderId: pending.orderId, brand: pending.brand, reason: pending.reason, status: "pending", createdAt: new Date().toISOString(), requestedVia: "telegram" },
    updated_at: new Date().toISOString(),
  }, { onConflict: "key" });
  return { orderId: pending.orderId, enqueued: true };
}
