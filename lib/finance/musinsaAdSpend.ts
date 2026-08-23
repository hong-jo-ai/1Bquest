/**
 * 무신사 파트너 광고비 집계 — 카드/체크 출금 내역에서 일별 광고비를 뽑아 `ad_spend:musinsa` 에 적재.
 *
 * 배경(2026-08-23): 무신사 광고 충전(3만원 단위)이 "기타"로 분류돼 어떤 집계에도 안 잡혔다.
 * W컨셉은 Moloco CSV로 ad_spend:wconcept 이 쌓이는데 무신사만 사각지대였다.
 *
 * 주의: 같은 결제가 카드(finance_card_usage)와 은행(finance_bank_tx) 양쪽에 잡히는 경우가 있어
 * (체크카드) 날짜+금액으로 중복을 제거한다.
 */
import { createClient } from "@supabase/supabase-js";
import { mergeAdSpend } from "./adSpendStore";

const MUSINSA_RE = /무신사페이먼|주식회사\s*무신사|MUSINS/i;

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

const kstDate = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().slice(0, 10);

/** 무신사 광고 충전 출금을 일별로 합산. since 이후(기본 90일). */
export async function collectMusinsaAdSpend(sinceDays = 90): Promise<Array<{ date: string; spend: number }>> {
  const db = getDb();
  if (!db) return [];
  const since = new Date(Date.now() - sinceDays * 86400e3).toISOString();

  // ⚠️ 무신사 필터를 DB에서 건다. 클라이언트 필터만 쓰면 select 기본 1000행 창에 걸려
  //    실행할 때마다 잡히는 건수가 달라진다(2026-08-23 소급분류 때 실측).
  const [card, bank] = await Promise.all([
    db.from("finance_card_usage").select("use_date,merchant,amount,cancel_amount")
      .gte("use_date", since).ilike("merchant", "%무신사%").limit(5000),
    db.from("finance_bank_tx").select("tx_date,counterparty,description,withdrawal")
      .gte("tx_date", since).gt("withdrawal", 0)
      .or("counterparty.ilike.%무신사%,description.ilike.%무신사%").limit(5000),
  ]);

  // 카드 우선 집계 → 은행 출금은 '카드에 없는 건'만 더한다.
  // ⚠️ 같은 날 같은 금액을 여러 번 충전하는 패턴이라(3만원 단위 반복) 단순 Set 중복제거는
  //    실제 결제를 잃는다. 날짜+금액별 '건수'로 맞춰 카드에 없는 초과분만 보탠다.
  const cardCount = new Map<string, number>();
  const cardAmt: Array<{ date: string; spend: number }> = [];
  for (const r of card.data ?? []) {
    if (!MUSINSA_RE.test(String(r.merchant ?? ""))) continue;
    const net = (Number(r.amount) || 0) - (Number(r.cancel_amount) || 0);
    if (net <= 0) continue;
    const date = kstDate(String(r.use_date));
    const k = `${date}|${net}`;
    cardCount.set(k, (cardCount.get(k) ?? 0) + 1);
    cardAmt.push({ date, spend: net });
  }
  const bankExtra: Array<{ date: string; spend: number }> = [];
  const used = new Map<string, number>();
  for (const r of bank.data ?? []) {
    const label = `${r.counterparty ?? ""} ${r.description ?? ""}`;
    if (!MUSINSA_RE.test(label)) continue;
    const amt = Number(r.withdrawal) || 0;
    if (amt <= 0) continue;
    const date = kstDate(String(r.tx_date));
    const k = `${date}|${amt}`;
    const consumed = used.get(k) ?? 0;
    if (consumed < (cardCount.get(k) ?? 0)) { used.set(k, consumed + 1); continue; } // 카드와 동일 건 → 스킵
    bankExtra.push({ date, spend: amt });
  }
  const rows = [...cardAmt, ...bankExtra];

  const byDate = new Map<string, number>();
  for (const v of rows) byDate.set(v.date, (byDate.get(v.date) ?? 0) + v.spend);
  return [...byDate.entries()].map(([date, spend]) => ({ date, spend })).sort((a, b) => a.date.localeCompare(b.date));
}

/** 집계 → ad_spend:musinsa 저장. */
export async function syncMusinsaAdSpend(sinceDays = 90) {
  const daily = await collectMusinsaAdSpend(sinceDays);
  if (!daily.length) return { days: 0, total: 0 };
  const res = await mergeAdSpend("musinsa", daily);
  return { days: daily.length, total: res.total, inserted: res.inserted, updated: res.updated };
}
