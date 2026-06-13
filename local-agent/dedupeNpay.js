/**
 * 네이버페이(source=npay) 행 ↔ 카드(source=card_*) 행 중복 정리.
 *
 * 같은 결제(승인번호 approval_no + 금액 동일)가 카드 명세서와 네이버페이 영수증에서
 * 두 번 적재되어 P&L 이중계상되는 문제 해결. 카드행이 실제 결제(자금원)이므로:
 *   - 매칭되는 카드행을 네이버페이 상품명으로 보강(merchant + 재분류) 후 npay 행 삭제.
 *   - 카드 매칭 없는 npay 행(네이버페이머니/포인트 등 카드 미포착)은 유지.
 *
 * 멱등: 이미 보강된 카드행(raw.npayEnriched)은 건너뜀. npay 행 삭제로 재실행해도 안전.
 *
 * 실행:  node dedupeNpay.js --dry   ← 매칭만 출력(변경 없음)
 *        node dedupeNpay.js         ← 실제 보강+삭제
 */
const fs = require("fs"), path = require("path");
const DASH = path.resolve(__dirname, "..");
function le(p){try{for(const l of fs.readFileSync(p,"utf8").split("\n")){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);if(!m)continue;let v=m[2].trim().replace(/^["']|["']$/g,"");if(!(m[1] in process.env))process.env[m[1]]=v;}}catch{}}
le(path.join(DASH,".env.supabase")); le(path.join(DASH,".env.local"));
const { createClient } = require(path.join(DASH,"node_modules/@supabase/supabase-js"));

const DRY = process.argv.includes("--dry");
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  const { data, error } = await sb.from("finance_card_usage")
    .select("id,use_date,amount,merchant,category,category_source,source,approval_no,raw");
  if (error) { console.error("조회 실패:", error.message); process.exit(1); }

  const npay = data.filter((r) => r.source === "npay");
  const cards = data.filter((r) => /^card_/.test(r.source));
  // 카드행 인덱스: 승인번호+금액 → [행]
  const idx = {};
  for (const c of cards) { const k = (c.approval_no || "") + "|" + c.amount; (idx[k] = idx[k] || []).push(c); }

  let merged = 0, skipped = 0, kept = 0, dupSum = 0;
  for (const n of npay) {
    const k = (n.approval_no || "") + "|" + n.amount;
    const matches = n.approval_no ? (idx[k] || []) : [];
    if (!matches.length) { kept++; continue; }
    // 가장 시각이 가까운 카드행 선택
    const nt = new Date(n.use_date).getTime();
    const c = matches.slice().sort((a, b) => Math.abs(new Date(a.use_date) - nt) - Math.abs(new Date(b.use_date) - nt))[0];

    const already = c.raw && c.raw.npayEnriched;
    const newMerchant = `${n.merchant} (네이버페이)`;
    // 카드행이 수동분류면 보존, 아니면 npay 행이 적재 시 계산해둔 분류 사용(상품명 기반이라 더 정확)
    const cat = c.category_source === "manual" ? c.category : (n.category || c.category);
    dupSum += Number(n.amount) || 0;

    console.log(`${DRY ? "[dry] " : ""}병합  ₩${(Number(n.amount)||0).toLocaleString()}  app:${n.approval_no}`);
    console.log(`   카드:  ${c.source}  "${c.merchant}"  [${c.category}]`);
    console.log(`   →보강: "${newMerchant}"  [${cat}]${c.category_source==="manual"?" (수동분류 보존)":""}${already?"  (이미 보강됨)":""}`);

    if (!DRY) {
      if (!already) {
        const { error: ue } = await sb.from("finance_card_usage").update({
          merchant: newMerchant,
          category: cat,
          category_source: c.category_source === "manual" ? "manual" : "email",
          raw: { ...(c.raw || {}), npayEnriched: n.approval_no || true, npayMerchant: n.merchant, npayDedupedAt: new Date().toISOString() },
        }).eq("id", c.id);
        if (ue) { console.log("   ⚠️ 카드행 보강 실패:", ue.message); skipped++; continue; }
      }
      const { error: de } = await sb.from("finance_card_usage").delete().eq("id", n.id);
      if (de) { console.log("   ⚠️ npay 행 삭제 실패:", de.message); skipped++; continue; }
    }
    merged++;
  }

  console.log(`\n=== 요약 ===`);
  console.log(`병합+삭제(이중계상 제거): ${merged}건  ₩${dupSum.toLocaleString()}`);
  console.log(`유지(카드 매칭 없음):     ${kept}건`);
  if (skipped) console.log(`실패:                     ${skipped}건`);
  if (DRY) console.log(`\n(dry-run — 실제 변경 없음. 적용하려면 --dry 빼고 재실행)`);
})();
