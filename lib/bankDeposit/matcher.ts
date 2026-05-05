/**
 * SMS 로 들어온 입금 정보와 매칭되는 카페24 미결제 무통장 주문 찾기.
 *
 * 매칭 기준:
 *   - actual_payment_amount/order_revenue 가 입금액과 정확 일치
 *   - payment_date 비어있음 (= 미결제)
 *   - 최근 7일 이내
 *
 * 입금자명까지 일치하면 신뢰도 HIGH, 금액만 일치하면 MEDIUM.
 */
import { fetchAllOrders, orderRevenue } from "../cafe24Data";

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

export interface MatchCandidate {
  order:      Cafe24OrderLite;
  amount:     number;
  buyerName:  string;
  payerName:  string | null;
  /** 입금자명 prefix 일치 여부 (마스킹 안전) */
  nameMatch:  boolean;
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
): Promise<MatchCandidate[]> {
  const start = kstDate(-7);
  const end   = kstDate(0);
  const orders = (await fetchAllOrders(token, start, end, true)) as Cafe24OrderLite[];

  const candidates: MatchCandidate[] = [];
  for (const o of orders) {
    if (!isUnpaid(o)) continue;
    const orderAmount = Math.round(orderRevenue(o));
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
    });
  }
  return candidates;
}
