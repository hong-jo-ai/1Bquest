/**
 * Cafe24 새 주문 → Telegram 즉시 알림.
 *
 * 10분 cron 으로 호출. kv_store 에 저장된 last_notify_at 이후로 생성된 주문만
 * 잡아내서 Telegram 으로 한 건씩 보낸다. 처음 호출 시 (last_notify_at 이 없으면)
 * 직전 10분만 보고, 백필을 시도하지 않는다 (스팸 방지).
 */
import { fetchAllOrders, orderRevenue } from "./cafe24Data";
import { getAccessTokenFromStore } from "./cafe24TokenStore";
import { sendTelegramMessage } from "./cs/telegram";
import { getCsSupabase } from "./cs/store";

const KV_KEY = "cafe24_orders_last_notify_at";
const MAX_BATCH_NOTIFY = 20; // 한 번에 너무 많으면 Telegram rate limit 또는 스팸. 초과분은 다음 cron 으로 미룸.

interface Cafe24OrderItem {
  product_name?: string;
  product_no?: number | string;
  variant_code?: string;
  option_value?: string;
  quantity?: number | string;
  actual_quantity?: number | string;
}

interface Cafe24Order {
  order_id?:           string;
  order_date?:         string;
  payment_date?:       string;
  order_status?:       string;
  order_place_name?:   string;
  buyer_name?:         string;
  billing_name?:       string;
  member_id?:          string;
  total_amount?:       string | number;
  payment_amount?:     string | number;
  naverpay_pay_amount?: string | number;
  order_price_amount?: string | number;
  actual_order_amount?: string | number;
  actual_payment_amount?: string | number;
  items?: Cafe24OrderItem[];
  shipping_address?:   string;
  receiver_name?:      string;
}

/** KST 날짜 문자열 (YYYY-MM-DD) — Cafe24 API start_date/end_date 용. */
function kstDate(offsetDays = 0): string {
  const ms = Date.now() + 9 * 3600 * 1000 + offsetDays * 86400 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

async function getLastNotifyAt(): Promise<string> {
  const db = getCsSupabase();
  const { data } = await db
    .from("kv_store")
    .select("data")
    .eq("key", KV_KEY)
    .maybeSingle();
  if (data?.data && typeof data.data === "string") return data.data;
  // 처음 호출이면 10분 전부터 (백필 방지)
  return new Date(Date.now() - 10 * 60 * 1000).toISOString();
}

async function setLastNotifyAt(iso: string): Promise<void> {
  const db = getCsSupabase();
  await db.from("kv_store").upsert(
    { key: KV_KEY, data: iso, updated_at: new Date().toISOString() },
    { onConflict: "key" }
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatKRW(n: number): string {
  return n.toLocaleString("ko-KR") + "원";
}

function formatTimeKst(iso: string): string {
  const d = new Date(iso);
  const kst = new Date(d.getTime() + 9 * 3600 * 1000);
  const hh = String(kst.getUTCHours()).padStart(2, "0");
  const mm = String(kst.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function summarizeItems(items: Cafe24OrderItem[] | undefined): string {
  if (!items || items.length === 0) return "(상품정보 없음)";
  const first = items[0];
  const name = first.product_name?.trim() || `상품 #${first.product_no ?? "?"}`;
  const opt = first.option_value?.trim();
  const qty = Number(first.actual_quantity ?? first.quantity ?? 1) || 1;
  const head = opt ? `${name} (${opt})` : name;
  const more = items.length > 1 ? ` 외 ${items.length - 1}건` : "";
  const qtyLabel = qty > 1 ? ` × ${qty}` : "";
  return `${head}${qtyLabel}${more}`;
}

function formatOrder(o: Cafe24Order, base: string): string {
  const time = o.payment_date ?? o.order_date;
  const customer = o.buyer_name?.trim() || o.billing_name?.trim() || o.member_id?.trim() || "(고객 정보 없음)";
  const channel = o.order_place_name?.trim() || "카페24";
  const amount = orderRevenue(o);
  const items = summarizeItems(o.items);
  const orderId = o.order_id ?? "?";

  const lines = [
    `🛒 <b>새 주문 — ${escapeHtml(channel)}</b> ${time ? `(${escapeHtml(formatTimeKst(time))})` : ""}`,
    `<b>${escapeHtml(formatKRW(amount))}</b> · ${escapeHtml(customer)}`,
    escapeHtml(items),
    `주문번호 <code>${escapeHtml(orderId)}</code>`,
  ];
  if (base) {
    lines.push(`<a href="${base}/dashboard">대시보드</a>`);
  }
  return lines.filter(Boolean).join("\n");
}

export async function notifyNewCafe24Orders(): Promise<{
  fetched: number;
  sent: number;
  skipped: number;
  error?: string;
}> {
  const token = await getAccessTokenFromStore();
  if (!token) {
    return { fetched: 0, sent: 0, skipped: 0, error: "Cafe24 토큰 없음 — 재인증 필요" };
  }

  const since = await getLastNotifyAt();
  const sinceTs = new Date(since).getTime();
  const nowIso = new Date().toISOString();

  // KST 기준 어제~오늘 범위로 조회 (10분 cron 이라 오늘 거의 충분하지만 자정 경계 안전망)
  const start = kstDate(-1);
  const end = kstDate(0);

  let orders: Cafe24Order[] = [];
  try {
    orders = (await fetchAllOrders(token, start, end, true)) as Cafe24Order[];
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { fetched: 0, sent: 0, skipped: 0, error: `주문 조회 실패: ${msg}` };
  }

  // since 시점 이후의 주문만 필터 (order_date / payment_date 기준 — 더 이른 쪽)
  const fresh = orders
    .filter((o) => {
      const ref = o.order_date ?? o.payment_date;
      if (!ref) return false;
      return new Date(ref).getTime() > sinceTs;
    })
    .sort((a, b) => {
      const ta = new Date(a.order_date ?? a.payment_date ?? 0).getTime();
      const tb = new Date(b.order_date ?? b.payment_date ?? 0).getTime();
      return ta - tb;
    });

  if (fresh.length === 0) {
    await setLastNotifyAt(nowIso);
    return { fetched: orders.length, sent: 0, skipped: 0 };
  }

  const base = process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");

  const batch = fresh.slice(0, MAX_BATCH_NOTIFY);
  for (const o of batch) {
    await sendTelegramMessage(formatOrder(o, base));
  }

  // 배치로 잘렸으면 last_notify_at 을 마지막 보낸 주문 시점까지만 전진 (다음 cron 에서 나머지 발송)
  const lastTs = batch[batch.length - 1].order_date ?? batch[batch.length - 1].payment_date ?? nowIso;
  await setLastNotifyAt(lastTs);

  return {
    fetched: orders.length,
    sent: batch.length,
    skipped: fresh.length - batch.length,
  };
}
