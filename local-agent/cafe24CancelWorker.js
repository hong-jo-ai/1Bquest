/**
 * 카페24 주문취소 큐 워커 (iMac 상시 기동, launchd KeepAlive).
 *
 * 배포(Vercel) 텔레그램 웹훅이 "주문취소 <번호>" + 예/아니오 확인게이트를 거쳐 kv_store
 * 'cafe24_cancel_job:<id>'(status=pending)에 적재한다(서버리스는 취소/환불 API 권한이 없어 직접 불가).
 * 이 워커가 폴링해 cafe24CancelOrder.js(브라우저 자동화)로 실제 취소 + 카드 승인취소를 실행하고,
 * 카페24 주문조회 API로 검증(canceled:T, payment_amount:0)한 뒤 같은 row 에 done/error 기록 + 텔레그램 보고.
 *
 * 실행: node cafe24CancelWorker.js   (launchd com.paulvice.cafe24-cancel-queue 가 상시 유지)
 */
const fs = require("fs"), path = require("path");
const { execFile } = require("child_process");
const DASH = "/Users/mac/sungjo_ai/paulwise-dashboard";
function loadEnv(p){ try { for(const l of fs.readFileSync(p,"utf8").split("\n")){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);if(!m)continue;let v=m[2].trim().replace(/^["']|["']$/g,"");if(!(m[1] in process.env))process.env[m[1]]=v;} } catch {} }
require("dotenv").config({ override: true });
loadEnv(path.join(DASH, ".env.supabase")); loadEnv(path.join(DASH, ".env.local"));
const { createClient } = require(path.join(DASH, "node_modules/@supabase/supabase-js"));

const PREFIX = "cafe24_cancel_job:";
const POLL_MS = 8000;
const CLEANUP_MS = 30 * 60 * 1000;
const MALL = process.env.CAFE24_MALL_ID || "icaruse2000";
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tg(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
  } catch {}
}

async function writeJob(job, patch) {
  const next = { ...job, ...patch, updatedAt: new Date().toISOString() };
  await sb.from("kv_store").upsert({ key: PREFIX + job.id, data: next, updated_at: next.updatedAt }, { onConflict: "key" });
  return next;
}

function runCancelScript(orderId, reason, brand) {
  const args = [path.join(__dirname, "cafe24CancelOrder.js"), orderId, "--confirm", "--reason", reason || "A"];
  if (brand === "harriot") args.push("--brand", "harriot");
  return new Promise((resolve) => {
    execFile("node", args,
      { cwd: __dirname, timeout: 180000, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => resolve({ ok: !err, stdout: stdout || "", stderr: (stderr || "") + (err ? "\n" + err.message : "") }));
  });
}

// 카페24 주문조회 API 로 취소 반영 검증(읽기 전용 — 만료 임박이면 스킵). brand 별 몰/토큰.
async function verifyCanceled(orderId, brand) {
  const tokenKey = brand === "harriot" ? "cafe24_refresh_token:harriot" : "cafe24_refresh_token";
  const mall = brand === "harriot" ? (process.env.HARRIOT_CAFE24_MALL_ID || "harriotkorea") : MALL;
  const { data: row } = await sb.from("kv_store").select("data").eq("key", tokenKey).maybeSingle();
  const tok = row && row.data;
  if (!tok || !tok.access_token || (tok.expires_at && tok.expires_at < Date.now() + 90000)) return { checked: false };
  try {
    const r = await fetch(`https://${mall}.cafe24api.com/api/v2/admin/orders/${orderId}?embed=items`,
      { headers: { Authorization: "Bearer " + tok.access_token, "X-Cafe24-Api-Version": "2026-03-01" } });
    const o = (await r.json()).order || {};
    return { checked: true, canceled: o.canceled === "T", amount: Number(o.payment_amount ?? -1) };
  } catch { return { checked: false }; }
}

async function processJob(job) {
  const brand = job.brand || "paulvice";
  log(`취소 처리 ${job.id} (${brand} 주문 ${job.orderId}, 사유 ${job.reason})`);
  await tg(`⏳ ${brand === "harriot" ? "해리엇" : "폴바이스"} 주문 ${job.orderId} 취소 처리 시작…`);
  try {
    const run = await runCancelScript(job.orderId, job.reason, brand);
    await sleep(2000);
    const v = await verifyCanceled(job.orderId, brand);
    if (v.checked && v.canceled) {
      await writeJob(job, { status: "done", result: { canceled: true, amount: v.amount }, error: null });
      await tg(`✅ 주문 <b>${job.orderId}</b> 취소 완료 (카드 승인취소, 결제금액 ${v.amount}원). 사유 ${job.reason}.`);
      log(`  ✅ done ${job.id}`);
    } else if (v.checked && !v.canceled) {
      await writeJob(job, { status: "error", error: "스크립트 실행됐으나 canceled!=T (취소 미반영)" });
      await tg(`⚠️ 주문 ${job.orderId} 취소가 확인되지 않았어요(미반영). 관리자에서 확인 필요. 로그 tail:\n${run.stderr.slice(-300)}`);
      log(`  ❌ not canceled ${job.id}`);
    } else {
      // 검증 불가(토큰 만료 등) — 스크립트 종료코드로 판단
      const okGuess = run.ok && /취소 제출 완료/.test(run.stdout);
      await writeJob(job, { status: okGuess ? "done" : "error", result: { verified: false }, error: okGuess ? null : "검증 불가 + 스크립트 실패" });
      await tg(`${okGuess ? "✅" : "⚠️"} 주문 ${job.orderId} 취소 ${okGuess ? "제출됨(API검증 보류)" : "실패 가능"}. API 검증을 못 했어요(토큰). 직접 확인 권장.`);
    }
  } catch (e) {
    await writeJob(job, { status: "error", error: e && e.message ? e.message : String(e) });
    await tg(`❌ 주문 ${job.orderId} 취소 처리 중 오류: ${e && e.message}`);
    log(`  ❌ error ${job.id}: ${e && e.message}`);
  }
}

async function tick() {
  const { data, error } = await sb.from("kv_store").select("key,data").like("key", PREFIX + "%");
  if (error) { log("kv 조회 실패: " + error.message); return; }
  const jobs = (data || []).map((r) => r.data).filter(Boolean);
  const pending = jobs.filter((j) => j.status === "pending").sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  for (const job of pending) {
    await writeJob(job, { status: "processing" }); // 선점(중복 방지)
    await processJob(job);
  }
  const now = Date.now();
  for (const j of jobs) {
    if ((j.status === "done" || j.status === "error") && now - new Date(j.updatedAt).getTime() > CLEANUP_MS) {
      await sb.from("kv_store").delete().eq("key", PREFIX + j.id);
    }
  }
}

(async () => {
  log(`카페24 주문취소 큐 워커 시작 (poll ${POLL_MS}ms, mall ${MALL})`);
  for (;;) {
    try { await tick(); } catch (e) { log("tick 예외: " + (e && e.message)); }
    await sleep(POLL_MS);
  }
})();
