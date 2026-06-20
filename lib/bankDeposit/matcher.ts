/**
 * SMS 로 들어온 입금 정보와 매칭되는 카페24 미결제 무통장 주문 찾기.
 *
 * 매칭 기준:
 *   - 실제 결제예정금액(actual_order_amount.total_amount_due = 할인 반영) 이 입금액과 정확 일치
 *   - payment_date 비어있음 (= 미결제)
 *   - 최근 7일 이내
 *
 * 입금자명까지 일치하면 신뢰도 HIGH, 금액만 일치하면 MEDIUM.
 *
 * ⚠️ orderRevenue(매출인식용)로 매칭하면 무통장 미결제 주문은 payment_amount=0이라
 *    items 정상가(product_price)로 폴백 → 할인주문에서 입금액과 불일치(백장미 109000 vs 입금 79570).
 *    그래서 cafe24 actual_order_amount.total_amount_due(실제 입금해야 할 금액)를 1순위로 쓴다.
 */
import { fetchAllOrders, orderRevenue } from "../cafe24Data";
import type { MallId } from "../cafe24Client";

export interface Cafe24OrderLite {
  order_id?:             string;
  order_date?:           string;
  payment_date?:         string;
  order_status?:         string;
  buyer_name?:           string;
  billing_name?:         string;
  payer_name?:           string;
  bank_account_owner?:   string;
  payment_method?:       string;
  payment_amount?:       string | number;
  actual_payment_amount?: string | number;
  total_amount?:         string | number;
  order_price_amount?:   string | number;
  actual_order_amount?:  string | number;
  naverpay_pay_amount?:  string | number;
  items?: Array<{ product_name?: string; quantity?: number | string }>;
}

/** cafe24 금액 객체(actual_order_amount/initial_order_amount)에서 total_amount_due 추출. */
function totalAmountDue(v: unknown): number {
  if (v && typeof v === "object") {
    const n = parseFloat(String((v as Record<string, unknown>).total_amount_due ?? ""));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/**
 * 무통장 주문에서 실제 입금해야 할 금액(할인 반영). cafe24 응답에서
 * actual_order_amount.total_amount_due → initial_order_amount.total_amount_due
 * → payment_amount → (최후)orderRevenue 순으로 결정.
 */
export function depositAmountDue(o: Cafe24OrderLite): number {
  const ord = o as unknown as { actual_order_amount?: unknown; initial_order_amount?: unknown };
  const due = totalAmountDue(ord.actual_order_amount) || totalAmountDue(ord.initial_order_amount);
  if (due > 0) return due;
  const pay = Number(o.payment_amount ?? 0);
  if (pay > 0) return pay;
  return orderRevenue(o); // 폴백(정상가일 수 있음 — 위 필드가 비었을 때만)
}

export interface MatchCandidate {
  order:      Cafe24OrderLite;
  amount:     number;
  buyerName:  string;
  payerName:  string | null;
  /** 입금자명 prefix 일치 여부 (마스킹 안전) */
  nameMatch:  boolean;
  /** 이 주문이 속한 몰 — 입금확인을 올바른 몰에 보내기 위함. */
  mall:       MallId;
}

function kstDate(offsetDays = 0): string {
  const ms = Date.now() + 9 * 3600 * 1000 + offsetDays * 86400 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

function isUnpaid(o: Cafe24OrderLite): boolean {
  // payment_date 가 있으면 결제 확정. 비어있으면 미결제.
  if (o.payment_date && o.payment_date.trim() !== "") return false;
  // actual_payment_amount > 0 이면 결제됨 (다른 PG 거친 케이스)
  const paid = Number(o.actual_payment_amount ?? 0);
  if (paid > 0) return false;
  return true;
}

/** 입금자명 prefix 매칭 — SMS는 "홍**" 처럼 마스킹돼서 정확 일치 안 됨. */
function namesPossiblyMatch(smsName: string | null, orderName: string | null): boolean {
  if (!smsName || !orderName) return false;
  const sms = smsName.trim().replace(/\*/g, "");
  const ord = orderName.trim();
  if (sms.length === 0 || ord.length === 0) return false;
  // SMS 의 unmasked 부분이 주문자명의 시작과 같으면 매치
  return ord.startsWith(sms) || sms.startsWith(ord);
}

export async function findDepositCandidates(
  token:         string,
  amount:        number,
  smsDepositorName: string | null,
  mall:          MallId = "paulvice",
): Promise<MatchCandidate[]> {
  const start = kstDate(-7);
  const end   = kstDate(0);
  const orders = (await fetchAllOrders(token, start, end, true, mall)) as Cafe24OrderLite[];

  const candidates: MatchCandidate[] = [];
  for (const o of orders) {
    if (!isUnpaid(o)) continue;
    const orderAmount = Math.round(depositAmountDue(o));
    if (orderAmount !== amount) continue;
    const buyerName = (o.buyer_name ?? o.billing_name ?? "").trim();
    const payerName = (o.payer_name ?? o.bank_account_owner ?? "").trim() || null;
    const nameMatch =
      namesPossiblyMatch(smsDepositorName, payerName) ||
      namesPossiblyMatch(smsDepositorName, buyerName);
    candidates.push({
      order: o,
      amount: orderAmount,
      buyerName,
      payerName,
      nameMatch,
      mall,
    });
  }
  return candidates;
}
