/**
 * 우리카드 승인/취소 SMS 자동수집 (재무).
 * iMac Messages(chat.db)에서 우리카드 알림 문자를 읽어 대시보드 API로 보내 적재한다.
 * 엑셀 업로드를 대체 — 카드로 결제하면 지출내역이 알아서 쌓인다.
 *
 * 흐름: chat.db(우리카드 승인/취소, 커서 이후) → POST /api/finance/card-sms → 커서 전진.
 * 멱등: DB unique(business,source,approval_no,use_date) + approval_no=sms-<메시지ns>.
 * 필요: 전체 디스크 접근 권한(chat.db), .env의 SUPABASE_*, PAULWISE_MCP_TOKEN, DASHBOARD_URL.
 *
 * 실행:  node wooriCardSms.js          ← 1회 수집(launchd StartInterval)
 *        node wooriCardSms.js --reset  ← 커서 초기화(이후 전체 재스캔)
 */
require("dotenv").config({ override: true });
const fs = require("fs"), path = require("path"), os = require("os");
const { DatabaseSync } = require("node:sqlite");
const DASH = path.resolve(__dirname, "..");
function le(p) { try { for (const l of fs.readFileSync(p, "utf8").split("\n")) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (!m) continue; let v = m[2].trim().replace(/^["']|["']$/g, ""); if (!(m[1] in process.env)) process.env[m[1]] = v; } } catch {} }
le(path.join(DASH, ".env.supabase")); le(path.join(DASH, ".env.local")); le(path.join(__dirname, ".env"));
const { createClient } = require(path.join(DASH, "node_modules/@supabase/supabase-js"));

const CHAT_DB = path.join(os.homedir(), "Library/Messages/chat.db");
const APPLE_EPOCH_MS = 978307200000; // 2001-01-01 → unix ms
const CURSOR_KEY = "woori_card_sms_cursor";
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

// chat.db에서 커서 이후 우리카드 승인/취소 SMS 읽기 (ns는 2^53 초과라 TEXT로 캐스팅).
function readNew(afterNs) {
  let cdb;
  try { cdb = new DatabaseSync(CHAT_DB, { readOnly: true }); }
  catch (e) { log(`chat.db 열기 실패(전체 디스크 접근 권한 확인): ${e && e.message}`); return null; }
  try {
    const rows = cdb.prepare(
      "SELECT CAST(date AS TEXT) AS ns, text FROM message " +
      "WHERE text IS NOT NULL AND date > ? " +
      "AND (text LIKE '%우리(%' OR text LIKE '%우리카드%') " +
      "AND (text LIKE '%승인%' OR text LIKE '%취소%') " +
      "ORDER BY date ASC LIMIT 200"
    ).all(BigInt(afterNs));
    return rows;
  } catch (e) { log(`chat.db 쿼리 오류: ${e && e.message}`); return null; }
  finally { try { cdb.close(); } catch {} }
}

// 네이버페이 메일로 "네이버파이낸셜" 카드내역 보강 트리거(서버가 Gmail 읽고 매칭).
async function enrichNpay() {
  try {
    const r = await fetch(`${base()}/api/finance/enrich-npay`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-agent-token": process.env.PAULWISE_MCP_TOKEN || "" },
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && (j.candidates || j.enriched)) log(`네이버페이 보강: 대상 ${j.candidates} → 보강 ${j.enriched} (메일 ${j.emails})`);
  } catch (e) { log(`네이버페이 보강 호출 실패: ${e && e.message}`); }
}

async function main() {
  if (process.argv.includes("--reset")) { await setCursor(sb(), "0"); log("커서 초기화됨(0)"); return; }
  const db = sb();
  const cursor = await getCursor(db);
  const rows = readNew(cursor);
  if (rows === null) return; // 읽기 실패
  if (!rows.length) { log("새 우리카드 문자 없음"); await enrichNpay(); return; }

  const messages = rows.map((r) => ({
    text: r.text,
    id: r.ns, // Apple ns 문자열 = 메시지 고유 → 승인번호 대용
    receivedAtMs: Math.round(Number(BigInt(r.ns) / 1000000n) + APPLE_EPOCH_MS),
  }));
  const maxNs = rows.reduce((mx, r) => (BigInt(r.ns) > BigInt(mx) ? r.ns : mx), cursor);

  let res;
  try {
    const r = await fetch(`${base()}/api/finance/card-sms`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-agent-token": process.env.PAULWISE_MCP_TOKEN || "" },
      body: JSON.stringify({ messages }),
    });
    res = await r.json();
    if (!r.ok) { log(`API 오류 ${r.status}: ${JSON.stringify(res).slice(0, 200)}`); return; }
  } catch (e) { log(`전송 실패: ${e && e.message}`); return; }

  await setCursor(db, maxNs);
  log(`수집 ${messages.length}건 → 적재 ${res.inserted ?? 0} / 중복 ${res.skipped ?? 0} / 비카드 ${res.nonCard ?? 0}`);
  if (res.preview && res.preview.length) {
    for (const p of res.preview.slice(0, 10)) log(`  · ${p.merchant} ${Number(p.amount).toLocaleString()}원 [${p.category}]${p.cancel ? " (취소)" : ""}`);
  }
  await enrichNpay();
}

main().catch((e) => { console.error("ERR", e); process.exit(1); });
