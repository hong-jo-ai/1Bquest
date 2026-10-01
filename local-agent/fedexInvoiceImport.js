/**
 * 페덱스 청구 내역(Billing Online 엑셀) 적재 — 월 1회 갱신.
 *
 * 왜 필요한가(2026-10-01): 페덱스 실비를 건당 4만으로 어림해 왔는데 실제는 운임 5.6만 + 미납 관세 전가분이었다
 *   (9월 추정 100만 vs 실청구 174만). 손익·기원 정산이 청구서 실액을 써야 해서, 매달 청구 내역을 쌓아 둔다.
 *
 * 🔴 다운로드 자체는 자동화하지 않는다 — Billing Online 은 로그인이 필요하고 세션이 금방 끊긴다.
 *   자동 로그인은 계정 잠금 위험(마켓 사고 선례)이라 하지 않는다. 대신:
 *     ① 매월 8일·15일에 "내려받아 폴더에 넣어 달라"고 텔레그램으로 알린다(그달 청구분이 아직 없을 때만).
 *     ② 사장님이 엑셀을 `공유드라이브/다운로드/페덱스청구/` 에 넣으면 1시간 안에 자동으로 읽어 반영하고 요약을 보낸다.
 *
 * 저장: kv `fedex_invoice_data` = { rows: { "<청구서번호>|<AWB>": {...} }, files: [...], lastRemind }
 *   같은 파일·겹치는 기간을 다시 넣어도 키가 같아 중복되지 않는다(누계 파일을 매번 통째로 받아도 된다).
 *
 * 실행: node fedexInvoiceImport.js                폴더 스캔 → 새 파일 적재 → 필요하면 알림 (launchd, 1시간마다)
 *       node fedexInvoiceImport.js <파일.xlsx>     그 파일만 적재
 *       node fedexInvoiceImport.js --summary      지금까지 쌓인 데이터 요약만 출력
 *       --dry                                     kv·텔레그램 없이 무엇이 들어갈지만 출력
 */
const fs = require("fs");
const path = require("path");
const DASH = path.resolve(__dirname, "..");
for (const p of [`${DASH}/.env.supabase`, `${DASH}/.env.local`, `${__dirname}/.env`]) {
  try { for (const l of fs.readFileSync(p, "utf8").split("\n")) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  } } catch { /* 없으면 무시 */ }
}
const XLSX = require(`${DASH}/node_modules/xlsx`);
const { createClient } = require(`${DASH}/node_modules/@supabase/supabase-js`);
const { relayText } = require("./telegramRelay");
const { beat } = require("./heartbeat");

const ARGV = process.argv.slice(2);
const DRY = ARGV.includes("--dry");
const SUMMARY = ARGV.includes("--summary");
const FILE = ARGV.find((a) => /\.xlsx$/i.test(a));
const FOLDER = "/Users/mac/Library/CloudStorage/GoogleDrive-shong@harriotwatches.com/공유 드라이브/다운로드/페덱스청구";
const KV_KEY = "fedex_invoice_data";
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
const num = (s) => (s === undefined || s === null || s === "" ? 0 : Number(String(s).replace(/,/g, "")) || 0);
const won = (n) => Math.round(n).toLocaleString("en-US");
const MON = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
/** "06-Jan-2026" → "2026-01-06" */
const isoDate = (s) => { const m = String(s || "").match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/); return m ? `${m[3]}-${MON[m[2]]}-${m[1]}` : String(s || ""); };

/** Billing Online 엑셀 한 장 → 행 목록. 요금 항목은 "라벨·금액" 열이 50쌍 반복된다. */
function parseFile(file) {
  const wb = XLSX.readFile(file);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const A = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
  const H = A[0].map((h) => String(h).trim());
  const col = (name) => H.indexOf(name);
  const need = ["FedEx 청구서 번호", "청구서 유형", "청구 날짜", "항공운송장 번호", "항공운송장 총 금액", "발송 날짜"];
  const missing = need.filter((n) => col(n) < 0);
  if (missing.length) throw new Error(`엑셀 형식이 다르다 — 없는 열: ${missing.join(", ")}`);
  const firstLabel = H.indexOf("항공운송장 요금 라벨");
  const rows = [];
  for (const r of A.slice(1)) {
    const inv = String(r[col("FedEx 청구서 번호")] || "").trim(), awb = String(r[col("항공운송장 번호")] || "").trim();
    if (!inv || !awb) continue;
    const charges = {};
    for (let i = firstLabel; i >= 0 && i < H.length; i += 2) { const k = String(r[i] || "").trim(); if (k) charges[k] = (charges[k] || 0) + num(r[i + 1]); }
    const ship = String(r[col("발송 날짜")] || "");
    rows.push({
      inv, type: String(r[col("청구서 유형")] || "").trim(), invDate: isoDate(r[col("청구 날짜")]), due: isoDate(r[col("결제 기한")]),
      awb, payer: String(r[col("요금 청구 대상")] || "").trim(),
      ship: /^\d{8}$/.test(ship) ? `${ship.slice(0, 4)}-${ship.slice(4, 6)}-${ship.slice(6)}` : ship,
      svc: String(r[col("서비스")] || "").trim(),
      name: String(r[col("수취인 연락 담당자 이름")] || "").trim(), city: String(r[col("수취인 주소 시/군")] || "").trim(), cc: String(r[col("수취인 국가 주소 /지역")] || "").trim(),
      dim: `${r[col("길이")]}x${r[col("폭")]}x${r[col("높이")]}`, kg: num(r[col("산정 중량")]),
      total: num(r[col("항공운송장 총 금액")]), charges,
    });
  }
  return rows;
}

function summarize(rows) {
  const t = rows.filter((r) => r.type === "운송"), d = rows.filter((r) => r.type !== "운송");
  const byMonth = {};
  for (const r of t) { const k = r.ship.slice(0, 7); (byMonth[k] = byMonth[k] || []).push(r.total); }
  const lines = [];
  lines.push(`운송 ${t.length}건 ${won(t.reduce((s, r) => s + r.total, 0))}원 (평균 ${t.length ? won(t.reduce((s, r) => s + r.total, 0) / t.length) : 0}원)`);
  for (const k of Object.keys(byMonth).sort().slice(-4)) lines.push(`  ${k} 발송 ${byMonth[k].length}건 · ${won(byMonth[k].reduce((a, b) => a + b, 0))}원 · 평균 ${won(byMonth[k].reduce((a, b) => a + b, 0) / byMonth[k].length)}원`);
  lines.push(`관세/세금 ${d.length}건 ${won(d.reduce((s, r) => s + r.total, 0))}원`);
  return lines;
}

async function main() {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const kv = (await sb.from("kv_store").select("data").eq("key", KV_KEY).maybeSingle()).data;
  const state = (kv && kv.data) || { rows: {}, files: [] };
  state.rows = state.rows || {}; state.files = state.files || [];

  if (SUMMARY) { console.log(summarize(Object.values(state.rows)).join("\n")); console.log(`파일 ${state.files.length}개 · 마지막 청구일 ${Object.values(state.rows).map((r) => r.invDate).sort().pop() || "-"}`); return; }

  // 적재할 파일: 지정 파일 또는 폴더의 새 파일(이름·크기·수정시각으로 구분)
  let targets = [];
  if (FILE) targets = [path.resolve(FILE)];
  else if (fs.existsSync(FOLDER)) {
    const seen = new Set(state.files.map((f) => f.sig));
    for (const f of fs.readdirSync(FOLDER)) {
      if (!/\.xlsx$/i.test(f) || f.startsWith("~$")) continue;
      const st = fs.statSync(path.join(FOLDER, f));
      if (!seen.has(`${f}|${st.size}|${Math.floor(st.mtimeMs)}`)) targets.push(path.join(FOLDER, f));
    }
  } else log(`폴더 없음: ${FOLDER}`);

  const fresh = [];
  for (const file of targets) {
    let rows;
    try { rows = parseFile(file); }
    catch (e) {
      log(`읽기 실패 ${path.basename(file)}: ${e.message}`);
      if (!DRY && !FILE) await relayText(`🔴 페덱스 청구 엑셀을 읽지 못했습니다: ${path.basename(file)}\n${e.message}`);
      const st = fs.statSync(file); state.files.push({ sig: `${path.basename(file)}|${st.size}|${Math.floor(st.mtimeMs)}`, at: new Date().toISOString(), error: e.message });
      continue;
    }
    let added = 0;
    for (const r of rows) { const k = `${r.inv}|${r.awb}`; if (!state.rows[k]) { added++; fresh.push(r); } state.rows[k] = r; }
    const st = fs.statSync(file);
    state.files.push({ sig: `${path.basename(file)}|${st.size}|${Math.floor(st.mtimeMs)}`, at: new Date().toISOString(), rows: rows.length, added });
    log(`${path.basename(file)}: ${rows.length}행 중 새로 ${added}행`);
  }

  const all = Object.values(state.rows);
  const lastInv = all.map((r) => r.invDate).sort().pop() || "";
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  let msg = "";

  if (fresh.length) {
    const invs = [...new Map(fresh.map((r) => [r.inv, r])).values()].sort((a, b) => a.invDate.localeCompare(b.invDate));
    const duties = fresh.filter((r) => r.type !== "운송");
    msg = [
      `📦 페덱스 청구 내역 반영 — 새로 ${fresh.length}행 (청구서 ${invs.length}장, ${invs[0].invDate} ~ ${invs[invs.length - 1].invDate})`,
      ...summarize(fresh).map((l) => "· 이번 반영분 " + l),
      ...(duties.length ? ["관세/세금 청구:", ...duties.map((r) => `  ${r.invDate} ${r.name}(${r.cc}) ${won(r.total)}원 · AWB ${r.awb}`)] : []),
      "누계: " + summarize(all)[0],
    ].join("\n");
  } else if (!FILE && !targets.length) {
    // 알림: 8일·15일에, 이번 달에 발행된 청구서가 아직 한 건도 없으면(지난달 발송분 청구는 보통 1~8일에 나온다)
    const day = Number(today.slice(8)), month = today.slice(0, 7);
    if ((day === 8 || day === 15) && lastInv.slice(0, 7) < month && state.lastRemind !== today) {
      msg = `🧾 페덱스 청구 내역 갱신할 때입니다.\nBilling Online(fedex.com/online/billing)에서 청구 내역 엑셀을 내려받아 공유드라이브 「다운로드/페덱스청구」 폴더에 넣어 주세요. 넣으면 자동으로 반영하고 요약을 보내드립니다.\n(현재 데이터의 마지막 청구일 ${lastInv || "없음"})`;
      state.lastRemind = today;
    }
  }

  if (DRY) { if (msg) console.log("\n[드라이런] 텔레그램:\n" + msg); log(`드라이런 — 새 행 ${fresh.length} · 누계 ${all.length}`); return; }
  if (targets.length || msg) {
    state.files = state.files.slice(-60);
    const r = await sb.from("kv_store").upsert({ key: KV_KEY, data: state, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (r.error) throw new Error(`kv 저장 실패: ${r.error.message}`);
  }
  if (msg) await relayText(msg);
  if (!FILE) await beat("fedex-invoice-import", { files: targets.length, added: fresh.length, total: all.length, lastInv });
  log(`완료 — 새 행 ${fresh.length} · 누계 ${all.length} · 마지막 청구일 ${lastInv || "-"}`);
}

if (require.main !== module) { module.exports = { parseFile, summarize }; return; }
main().catch(async (e) => {
  log(`실패: ${(e && e.message) || e}`);
  if (!DRY) { try { await require("./notifyFail").notifyFail("페덱스 청구 내역 적재", (e && e.message) || String(e)); } catch { /* 무시 */ } }
  process.exitCode = 1;
});
