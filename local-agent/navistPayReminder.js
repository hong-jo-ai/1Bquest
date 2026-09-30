/** 나비스트 월 결제 알림 — 매월 15일 09:30 (launchd com.paulvice.navist-pay-reminder).
 *
 * 나비스트는 전월 말일자로 세금계산서를 발행하고, 우리는 매월 15일에 총액(VAT 포함)을 송금한다.
 * 사장님이 자꾸 깜빡해서(2026-09-30) 금액까지 계산해 텔레그램으로 보낸다.
 *
 * 예상액 = 전월 거래명세서(kv navist:receipts:v1, 텔레그램 입고처리분) 합계 × 1.1
 *   ⚠️ 실제 청구는 세금계산서 기준 — AS 수리비가 명세서 없이 계산서에만 실리기도 한다(8/24 9,000원 차이).
 *   ⚠️ 나비스트 계산서는 제이에이치 앞이고 우리 메일로는 안 온다(finance_tax_invoices 에 3월 이후 없음).
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

  const lines = [`💎 <b>나비스트 결제일 (${m}/15)</b>`, "", `${pm}월 입고분 — ${pm}월 말일자 세금계산서 <b>총액(VAT 포함)</b>을 송금합니다.`, ""];
  if (recs.length) {
    for (const r of recs) {
      const items = (r.items || []).map((i) => `${i.name} ${i.qty}개`).join(", ");
      lines.push(`· ${r.date} ${items} — ${won(r.total)}원`);
    }
    lines.push("", `예상 송금액 <b>${won(supply + vat)}원</b> (공급가 ${won(supply)} + VAT ${won(vat)})`);
  } else {
    lines.push(`${pm}월 거래명세서 기록 없음 → 청구가 없을 수 있습니다. 계산서가 왔는지만 확인하세요.`);
  }
  lines.push("", "⚠️ 계산서에 <b>주얼리 AS 수리비</b>가 더 붙을 수 있습니다 — 송금은 계산서 금액대로.");
  if (paid && paid.length) lines.push("", `✅ 이번 달 나비스트 출금 기록 있음: ${paid.map((p) => `${p.tx_date.slice(5, 10)} ${won(p.withdrawal)}원`).join(", ")}`);
  const msg = lines.join("\n");

  if (DRY) { console.log(msg); return; }
  const ok = await sendTelegram(msg, { parseMode: "HTML", tag: "navist-pay-reminder" });
  if (!ok) { await notifyFail("나비스트 결제 알림 발송 실패", "텔레그램 전송 실패 — 오늘 15일 나비스트 결제를 직접 챙기세요."); process.exit(1); }
  await beat("navist-pay-reminder");
  console.log("발송:", prevKey, supply + vat);
})().catch(async (e) => { await notifyFail("나비스트 결제 알림 오류", String(e && e.message || e).slice(0, 200)); process.exit(1); });
