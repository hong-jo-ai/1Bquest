// 아이맥 launchd 잡 하트비트 — 시스템 감사(2026-07-02) 조치.
// "실행됐는데 실패"는 notifyFail 이 알리지만 "아예 실행 안 됨"(기기 꺼짐·회차 소실)은 무감지였다.
// 각 잡이 성공 시 kv `heartbeat:<job>` 을 찍으면 Vercel /api/cron/watchdog 이 신선도를 감시한다.
// 사용: const { beat } = require("./heartbeat"); await beat("musinsa-sync");
// 실패해도 절대 throw 하지 않는다(하트비트가 본 작업을 막으면 안 됨).
const fs = require("fs");
const path = require("path");

function loadEnv() {
  for (const f of [path.join(__dirname, ".env"), path.join(__dirname, "..", ".env.local"), path.join(__dirname, "..", ".env.supabase")]) {
    try {
      for (const l of fs.readFileSync(f, "utf8").split("\n")) {
        const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
        if (m) { const v = m[2].trim().replace(/^["']|["']$/g, ""); if (!(m[1] in process.env)) process.env[m[1]] = v; }
      }
    } catch { /* 없는 파일 무시 */ }
  }
}

async function beat(job, extra) {
  try {
    loadEnv();
    const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) { console.log("[heartbeat] SUPABASE env 없음 — 스킵"); return; }
    const now = new Date().toISOString();
    const r = await fetch(`${url}/rest/v1/kv_store?on_conflict=key`, {
      method: "POST",
      headers: {
        apikey: key, Authorization: `Bearer ${key}`,
        "Content-Type": "application/json", Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify({ key: `heartbeat:${job}`, data: { at: now, host: require("os").hostname().split(".")[0], ...(extra || {}) }, updated_at: now }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) console.log(`[heartbeat] ${job} 기록 실패 HTTP ${r.status}`);
  } catch (e) {
    console.log(`[heartbeat] ${job} 예외: ${(e && e.message) || e}`);
  }
}

module.exports = { beat };
