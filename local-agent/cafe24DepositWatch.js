/**
 * 카페24 무통장입금 자동 입금확인 — chat.db 우리은행 입금 SMS 감시.
 *
 * 흐름: chat.db(우리은행 입금알림, 커서 이후, 수신만) → 각 SMS 를
 *   POST /api/cafe24/bank-deposit-webhook (x-agent-token) 으로 전송.
 *   서버가 파싱→카페24 미결제 주문 매칭→HIGH(단건+이름일치)면 자동 입금확인→텔레그램.
 *
 * 멱등: 서버측 depositHash(은행+시각+금액+입금자) + 로컬 커서.
 * 필요: 전체 디스크 접근 권한(chat.db), .env 의 SUPABASE_*, PAULWISE_MCP_TOKEN, DASHBOARD_URL.
 *
 * 실행:  node cafe24DepositWatch.js          ← 1회(launchd StartInterval)
 *        node cafe24DepositWatch.js --reset   ← 커서 초기화
 *
 * 주의: 발신문자(사장님이 보낸 "…입금 부탁드립니다" AS 안내)는 is_from_me=0 필터로 제외.
 */
require("dotenv").config({ override: true });
const fs = require("fs"), path = require("path"), os = require("os");
const { execFile } = require("child_process");
const { DatabaseSync } = require("node:sqlite");
const { relayText } = require("./telegramRelay");
const DASH = path.resolve(__dirname, "..");
function le(p) { try { for (const l of fs.readFileSync(p, "utf8").split("\n")) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (!m) continue; let v = m[2].trim().replace(/^["']|["']$/g, ""); if (!(m[1] in process.env)) process.env[m[1]] = v; } } catch {} }
le(path.join(DASH, ".env.supabase")); le(path.join(DASH, ".env.local")); le(path.join(__dirname, ".env"));
const { createClient } = require(path.join(DASH, "node_modules/@supabase/supabase-js"));

const CHAT_DB = path.join(os.homedir(), "Library/Messages/chat.db");
const CURSOR_KEY = "cafe24_deposit_sms_cursor";
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

// chat.db 에서 커서 이후 우리은행 입금알림 SMS(수신만) 읽기. ns 는 2^53 초과라 TEXT 캐스팅.
function readNew(afterNs) {
  let cdb;
  try { cdb = new DatabaseSync(CHAT_DB, { readOnly: true }); }
  catch (e) { log(`chat.db 열기 실패(전체 디스크 접근 권한 확인): ${e && e.message}`); return null; }
  try {
    const rows = cdb.prepare(
      "SELECT CAST(date AS TEXT) AS ns, text FROM message " +
      "WHERE text IS NOT NULL AND is_from_me = 0 AND date > ? " +
      "AND text LIKE '%우리%' AND text LIKE '%입금%' AND text LIKE '%원%' " +
      "ORDER BY date ASC LIMIT 200"
    ).all(BigInt(afterNs));
    return rows;
  } catch (e) { log(`chat.db 쿼리 오류: ${e && e.message}`); return null; }
  finally { try { cdb.close(); } catch {} }
}

// 계좌 게이트 — 주문 결제 계좌(BANK_ACCOUNT_ORDERS)로 들어온 입금만 서버로 보낸다.
// 849(개인 계좌)에 입출금 알림을 켜면서 필요해졌다. 서버(Vercel)에도 같은 게이트가
// 있지만 거긴 env 주입·배포가 선행돼야 켜지므로, 여기서 먼저 끊어 개인 입금이
// 미결제 주문과 금액이 맞아 자동 입금확인되는 걸 막는다.
// 미설정이면 후방호환으로 전부 통과(기존 동작 유지).
const ORDER_ACCOUNTS = String(process.env.BANK_ACCOUNT_ORDERS || "")
  .split(",").map((s) => s.replace(/\D/g, "")).filter((s) => s.length >= 4);
function orderAccountAllowed(text) {
  if (!ORDER_ACCOUNTS.length) return true;        // 미설정 = 후방호환
  const m = String(text).match(/\*+\s*(\d{4,})/); // 우리은행 마스킹 "*097664"
  if (!m) return false;                           // 계좌 못 읽으면 자동처리 안 함
  const a = m[1];
  return ORDER_ACCOUNTS.some((c) => (a.length <= c.length ? c.endsWith(a) : a.endsWith(c)));
}

// 입금알림 형태만 1차 필터(발신 안내문/카드승인 등 노이즈 줄이기). 최종 파싱은 서버.
function looksLikeDeposit(text) {
  if (!/입금/.test(text)) return false;
  if (/부탁|바랍니다|드립니다|해주시면|해주세요/.test(text)) return false; // 발신 안내문 방어(이중)
  if (/승인|취소|할부|체크승인|일시불/.test(text)) return false;            // 카드 승인문자 제외
  return /입금\s*[\d,]+\s*원|[\d,]+\s*원\s*입금/.test(text);
}

async function sendToWebhook(text) {
  const r = await fetch(`${base()}/api/cafe24/bank-deposit-webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-agent-token": process.env.PAULWISE_MCP_TOKEN || "" },
    body: JSON.stringify({ sender: "우리", body: text }),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ok: r.ok, j };
}

// cafe24DepositConfirm.js 실행(브라우저 입금확인). 성공=stdout에 '입금확인 완료'.
function runConfirm(orderId, mall) {
  const args = [path.join(__dirname, "cafe24DepositConfirm.js"), orderId, "--confirm", "--mall", mall || "paulvice"];
  return new Promise((resolve) => {
    execFile(process.execPath, args,
      { cwd: __dirname, env: process.env, timeout: 5 * 60000 },
      (err, stdout, stderr) => resolve({ ok: !err && /입금확인 완료/.test(stdout || ""), out: ((stdout || "") + (stderr || "")).slice(-500) }));
  });
}

// 입금확인 큐(bank_deposit_confirm:*) 비우기 — 서버(webhook/크론)가 HIGH 매칭 시 적재한 주문을
// iMac에서 브라우저로 실제 '입금확인' 처리. 폴바이스+해리엇 모두(몰별 admin 크레덴셜).
async function drainConfirmQueue(db) {
  const { data } = await db.from("kv_store").select("key,data").like("key", "bank_deposit_confirm:%");
  const jobs = (data || []).map((r) => ({ key: r.key, ...(r.data || {}) })).filter((j) => j.orderId);
  if (!jobs.length) return;
  log(`입금확인 큐 ${jobs.length}건`);
  for (const j of jobs) {
    const won = Number(j.amount || 0).toLocaleString("ko-KR");
    const mall = j.mall || "paulvice";
    const tag = mall === "paulvice" ? "" : `[${mall}] `;
    log(`입금확인 실행: ${tag}${j.orderId} (${won}원 ${j.name || ""})`);
    const r = await runConfirm(j.orderId, mall);
    if (r.ok) {
      await db.from("kv_store").delete().eq("key", j.key);
      await relayText(`✅ 입금확인 완료 — ${tag}주문 ${j.orderId} (${won}원 ${j.name || ""}) 카페24 입금완료 처리`).catch(() => {});
      log("  ✅ 완료");
    } else {
      const attempts = (j.attempts || 0) + 1;
      if (attempts >= 3) {
        await db.from("kv_store").delete().eq("key", j.key);
        await relayText(`⚠️ 입금확인 자동 실패(3회) — ${tag}주문 ${j.orderId} (${won}원) 카페24에서 수동 확인 필요`).catch(() => {});
        log(`  ⚠️ 3회 실패 — 포기. ${r.out.slice(-150)}`);
      } else {
        const { key, ...rest } = j;
        await db.from("kv_store").upsert({ key, data: { ...rest, attempts }, updated_at: new Date().toISOString() }, { onConflict: "key" });
        log(`  재시도 예정(${attempts}/3)`);
      }
    }
  }
}

async function main() {
  const db = sb();
  if (process.argv.includes("--reset")) { await setCursor(db, "0"); log("커서 초기화됨(0)"); return; }

  const cursor = await getCursor(db);
  const rows = readNew(cursor);
  if (rows === null) return;            // 읽기 실패 — 커서 유지(다음에 재시도)
  if (!rows.length) {
    log("새 입금문자 없음");
    // SMS 없어도 입금확인 큐(크론 적재분)는 처리.
    try { await drainConfirmQueue(db); } catch (e) { log(`입금확인 큐 처리 오류: ${e && e.message}`); }
    return;
  }

  let advanced = cursor;
  let processed = 0, confirmed = 0;
  for (const row of rows) {
    if (!looksLikeDeposit(row.text)) {
      // 입금알림 아님(노이즈) — 처리 없이 커서만 전진.
      if (BigInt(row.ns) > BigInt(advanced)) advanced = row.ns;
      continue;
    }
    if (!orderAccountAllowed(row.text)) {
      // 개인 계좌 등 주문 결제 계좌 아님 — 주문 매칭 안 돌리고 커서만 전진.
      log(`주문 결제 계좌 아님 — 스킵: ${String(row.text).replace(/\n/g, " ").slice(0, 60)}`);
      if (BigInt(row.ns) > BigInt(advanced)) advanced = row.ns;
      continue;
    }
    let res;
    try { res = await sendToWebhook(row.text); }
    catch (e) { log(`전송 실패(커서 보존, 다음 재시도): ${e && e.message}`); break; }

    if (!res.ok) {
      // 401/503 등 설정 오류 → 커서 전진 금지(고치고 재시도).
      log(`웹훅 오류 ${res.status}: ${JSON.stringify(res.j).slice(0, 200)} — 커서 보존`);
      break;
    }
    processed++;
    if (res.j && res.j.confirmQueued) confirmed += 1;
    if (res.j) {
      const tag = res.j.duplicate ? "중복" : res.j.skipped ? "비입금" :
        (res.j.confirmQueued ? `자동확정 큐적재(${res.j.confirmQueued})` :
         res.j.matchError ? `매칭오류(${String(res.j.matchError).slice(0, 60)})` :
         res.j.matched ? `매칭 ${res.j.matched}건(수동)` : "매칭없음");
      log(`  · ${(row.text || "").replace(/\n/g, " ").slice(0, 40)} → ${tag}`);
    }
    if (BigInt(row.ns) > BigInt(advanced)) advanced = row.ns;
  }

  if (advanced !== cursor) await setCursor(db, advanced);
  log(`처리 ${processed}건 / 매칭큐적재 ${confirmed}건`);

  // 입금확인 큐 처리(브라우저) — SMS 없어도 매번 확인(크론 적재분 따라잡기).
  try { await drainConfirmQueue(db); } catch (e) { log(`입금확인 큐 처리 오류: ${e && e.message}`); }
}

main().catch((e) => { console.error("ERR", e); process.exit(1); });
