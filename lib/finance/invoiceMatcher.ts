/**
 * 통장 거래내역의 출금건을 매입세금계산서(finance_tax_invoices)와 매칭.
 *
 * 통장에 "조범기(유현패키지) ₩1,705,000" 같이 송금 내역이 있을 때, 같은
 * 시기에 발행된 "유현패키지" 매입세금계산서가 있으면 매칭하여 어떤
 * 매입 건과 연결되는지 보여준다.
 *
 * 매칭 정책:
 *   - counterparty 정규화: 괄호 안 회사명 추출 ("조범기(유현패키지)" → "유현패키지")
 *   - partner_name 부분 매칭 (양방향 substring)
 *   - 윈도우: 통장 출금일 ± 60일 (세금계산서 발행일 기준)
 *   - 후보가 1건이면 매칭, 여러 건이면 금액이 가장 가까운 1건만 (단 차이 50%
 *     이상이면 매칭 안 함 — 분할 결제 등 가능성)
 */
import { createClient } from "@supabase/supabase-js";

export interface TaxInvoiceItem {
  id: string;
  issue_date: string;
  partner_name: string | null;
  total_amount: number;
  category: string | null;
  invoice_type: string;
}

export interface InvoiceMatch {
  invoice: TaxInvoiceItem;
  /** counterparty와 partner_name 일치 단어 (UI 강조용) */
  matchedTerm: string;
  /** 통장 출금액 vs 세금계산서 합계 차이 */
  amountDiff: number;
  /** 0~1, 1=완전 일치 */
  amountScore: number;
}

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

/** "조범기(유현패키지)" → ["조범기", "유현패키지"]. 빈 토큰 제거 + 짧은 토큰(2자 미만) 제외. */
export function tokenizeCounterparty(counterparty: string): string[] {
  if (!counterparty) return [];
  const tokens = new Set<string>();
  // 괄호 안 (회사명)
  const paren = counterparty.match(/\(([^)]+)\)/g);
  if (paren) {
    for (const p of paren) {
      const inner = p.slice(1, -1).trim();
      if (inner.length >= 2) tokens.add(inner);
    }
  }
  // 괄호 제거한 본명
  const main = counterparty.replace(/\([^)]*\)/g, "").trim();
  if (main.length >= 2) tokens.add(main);
  return Array.from(tokens);
}

/**
 * 일괄 매칭. 통장 출금 행 배열을 받아 각 행에 매칭되는 invoice 1건을 찾음.
 *
 * 효율: 모든 매입세금계산서를 한 번에 가져와서 메모리에서 매칭. (보통 N=수십~수백건)
 */
export async function enrichBankTxsWithInvoiceMatches(
  businessId: string,
  txs: Array<{ id: string; tx_date: string; withdrawal: number; counterparty: string | null }>,
): Promise<Record<string, InvoiceMatch>> {
  const supabase = getDb();
  if (!supabase) return {};

  // 후보 통장 출금건만 (counterparty 있고 출금 양수)
  const candidates = txs.filter((t) => Number(t.withdrawal) > 0 && (t.counterparty ?? "").trim().length >= 2);
  if (candidates.length === 0) return {};

  // 통장 출금일 범위 ± 60일을 모두 커버하는 윈도우로 일괄 fetch
  const dates = candidates.map((t) => new Date(t.tx_date).getTime());
  const minTs = Math.min(...dates) - 60 * 86400 * 1000;
  const maxTs = Math.max(...dates) + 60 * 86400 * 1000;
  const since = new Date(minTs).toISOString().slice(0, 10);
  const until = new Date(maxTs).toISOString().slice(0, 10);

  const { data: invoices, error } = await supabase
    .from("finance_tax_invoices")
    .select("id, issue_date, partner_name, total_amount, category, invoice_type")
    .eq("business_id", businessId)
    .eq("invoice_type", "purchase")
    .gte("issue_date", since)
    .lte("issue_date", until);

  if (error || !invoices || invoices.length === 0) return {};

  const out: Record<string, InvoiceMatch> = {};
  for (const t of candidates) {
    const tokens = tokenizeCounterparty(t.counterparty ?? "");
    if (tokens.length === 0) continue;

    const txTime = new Date(t.tx_date).getTime();
    const withdrawal = Number(t.withdrawal);

    // 후보: partner_name이 token을 포함 (또는 token이 partner_name 포함) + ±60일 + 양수 합계
    const matches: Array<{ invoice: TaxInvoiceItem; term: string }> = [];
    for (const inv of invoices as TaxInvoiceItem[]) {
      const partner = (inv.partner_name ?? "").trim();
      if (!partner || Number(inv.total_amount) <= 0) continue;

      const invTime = new Date(inv.issue_date).getTime();
      if (Math.abs(invTime - txTime) > 60 * 86400 * 1000) continue;

      const matchedTerm = tokens.find((tok) => partner.includes(tok) || tok.includes(partner));
      if (matchedTerm) matches.push({ invoice: inv, term: matchedTerm });
    }
    if (matches.length === 0) continue;

    // 금액이 가장 가까운 1건 선정. 차이 50% 이상이면 매칭 안 함.
    let best: { invoice: TaxInvoiceItem; term: string; diff: number } | null = null;
    for (const m of matches) {
      const diff = Math.abs(Number(m.invoice.total_amount) - withdrawal);
      if (!best || diff < best.diff) best = { ...m, diff };
    }
    if (!best) continue;

    const score = 1 - best.diff / Math.max(withdrawal, Number(best.invoice.total_amount));
    if (score < 0.5) continue; // 차이 50% 이상 → 매칭 신뢰 X

    out[t.id] = {
      invoice: best.invoice,
      matchedTerm: best.term,
      amountDiff: Number(best.invoice.total_amount) - withdrawal,
      amountScore: score,
    };
  }

  return out;
}
