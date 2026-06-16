/**
 * on-demand 동기화 트리거 워처 (아이맥 상주).
 *
 * 배포 서버의 /api/marketplace/sync-request 를 30초마다 폴링.
 * 사장님이 텔레그램에 "W컨셉 동기화"/"무신사 동기화" 보내면 webhook이 요청을 기록하고,
 * 여기서 새 요청(ts 증가)을 감지해 해당 채널 동기화 스크립트를 실행한다.
 * (배포 서버는 아이맥 로컬에 직접 못 닿으므로 아이맥이 폴링하는 구조)
 */
require("dotenv").config({ override: true });
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const BASE = (process.env.DASHBOARD_URL || "https://paulvice-dashboard.vercel.app").replace(/\/$/, "");
const TOKEN = process.env.PAULWISE_MCP_TOKEN || "";
const STATE = path.join(os.homedir(), ".paulvice-marketplace-agent", "last_sync_request.txt");
const POLL_MS = 30000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function lastTs() { try { return fs.readFileSync(STATE, "utf8").trim(); } catch { return ""; } }
function setLast(ts) { fs.mkdirSync(path.dirname(STATE), { recursive: true }); fs.writeFileSync(STATE, ts); }
function lastPark() { try { return fs.readFileSync(PARK_STATE, "utf8").trim(); } catch { return ""; } }
function setLastPark(ts) { fs.mkdirSync(path.dirname(PARK_STATE), { recursive: true }); fs.writeFileSync(PARK_STATE, ts); }

async function fetchRequest() {
  const r = await fetch(`${BASE}/api/marketplace/sync-request`, { headers: { "x-agent-token": TOKEN } });
  return r.json().catch(() => ({}));
}

async function fetchParking() {
  const r = await fetch(`${BASE}/api/parking/request`, { headers: { "x-agent-token": TOKEN } });
  return r.json().catch(() => ({}));
}

async function tg(msg) {
  const t = process.env.TELEGRAM_BOT_TOKEN, c = process.env.TELEGRAM_CHAT_ID;
  if (!t || !c) return;
  await fetch(`https://api.telegram.org/bot${t}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: c, text: msg }) }).catch(() => {});
}

// 주차 2시간 할인 등록 실행 + 결과 텔레그램 회신
function runParking(carNo) {
  return new Promise((resolve) => {
    console.log(`[${new Date().toISOString()}] ▶ 주차등록 ${carNo}`);
    let out = "";
    const cp = execFile(process.execPath, [path.join(__dirname, "parkingRegister.js"), carNo], { cwd: __dirname, env: process.env });
    cp.stdout && cp.stdout.on("data", (d) => { out += d; process.stdout.write(d); });
    cp.stderr && cp.stderr.on("data", (d) => process.stderr.write(d));
    cp.on("close", async () => {
      const m = out.match(/RESULT=(\{.*\})/);
      let r = {}; try { r = JSON.parse(m[1]); } catch {}
      if (r.ok && r.already) await tg(`🅿️ 차량 ${carNo} — 이미 2시간 할인이 적용돼 있어요.`);
      else if (r.ok) await tg(`✅ 차량 ${carNo} 2시간 할인권 등록 완료!`);
      else await tg(`⚠️ 차량 ${carNo} 주차할인 등록 실패: ${r.error || "확인 필요"}`);
      console.log(`[${new Date().toISOString()}] ◀ 주차등록 ${carNo} 완료`);
      resolve();
    });
  });
}

function runSync(channel) {
  return new Promise((resolve) => {
    const script = channel === "wconcept" ? "runWconceptSync.js"
      : channel === "29cm" ? "runCm29Sync.js"
      : channel === "sixshop" ? "runSixshopSync.js"
      : channel === "dutyfree" ? "dutyFreeProcess.js"
      : channel === "musinsa" ? "runMusinsaSync.js"
      : channel === "wconcept_ads" ? "wconceptAdsSync.js"
      : channel === "tax_invoice" ? "taxInvoiceSync.js"
      : null;
    if (!script) { console.log(`[${new Date().toISOString()}] 알 수 없는 channel: ${channel} — 스킵`); return resolve(); }
    console.log(`[${new Date().toISOString()}] ▶ ${channel} 실행 (${script})`);
    const cp = execFile(process.execPath, [path.join(__dirname, script)], { cwd: __dirname, env: process.env });
    cp.stdout && cp.stdout.on("data", (d) => process.stdout.write(d));
    cp.stderr && cp.stderr.on("data", (d) => process.stderr.write(d));
    cp.on("close", (code) => { console.log(`[${new Date().toISOString()}] ◀ ${channel} 종료 (code ${code})`); resolve(); });
  });
}

(async () => {
  console.log(`[${new Date().toISOString()}] triggerWatcher 시작 (poll ${POLL_MS / 1000}s, base ${BASE})`);
  // 시작 시 현재 요청을 기준선으로 (과거 요청 무시)
  if (!lastTs()) {
    try { const j = await fetchRequest(); if (j && j.ts) { setLast(j.ts); console.log("기준선 설정:", j.ts); } } catch { /* ignore */ }
  }
  if (!lastPark()) {
    try { const p = await fetchParking(); if (p && p.ts) { setLastPark(p.ts); console.log("주차 기준선 설정:", p.ts); } } catch { /* ignore */ }
  }
  // 무한 폴링
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const j = await fetchRequest();
      if (j && j.ts && j.channel && j.ts > lastTs()) {
        console.log(`[${new Date().toISOString()}] 새 요청 감지: ${j.channel} @ ${j.ts}`);
        setLast(j.ts);
        await runSync(j.channel);
      }
      const p = await fetchParking();
      if (p && p.ts && p.carNo && p.ts > lastPark()) {
        console.log(`[${new Date().toISOString()}] 새 주차요청 감지: ${p.carNo} @ ${p.ts}`);
        setLastPark(p.ts);
        await runParking(p.carNo);
      }
    } catch (e) {
      // 네트워크 일시 오류는 무시하고 계속
    }
    await sleep(POLL_MS);
  }
})();
