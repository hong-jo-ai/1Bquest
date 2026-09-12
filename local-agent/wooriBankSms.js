/**
 * 우리은행 입출금 알림 SMS 자동수집 (재무·통장).
 * iMac Messages(chat.db)에서 우리은행 알림 문자를 읽어 대시보드 API(/api/finance/bank-sms)로 보낸다.
 * 통장 엑셀 업로드를 대체 — 2026-08-18 이후 업로드가 끊겨 통장이 비어 있었다(2026-09-12 신설).
 *
 * 흐름: chat.db(우리 입금/출금/출금취소, 커서 이후) → POST /api/finance/bank-sms → 커서 전진.
 * 멱등: 서버가 unique(사업자·시각·출금·입금·잔액)로 막는다 + 커서.
 * 필요: 전체 디스크 접근 권한(chat.db), .env의 SUPABASE_*, PAULWISE_MCP_TOKEN, DASHBOARD_URL.
 *
 * 실행:  node wooriBankSms.js                       ← 1회 수집(launchd StartInterval 5분)
 *        node wooriBankSms.js --since 2026-08-18T11:08:00+09:00   ← 그 시각 이후 되채우기(커서 이동)
 *        node wooriBankSms.js --reset                 ← 커서 초기화(전체 재스캔)
 */
require("dotenv").config({ override: true });
const fs = require("fs"), path = require("path"), os = require("os");
const { DatabaseSync } = require("node:sqlite");
const { messageBody, bodyLike } = require("./chatDbText");
const DASH = path.resolve(__dirname, "..");
function le(p) { try { for (const l of fs.readFileSync(p, "utf8").split("\n")) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (!m) continue; const v = m[2].trim().replace(/^["']|["']$/g, ""); if (!(m[1] in process.env)) process.env[m[1]] = v; } } catch {} }
le(path.join(DASH, ".env.supabase")); le(path.join(DASH, ".env.local")); le(path.join(__dirname, ".env"));
const { createClient } = require(path.join(DASH, "node_modules/@supabase/supabase-js"));
const { beat } = require("./heartbeat");

const CHAT_DB = path.join(os.homedir(), "Library/Messages/chat.db");
const APPLE_EPOCH_MS = 978307200000; // 2001-01-01 → unix ms
const CURSOR_KEY = "woori_bank_sms_cursor";
const JOB = "woori-bank-sms";
const PAGE = 300;
const base = () => (process.env.DASHBOARD_URL || "https://paulvice-dashboard.vercel.app").replace(/\/$/, "");
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
const sb = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function getCursor(db) {
  const { data } = await db.from("kv_store").select("data").eq("key", CURSOR_KEY).maybeSingle();
  return (data && data.data && data.data.lastNs) ? String(data.data.lastNs) : "0";
}
async function setCursor(db, ns) {
  await db.from("kv_store").upsert({ key: CURSOR_KEY, data: { lastNs: String(ns), updatedAt: new Date().toISOString() }, updated_at: new Date().toISOString() }, { onConflict: "key" });
}
/** ISO 시각 → chat.db 의 Apple epoch ns 문자열 */
function isoToNs(iso) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) throw new Error(`--since 시각을 못 읽음: ${iso}`);
  return (BigInt(ms - APPLE_EPOCH_MS) * 1000000n).toString();
}

// chat.db에서 커서 이후 우리은행 입출금 문자 읽기 (ns는 2^53 초과라 TEXT로 캐스팅).
function readNew(afterNs) {
  let cdb;
  try { cdb = new DatabaseSync(CHAT_DB, { readOnly: true }); }
  catch (e) { log(`chat.db 열기 실패(전체 디스크 접근 권한 확인): ${e && e.message}`); return null; }
  try {
    const rows = cdb.prepare(
      // ⚠️ text 만 보면 안 된다 — macOS 가 본문을 attributedBody 로 옮겼다(chatDbText.js 참고).
      "SELECT CAST(date AS TEXT) AS ns, text, attributedBody FROM message " +
      "WHERE date > ? " +
      `AND ${bodyLike("우리 ")} AND ${bodyLike("잔액")} ` +
      `AND (${bodyLike("출금")} OR ${bodyLike("입금")}) ` +
      `ORDER BY date ASC LIMIT ${PAGE}`
    ).all(BigInt(afterNs));
    return rows.map((r) => ({ ns: r.ns, text: messageBody(r) })).filter((r) => r.text);
  } catch (e) { log(`chat.db 쿼리 오류: ${e && e.message}`); return null; }
  finally { try { cdb.close(); } catch {} }
}

async function send(messages) {
  const r = await fetch(`${base()}/api/finance/bank-sms`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-agent-token": process.env.PAULWISE_MCP_TOKEN || "" },
    // --no-ask: 되채우기용. 현대카드 결제를 가맹점 미상으로 적재만 하고 텔레그램 문의는 보내지 않는다.
    body: JSON.stringify({ messages, ask: !process.argv.includes("--no-ask") }),
    signal: AbortSignal.timeout(50000),
  });
  const res = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`API 오류 ${r.status}: ${JSON.stringify(res).slice(0, 200)}`);
  return res;
}

async function main() {
  const db = sb();
  const sinceIdx = process.argv.indexOf("--since");
  if (process.argv.includes("--reset")) { await setCursor(db, "0"); log("커서 초기화됨(0)"); return; }
  if (sinceIdx > 0) { const ns = isoToNs(process.argv[sinceIdx + 1]); await setCursor(db, ns); log(`커서를 ${process.argv[sinceIdx + 1]} (ns ${ns}) 로 이동 — 이후 문자부터 수집`); }

  let cursor = await getCursor(db);
  let total = 0, inserted = 0, skipped = 0, nonBank = 0, asked = 0, pages = 0;
  // 되채우기처럼 한 번에 수백 건이면 여러 페이지를 돈다. 페이지마다 커서를 전진시켜 중간 실패에도 재개 가능.
  while (pages < 20) {
    const rows = readNew(cursor);
    if (rows === null) return; // 읽기 실패 — 커서 유지
    if (!rows.length) break;
    const messages = rows.map((r) => ({
      text: r.text,
      id: r.ns, // Apple ns 문자열 = 메시지 고유
      receivedAtMs: Math.round(Number(BigInt(r.ns) / 1000000n) + APPLE_EPOCH_MS),
    }));
    const maxNs = rows.reduce((mx, r) => (BigInt(r.ns) > BigInt(mx) ? r.ns : mx), cursor);
    const res = await send(messages);
    await setCursor(db, maxNs);
    cursor = maxNs; pages++;
    total += messages.length; inserted += res.inserted || 0; skipped += res.skipped || 0; nonBank += res.nonBank || 0; asked += res.asked || 0;
    log(`페이지 ${pages}: 수집 ${messages.length} → 적재 ${res.inserted ?? 0} / 중복 ${res.skipped ?? 0} / 비통장 ${res.nonBank ?? 0}${res.hyundaiCards ? ` / 현대카드 ${res.hyundaiCards}(문의 ${res.asked ?? 0})` : ""}`);
    for (const p of (res.preview || []).slice(0, 8)) log(`  · ${p.at} ${p.acct} ${p.kind} ${Number(p.amount).toLocaleString()}원 ${p.counterparty} [${p.category}]`);
    if (rows.length < PAGE) break;
  }
  if (!total) log("새 우리은행 문자 없음");
  else log(`합계: 수집 ${total} → 적재 ${inserted} / 중복 ${skipped} / 비통장 ${nonBank} / 현대카드 문의 ${asked}`);
  await beat(JOB, { collected: total, inserted });
}

main().catch(async (e) => {
  console.error("ERR", e);
  try { await require("./notifyFail").notifyFail("우리은행 SMS 수집", e && e.message ? e.message : String(e)); } catch (_) {}
  process.exit(1);
});
