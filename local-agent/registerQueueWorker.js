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
const DASH = "/Users/mac/sungjo_ai/paulwise-dashboard";
function loadEnv(p){ try { for(const l of fs.readFileSync(p,"utf8").split("\n")){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);if(!m)continue;let v=m[2].trim().replace(/^["']|["']$/g,"");if(!(m[1] in process.env))process.env[m[1]]=v;} } catch {} }
require("dotenv").config({ override: true });
loadEnv(path.join(DASH, ".env.supabase")); loadEnv(path.join(DASH, ".env.local"));
const { createClient } = require(path.join(DASH, "node_modules/@supabase/supabase-js"));
const { registerSingle, registerRows } = require("./postParcel/register");

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
  for (;;) {
    try { await tick(); } catch (e) { log("tick 예외: " + (e && e.message)); }
    await sleep(POLL_MS);
  }
})();
