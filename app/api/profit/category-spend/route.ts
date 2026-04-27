/**
 * 재무 거래내역 카테고리별 합계 — P&L 고정비 자동 연동용.
 *
 * GET /api/profit/category-spend?since=YYYY-MM-DD&until=YYYY-MM-DD
 *   → { ok, perCategory: { [category]: { amount, count } } }
 *
 * 합산 대상: finance_bank_tx (출금만) + finance_card_usage (amount - cancel_amount)
 * 카테고리는 양쪽 다 동일한 TxCategory enum 사용.
 *
 * P&L 중복 방지를 위해 다음 카테고리는 응답에 포함하되 클라이언트에서
 * 어떻게 쓸지 결정 (광고비/매입/카드결제/매출/송금은 P&L 계산에 이미
 * 반영되거나 비용 아님).
 */
import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

function kstDateStr(offsetDays: number = 0): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const db = getDb();
  if (!db) return Response.json({ ok: false, error: "Supabase 미설정" }, { status: 500 });

  const since = req.nextUrl.searchParams.get("since") ?? kstDateStr(-29);
  const until = req.nextUrl.searchParams.get("until") ?? kstDateStr(0);

  // 통장: 출금건만 + tx_date in 범위
  // tx_date는 timestamptz 이므로 [since 00:00 KST, until 24:00 KST] 범위
  const sinceTs = `${since}T00:00:00+09:00`;
  const untilTs = `${until}T23:59:59+09:00`;

  const [bankRes, cardRes] = await Promise.all([
    db
      .from("finance_bank_tx")
      .select("category, withdrawal")
      .gte("tx_date", sinceTs)
      .lte("tx_date", untilTs)
      .gt("withdrawal", 0),
    db
      .from("finance_card_usage")
      .select("category, amount, cancel_amount")
      .gte("use_date", sinceTs)
      .lte("use_date", untilTs),
  ]);

  if (bankRes.error) {
    return Response.json({ ok: false, error: bankRes.error.message }, { status: 500 });
  }
  if (cardRes.error) {
    return Response.json({ ok: false, error: cardRes.error.message }, { status: 500 });
  }

  const perCategory: Record<string, { amount: number; count: number }> = {};
  const add = (cat: string | null, amt: number) => {
    if (amt <= 0) return;
    const c = cat || "기타";
    if (!perCategory[c]) perCategory[c] = { amount: 0, count: 0 };
    perCategory[c].amount += amt;
    perCategory[c].count += 1;
  };

  for (const r of bankRes.data ?? []) {
    add(r.category as string | null, Number(r.withdrawal) || 0);
  }
  for (const r of cardRes.data ?? []) {
    const net = (Number(r.amount) || 0) - (Number(r.cancel_amount) || 0);
    add(r.category as string | null, net);
  }

  return Response.json({
    ok: true,
    perCategory,
    since,
    until,
    bankCount: bankRes.data?.length ?? 0,
    cardCount: cardRes.data?.length ?? 0,
  });
}
