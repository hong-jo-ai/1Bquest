/**
 * 우체국 접수 큐 워커 (iMac 상시 기동, launchd KeepAlive).
 *
 * 배포(Vercel) 사이트는 접수 API 라우트에서 kv_store 에 'pp_register_job:<id>'(status=pending)만
 * 적재한다(서버리스는 보안키+계약IP가 없어 직접 접수 불가). 이 워커가 kv 를 폴링해 실제 접수
 * (postParcel/register 의 registerSingle/registerRows — SEED 암호화·계약 IP는 여기 로컬)하고
 * 결과를 같은 row 에 done/error 로 기록한다. 에이전트(7777)·브라우저 불필요 — 우체국 API 만.
 *
 * 실행: node registerQueueWorker.js   (launchd com.paulvice.register-queue 가 상시 유지)
 */
const fs = require("fs"), path = require("path");
const { execFile } = require("child_process");
const DASH = "/Users/mac/sungjo_ai/paulwise-dashboard";
function loadEnv(p){ try { for(const l of fs.readFileSync(p,"utf8").split("\n")){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);if(!m)continue;let v=m[2].trim().replace(/^["']|["']$/g,"");if(!(m[1] in process.env))process.env[m[1]]=v;} } catch {} }
require("dotenv").config({ override: true });
loadEnv(path.join(DASH, ".env.supabase")); loadEnv(path.join(DASH, ".env.local"));
const { createClient } = require(path.join(DASH, "node_modules/@supabase/supabase-js"));
const { registerSingle, registerRows, registerOutbound, registerReturn, cancelShipment } = require("./postParcel/register");

const PREFIX = "pp_register_job:";
const POLL_MS = 4000;
const CLEANUP_MS = 30 * 60 * 1000; // done/error 30분 지나면 삭제
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function writeJob(job, patch) {
  const next = { ...job, ...patch, updatedAt: new Date().toISOString() };
  await sb.from("kv_store").upsert({ key: PREFIX + job.id, data: next, updated_at: next.updatedAt }, { onConflict: "key" });
  return next;
}

async function processJob(job) {
  log(`접수 처리 [${job.kind}] ${job.id}`);
  try {
    let result;
    if (job.kind === "one") {
      const { reqType, source, ...order } = job.payload || {};
      result = await registerSingle(order, { reqType, source });
    } else if (job.kind === "batch") {
      result = await registerRows((job.payload && job.payload.rows) || []);
    } else if (job.kind === "outbound") {
      result = await registerOutbound(job.payload || {});
    } else if (job.kind === "return") {
      result = await registerReturn(job.payload || {});
    } else if (job.kind === "cancel") {
      // 발송취소 — 우체국 송장 취소(과금방지). payload: { order_number, channel, req_type }
      result = await cancelShipment(job.payload || {});
    } else {
      throw new Error(`알 수 없는 kind: ${job.kind}`);
    }
    await writeJob(job, { status: "done", result, error: null });
    log(`  ✅ done ${job.id} → ${JSON.stringify(result).slice(0, 160)}`);
  } catch (e) {
    await writeJob(job, { status: "error", error: e && e.message ? e.message : String(e) });
    log(`  ❌ error ${job.id}: ${e && e.message}`);
  }
}

/**
 * 접수 직후 스마트스토어 발송처리 — "이미 나갔는데 고객은 취소할 수 있는" 창을 닫는다.
 *
 * 네이버는 판매자가 발송처리를 하기 전까지 구매자가 즉시 취소할 수 있다. 우리는 오전에 우체국
 * 접수(=실제 출고)를 하고 발송처리는 dispatch17(17:10)에 몰아서 했기 때문에, 그 사이 몇 시간은
 * 물건이 나간 뒤에도 취소가 가능했다. 2026-09-14 실제로 그 구간에서 취소가 들어와 설월 1개가
 * 헛나갔다(고객이 재주문해 2개 수령 → 착불 반송). 반송이 안 왔으면 34.9만원 손실이었다.
 *
 * 접수가 곧 실출고인 스마트스토어는 발송처리를 늦출 이유가 없으므로 접수 직후 바로 올린다.
 * smartstoreDispatch.js 는 멱등(PAYED 만 대상, DELIVERING 이상은 스킵)이라 중복 실행이 안전하다.
 * dispatch17 의 호출은 그대로 둔다 — 이 경로가 실패해도 오후에 한 번 더 잡힌다(이중 안전망).
 */
let lastSsDispatch = 0;
const SS_DISPATCH_COOLDOWN_MS = 5 * 60 * 1000;
async function dispatchSmartstoreIfNeeded() {
  if (Date.now() - lastSsDispatch < SS_DISPATCH_COOLDOWN_MS) return;
  // 방금 접수된 스마트스토어 건이 있을 때만 — 없으면 네이버 API 를 괜히 두드리지 않는다.
  const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { data, error } = await sb
    .from("pp_shipments")
    .select("id")
    .eq("channel", "스마트스토어").eq("req_type", "1").eq("status", "submitted")
    .gte("registered_at", since)
    .limit(1);
  if (error || !data || !data.length) return;
  lastSsDispatch = Date.now();
  log("스마트스토어 접수 감지 → 발송처리 실행(취소 창 닫기)");
  await new Promise((resolve) => {
    execFile(process.execPath, [path.join(__dirname, "smartstoreDispatch.js")], { cwd: __dirname, timeout: 180000 }, (err, stdout, stderr) => {
      const tail = String(stdout || "").trim().split("\n").slice(-3).join(" | ");
      if (err) log(`  ⚠️ 스마트스토어 발송처리 실패(17시에 재시도됨): ${err.message} ${String(stderr || "").slice(0, 200)}`);
      else log(`  ✅ 스마트스토어 발송처리: ${tail}`);
      resolve();
    });
  });
}

async function tick() {
  const { data, error } = await sb.from("kv_store").select("key,data").like("key", PREFIX + "%");
  if (error) { log("kv 조회 실패: " + error.message); return; }
  const jobs = (data || []).map((r) => r.data).filter(Boolean);
  const pending = jobs.filter((j) => j.status === "pending").sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  for (const job of pending) {
    // 선점: processing 으로 표시 후 처리 (중복 처리 방지)
    await writeJob(job, { status: "processing" });
    await processJob(job);
  }
  // 접수가 있었으면 스마트스토어 발송처리를 바로 올린다(실패해도 접수 결과엔 영향 없음).
  if (pending.length) {
    try { await dispatchSmartstoreIfNeeded(); }
    catch (e) { log("스마트스토어 발송처리 호출 예외(무시): " + (e && e.message)); }
  }
  // 오래된 완료/실패 job 정리
  const now = Date.now();
  for (const j of jobs) {
    if ((j.status === "done" || j.status === "error") && now - new Date(j.updatedAt).getTime() > CLEANUP_MS) {
      await sb.from("kv_store").delete().eq("key", PREFIX + j.id);
    }
  }
}

(async () => {
  log(`우체국 접수 큐 워커 시작 (poll ${POLL_MS}ms, test=${(process.env.POSTPARCEL_TEST_YN ?? "Y").toUpperCase()})`);
  let failStreak = 0, lastBeat = 0;
  // 코드가 바뀌면 스스로 내려가 새 코드로 다시 뜬다(9/17 CS 액션 워커가 옛 코드로 돈 사고).
  const exitIfCodeChanged = require("./codeReload").makeCodeReloadCheck(log);
  for (;;) {
    exitIfCodeChanged(); // 작업을 잡기 전에만 — 접수 도중 끊기지 않게
    try { await tick(); failStreak = 0; }
    catch (e) {
      log("tick 예외: " + (e && e.message));
      failStreak++;
      if (failStreak === 5) { try { await require("./notifyFail").notifyFail("우체국 접수큐 워커 연속 실패", e && e.message ? e.message : String(e)); } catch (_) {} }
    }
    // 생존 하트비트(5분 스로틀) — watchdog 이 프로세스 사망 감지
    if (Date.now() - lastBeat > 5 * 60 * 1000) { lastBeat = Date.now(); await require("./heartbeat").beat("register-queue-worker"); }
    await sleep(POLL_MS);
  }
})();
