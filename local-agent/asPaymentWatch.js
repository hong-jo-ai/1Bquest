/**
 * AS 수리비 입금 자동확인 → 택배 자동접수.
 * 우리은행 입금알림 SMS(chat.db)를 읽어, 금액이 "비용안내완료(notified)" AS의 repair_cost와
 * 일치하면 → 우체국 송장 자동발급(registerSingle) → AS 발송완료 기록 → 텔레그램 알림.
 * 사장님은 수리비 청구문자 보내기 + 송장 인쇄·발송만 하면 됨.
 *
 * 매칭: 입금액 == repair_cost. 후보 1건 + 입금자명≈고객명 → 자동발송. 애매(0/복수/입금자불일치)면
 *       자동발급 안 하고 텔레그램으로 알림만(엉뚱한 주소로 실송장 발급 방지).
 *
 * 실행:  node asPaymentWatch.js          ← 1회 (launchd StartInterval)
 *        node asPaymentWatch.js --dry    ← 매칭만 출력(발급·기록·알림 안 함)
 *        node asPaymentWatch.js --reset  ← 커서 초기화
 */
require("dotenv").config({ override: true });
const fs = require("fs"), path = require("path"), os = require("os");
const { DatabaseSync } = require("node:sqlite");
const DASH = path.resolve(__dirname, "..");
function le(p) { try { for (const l of fs.readFileSync(p, "utf8").split("\n")) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (!m) continue; let v = m[2].trim().replace(/^["']|["']$/g, ""); if (!(m[1] in process.env)) process.env[m[1]] = v; } } catch {} }
le(path.join(DASH, ".env.supabase")); le(path.join(DASH, ".env.local")); le(path.join(__dirname, ".env"));
const { createClient } = require(path.join(DASH, "node_modules/@supabase/supabase-js"));
const { registerSingle } = require("./postParcel/register");

const DRY = process.argv.includes("--dry");
const CHAT_DB = path.join(os.homedir(), "Library/Messages/chat.db");
const CURSOR_KEY = "as_payment_sms_cursor";
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
const sb = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const norm = (s) => String(s || "").replace(/\s+/g, "");

async function tg(msg) {
  const t = process.env.TELEGRAM_BOT_TOKEN, c = process.env.TELEGRAM_CHAT_ID;
  if (!t || !c) return;
  await fetch(`https://api.telegram.org/bot${t}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: c, text: msg }) }).catch(() => {});
}

// 우리은행 입금알림 SMS 파싱 → { amount, depositor } | null
function parseDeposit(text) {
  if (!/우리/.test(text) || !/입금/.test(text)) return null;
  const am = text.match(/입금\s*([\d,]+)\s*원/);
  if (!am) return null;
  const amount = Number(am[1].replace(/,/g, ""));
  if (!(amount > 0)) return null;
  const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const di = lines.findIndex((l) => /입금\s*[\d,]+\s*원/.test(l));
  let depositor = "";
  for (let i = di + 1; i < lines.length; i++) {
    if (/잔액|출금|^\*\d|^우리\s|^\[|^\d{2}\/\d{2}/.test(lines[i])) continue;
    depositor = lines[i]; break;
  }
  return { amount, depositor };
}

function readNew(afterNs) {
  let cdb;
  try { cdb = new DatabaseSync(CHAT_DB, { readOnly: true }); }
  catch (e) { log(`chat.db 열기 실패(전체 디스크 접근 권한): ${e && e.message}`); return null; }
  try {
    return cdb.prepare(
      "SELECT CAST(date AS TEXT) AS ns, text FROM message " +
      "WHERE text IS NOT NULL AND date > ? AND text LIKE '%우리%' AND text LIKE '%입금%' AND text LIKE '%원%' " +
      "ORDER BY date ASC LIMIT 100"
    ).all(BigInt(afterNs));
  } catch (e) { log(`chat.db 쿼리 오류: ${e && e.message}`); return null; }
  finally { try { cdb.close(); } catch {} }
}

async function getCursor(db) { const { data } = await db.from("kv_store").select("data").eq("key", CURSOR_KEY).maybeSingle(); return (data && data.data && data.data.lastNs) ? String(data.data.lastNs) : "0"; }
async function setCursor(db, ns) { await db.from("kv_store").upsert({ key: CURSOR_KEY, data: { lastNs: String(ns), updatedAt: new Date().toISOString() }, updated_at: new Date().toISOString() }, { onConflict: "key" }); }

async function handleDeposit(db, dep) {
  // repair_cost == 입금액 인 "비용안내완료(notified)" AS 후보
  const { data: cands } = await db.from("as_requests")
    .select("id, as_number, customer_name, customer_phone, customer_address, model, repair_cost, status")
    .eq("status", "notified").eq("repair_cost", dep.amount);
  const list = cands || [];
  if (!list.length) { log(`  입금 ₩${dep.amount.toLocaleString()} (${dep.depositor}) — 매칭 AS 없음, 스킵`); return; }

  // 후보 1건 + 입금자명≈고객명 → 자동
  const nameOk = (as) => { const c = norm(as.customer_name), d = norm(dep.depositor); return c && d && (d.includes(c) || c.includes(d)); };
  let target = null;
  if (list.length === 1 && nameOk(list[0])) target = list[0];

  if (!target) {
    const reason = list.length > 1 ? `동일금액 AS ${list.length}건` : "입금자명 불일치";
    log(`  애매(${reason}) — 자동발송 보류, 알림만`);
    if (!DRY) await tg(`💰 입금 ₩${dep.amount.toLocaleString()} (입금자 ${dep.depositor})\nAS 수리비로 보이는데 ${reason}이라 자동발송 보류했어요.\nAS 페이지에서 확인 후 발송해주세요.${list.length ? "\n후보: " + list.map((a) => `${a.customer_name}(${a.as_number})`).join(", ") : ""}`);
    return;
  }

  if (DRY) { log(`  [dry] 매칭 → ${target.customer_name} AS#${target.as_number} 수리비 ₩${dep.amount.toLocaleString()} → 송장발급 예정`); return; }

  // 우체국 송장 발급
  try {
    const r = await registerSingle({
      order: `AS-${target.id}`, name: target.customer_name, addr: target.customer_address || "",
      zip: "", mobile: target.customer_phone || "", prod: target.model || "수리완료 제품", qty: "1", seller: "AS",
    }, { reqType: "1", source: "AS" });
    await db.from("as_requests").update({ status: "shipped", return_tracking_no: r.regiNo, shipped_at: new Date().toISOString() }).eq("id", target.id);
    log(`  ✅ ${target.customer_name} 입금확인+접수, 송장 ${r.regiNo}`);
    await tg(`✅ AS 입금확인 + 택배접수 완료!\n\n${target.customer_name}님 · 수리비 ₩${dep.amount.toLocaleString()} 입금\n→ 우체국 접수 송장 ${r.regiNo}${r.regipoNm ? ` (${r.regipoNm})` : ""}${r.skipped ? " (기존 송장)" : ""}\n\n송장 인쇄해서 발송하시면 끝입니다. (AS #${target.as_number})`);
  } catch (e) {
    log(`  송장발급 실패: ${e && e.message}`);
    await tg(`⚠️ ${target.customer_name}님 AS 입금은 확인됐는데 송장발급 실패: ${(e && e.message || "").slice(0, 120)}\nAS 페이지에서 수동 접수해주세요.`);
  }
}

async function main() {
  const db = sb();
  if (process.argv.includes("--reset")) { await setCursor(db, "0"); log("커서 초기화"); return; }
  const cursor = await getCursor(db);
  // 비용안내완료(notified) AS가 없으면 입금확인 불필요 — chat.db도 안 읽고 종료(유휴시 사실상 안 돎).
  const { count } = await db.from("as_requests").select("id", { count: "exact", head: true }).eq("status", "notified");
  if (!count) {
    // 유휴 기간 입금이 나중에 잘못 매칭되지 않게 커서만 최신으로 전진 후 종료.
    const idle = readNew(cursor);
    if (idle && idle.length) { let mx = cursor; for (const r of idle) if (BigInt(r.ns) > BigInt(mx)) mx = r.ns; if (!DRY) await setCursor(db, mx); }
    log("대기 중(비용안내완료) AS 없음 — 입금확인 스킵");
    return;
  }
  const rows = readNew(cursor);
  if (rows === null) return;
  if (!rows.length) { log("새 입금문자 없음(대기 AS 있음)"); return; }
  let maxNs = cursor;
  for (const row of rows) {
    if (BigInt(row.ns) > BigInt(maxNs)) maxNs = row.ns;
    const dep = parseDeposit(row.text);
    if (!dep) continue;
    log(`입금문자: ₩${dep.amount.toLocaleString()} / ${dep.depositor}`);
    await handleDeposit(db, dep);
  }
  if (!DRY) await setCursor(db, maxNs);
}

main().catch((e) => { console.error("ERR", e.message); process.exit(1); });
