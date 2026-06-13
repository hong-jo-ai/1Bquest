/**
 * 네이버페이(source=npay) 행 ↔ 카드(source=card_*) 행 이중계상 정리.
 *
 * 같은 결제가 카드 명세서와 네이버페이 영수증 양쪽에서 적재되면 승인번호(approval_no)+금액이
 * 동일하다. 카드행이 실제 결제(자금원)이므로 카드행을 네이버페이 상품명으로 보강하고 npay 행은
 * 삭제한다. 카드 매칭이 없는 npay 행(네이버페이머니/포인트 등 카드 미포착)은 유지.
 *
 * 멱등: 보강된 카드행은 raw.npayEnriched로 마킹, npay 행은 삭제되므로 재실행해도 안전.
 * card-usage 적재(POST) 직후 호출되어 npay·카드 import 순서와 무관하게 자동 병합된다.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

interface Row {
  id: string;
  use_date: string;
  amount: number;
  merchant: string;
  category: string | null;
  category_source: string | null;
  source: string;
  approval_no: string | null;
  raw: Record<string, unknown> | null;
}

export async function dedupeNpayCardRows(
  db: SupabaseClient,
): Promise<{ merged: number; kept: number }> {
  const { data, error } = await db
    .from("finance_card_usage")
    .select("id,use_date,amount,merchant,category,category_source,source,approval_no,raw");
  if (error || !data) return { merged: 0, kept: 0 };

  const rows = data as Row[];
  const npay = rows.filter((r) => r.source === "npay");
  const cards = rows.filter((r) => /^card_/.test(r.source));
  const idx = new Map<string, Row[]>();
  for (const c of cards) {
    const k = `${c.approval_no || ""}|${c.amount}`;
    const arr = idx.get(k);
    if (arr) arr.push(c);
    else idx.set(k, [c]);
  }

  let merged = 0, kept = 0;
  for (const n of npay) {
    if (!n.approval_no) { kept++; continue; }
    const matches = idx.get(`${n.approval_no}|${n.amount}`);
    if (!matches || !matches.length) { kept++; continue; }
    // 시각이 가장 가까운 카드행 선택
    const nt = new Date(n.use_date).getTime();
    const c = matches
      .slice()
      .sort((a, b) => Math.abs(new Date(a.use_date).getTime() - nt) - Math.abs(new Date(b.use_date).getTime() - nt))[0];

    const already = c.raw?.npayEnriched;
    if (!already) {
      const cat = c.category_source === "manual" ? c.category : (n.category || c.category);
      const { error: ue } = await db
        .from("finance_card_usage")
        .update({
          merchant: `${n.merchant} (네이버페이)`,
          category: cat,
          category_source: c.category_source === "manual" ? "manual" : "email",
          raw: { ...(c.raw || {}), npayEnriched: n.approval_no, npayMerchant: n.merchant, npayDedupedAt: new Date().toISOString() },
        })
        .eq("id", c.id);
      if (ue) { kept++; continue; }
    }
    const { error: de } = await db.from("finance_card_usage").delete().eq("id", n.id);
    if (de) { kept++; continue; }
    merged++;
  }
  return { merged, kept };
}
