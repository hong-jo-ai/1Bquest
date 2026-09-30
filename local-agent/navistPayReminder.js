/** 나비스트 월 결제 알림 — 매월 15일 09:30 (launchd com.paulvice.navist-pay-reminder).
 *
 * 나비스트는 전월 말일자로 세금계산서를 발행하고, 우리는 매월 15일에 총액(VAT 포함)을 송금한다.
 * 사장님이 자꾸 깜빡해서(2026-09-30) 금액까지 계산해 텔레그램으로 보낸다.
 *
 * 금액 = 전월 말일자 나비스트 세금계산서(finance_tax_invoices, 공급자 104-86-57186) 총액.
 *   계산서가 아직 안 잡혔으면 전월 거래명세서(kv navist:receipts:v1) 합계 × 1.1 로 예상만 한다.
 *   ⚠️ 계산서엔 AS 수리비가 명세서 없이 더 실리기도 한다(8월 9,000 · 9월 5,000 차이).
 *   ⚠️ 2026-09 까지 나비스트는 계산서를 jacobhong2@ 로 보내고 있어 수집이 안 됐다 →
 *      사장님이 shong@ 로 바꿔 달라고 요청(9/30). 이후엔 taxInvoiceSync(매일 18:30)가 자동 적재.
 *
 * 실행:  node navistPayReminder.js          ← 발송
 *        node navistPayReminder.js --dry    ← 메시지만 출력
 */
const fs = require("fs"), path = require("path");
const DASH = path.resolve(__dirname, "..");
function le(p) { try { for (const l of fs.readFileSync(p, "utf8").split("\n")) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (!m) continue; if (!(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, ""); } } catch {} }
le(path.join(__dirname, ".env")); le(path.join(DASH, ".env.local")); le(path.join(DASH, ".env.supabase"));
const { createClient } = require(path.join(DASH, "node_modules/@supabase/supabase-js"));
const { sendTelegram, notifyFail } = require("./notifyFail");
const { beat } = require("./heartbeat");

const DRY = process.argv.includes("--dry");
const won = (n) => Number(n).toLocaleString("ko-KR");

(async () => {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const kst = new Date(Date.now() + 9 * 3600e3);
  const y = kst.getUTCFullYear(), m = kst.getUTCMonth() + 1;
  const pm = m === 1 ? 12 : m - 1, py = m === 1 ? y - 1 : y;
  const prevKey = `${py}-${String(pm).padStart(2, "0")}`;
  const curKey = `${y}-${String(m).padStart(2, "0")}`;

  const { data: row } = await sb.from("kv_store").select("data").eq("key", "navist:receipts:v1").maybeSingle();
  const all = Array.isArray(row && row.data) ? row.data : [];
  const recs = all.filter((r) => String(r.date || "").startsWith(prevKey));
  const supply = recs.reduce((s, r) => s + (Number(r.total) || 0), 0);
  const vat = Math.round(supply * 0.1);

  // 이번 달 이미 나비스트로 나간 돈이 잡혀 있으면 알려준다(KB 통장은 문자 수집이 빠질 때가 있어 "없음"은 확정이 아님).
  const { data: paid } = await sb.from("finance_bank_tx").select("tx_date,withdrawal,account_number")
    .ilike("counterparty", "%나비스트%").gte("tx_date", `${curKey}-01`).gt("withdrawal", 0);

  const lastDay = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  const { data: invs } = await sb.from("finance_tax_invoices").select("write_date,supply_amount,tax_amount,total_amount")
    .eq("partner_reg_no", "104-86-57186").gte("write_date", `${prevKey}-01`).lte("write_date", `${prevKey}-${lastDay}`);
  const inv = (invs || []).reduce((a, r) => ({ supply: a.supply + r.supply_amount, tax: a.tax + r.tax_amount, total: a.total + r.total_amount }), { supply: 0, tax: 0, total: 0 });

  const lines = [`💎 <b>나비스트 결제일 (${m}/15)</b>`, "", `${pm}월 입고분 — ${pm}월 말일자 세금계산서 <b>총액(VAT 포함)</b>을 송금합니다.`, ""];
  if (recs.length) {
    for (const r of recs) {
      const items = (r.items || []).map((i) => `${i.name} ${i.qty}개`).join(", ");
      lines.push(`· ${r.date} ${items} — ${won(r.total)}원`);
    }
  }
  if (invs && invs.length) {
    lines.push("", `🧾 세금계산서 ${invs.map((r) => r.write_date.slice(5)).join(", ")}자 — 송금액 <b>${won(inv.total)}원</b> (공급가 ${won(inv.supply)} + VAT ${won(inv.tax)})`);
    if (recs.length && inv.supply !== supply) lines.push(`   명세서 합계와 ${won(inv.supply - supply)}원 차이 — 대개 AS 수리비`);
  } else if (recs.length) {
    lines.push("", `⚠️ 계산서가 아직 안 잡힘 → 명세서 기준 예상 <b>${won(supply + vat)}원</b> (공급가 ${won(supply)} + VAT ${won(vat)})`, "   계산서가 shong@ 으로 왔는지 확인하세요.");
  }
  if (!recs.length && !(invs && invs.length)) {
    lines.push(`${pm}월 거래명세서 기록 없음 → 청구가 없을 수 있습니다. 계산서가 왔는지만 확인하세요.`);
  }
  if (paid && paid.length) lines.push("", `✅ 이번 달 나비스트 출금 기록 있음: ${paid.map((p) => `${p.tx_date.slice(5, 10)} ${won(p.withdrawal)}원`).join(", ")}`);
  const msg = lines.join("\n");

  if (DRY) { console.log(msg); return; }
  const ok = await sendTelegram(msg, { parseMode: "HTML", tag: "navist-pay-reminder" });
  if (!ok) { await notifyFail("나비스트 결제 알림 발송 실패", "텔레그램 전송 실패 — 오늘 15일 나비스트 결제를 직접 챙기세요."); process.exit(1); }
  await beat("navist-pay-reminder");
  console.log("발송:", prevKey, inv.total || supply + vat);
})().catch(async (e) => { await notifyFail("나비스트 결제 알림 오류", String(e && e.message || e).slice(0, 200)); process.exit(1); });
