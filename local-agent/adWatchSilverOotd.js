/**
 * 실버 OOTD 광고세트 일회성 판정 (2026-09-15 사장님 지시: "내일까지 보고 개선되지 않으면 꺼").
 *
 * 판정 기준(사장님께 보고한 그대로):
 *   어제까지 7일(9/9~9/15) ROAS < 손익분기 1.57 → 종료(PAUSED). 이상이면 유지.
 *   MADS 가 같은 세트에 pending pause 추천을 남겼으면 그 추천을 accept(기록이 남는다),
 *   추천이 없으면 /api/mads/activate 로 직접 PAUSED.
 *
 * 메타 토큰은 로컬에 없다 → 프로덕션 API 를 세션 쿠키(APP_AUTH_SECRET)로 부른다.
 * 실행: launchd 일회성 com.paulvice.ad-watch-silver-ootd (2026-09-16 09:40 KST, MADS 아침 사이클 09:00 뒤).
 * 끝나면 launchd job 자기 제거.
 */
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const DASH = "/Users/mac/sungjo_ai/paulwise-dashboard";
function loadEnv(p) { try { for (const l of fs.readFileSync(p, "utf8").split("\n")) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (!m) continue; const v = m[2].trim().replace(/^["']|["']$/g, ""); if (!(m[1] in process.env)) process.env[m[1]] = v; } } catch {} }
loadEnv(path.join(DASH, ".env.local")); loadEnv(path.join(DASH, ".env.supabase")); loadEnv(path.join(__dirname, ".env"));
const { createClient } = require(path.join(DASH, "node_modules/@supabase/supabase-js"));
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const relay = require("./telegramRelay").relayText;

const ADSET_NAME = "%실버 OOTD%";
const BE_ROAS = 1.57;            // lib/mads/marginConfig.ts beRoas
const BASE = "https://paulvice-dashboard.vercel.app";
const LABEL = "com.paulvice.ad-watch-silver-ootd";
const krw = (n) => Math.round(Number(n)).toLocaleString("ko-KR");

function sessionCookie() {
  const b64 = (b) => Buffer.from(b).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const data = b64(JSON.stringify({ email: "jacobhong2@gmail.com", exp: Math.floor(Date.now() / 1000) + 600 }));
  const sig = b64(crypto.createHmac("sha256", process.env.APP_AUTH_SECRET).update(data).digest());
  return `paulwise_session=${data}.${sig}`;
}
async function api(p, body) {
  const r = await fetch(BASE + p, { method: "POST", headers: { cookie: sessionCookie(), "Content-Type": "application/json" }, body: JSON.stringify(body), redirect: "manual" });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ...j };
}

(async () => {
  let report = "";
  try {
    const { data: set } = await db.from("mads_ad_sets").select("meta_adset_id,name,status,daily_budget").ilike("name", ADSET_NAME).maybeSingle();
    if (!set) throw new Error("실버 OOTD 광고세트를 mads_ad_sets 에서 못 찾음");

    // 어제까지 7일 (KST)
    const todayKst = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
    const since = new Date(new Date(todayKst).getTime() - 7 * 864e5).toISOString().slice(0, 10);
    const { data: m } = await db.from("mads_daily_metrics").select("date,spend,revenue,conversions")
      .eq("meta_adset_id", set.meta_adset_id).gte("date", since).lt("date", todayKst).order("date");
    const spend = (m || []).reduce((s, d) => s + Number(d.spend), 0);
    const revenue = (m || []).reduce((s, d) => s + Number(d.revenue), 0);
    const conv = (m || []).reduce((s, d) => s + Number(d.conversions), 0);
    const roas = spend > 0 ? revenue / spend : 0;
    const lines = (m || []).map((d) => `${d.date.slice(5)} 지출 ${krw(d.spend)} / 매출 ${krw(d.revenue)} / 전환 ${d.conversions}`).join("\n");
    const head = `📊 [실버 OOTD 판정] ${since}~${todayKst} 전날까지 7일\n${lines}\n합계 지출 ${krw(spend)} · 매출 ${krw(revenue)} · ROAS ${roas.toFixed(2)} · 전환 ${conv} (손익분기 ${BE_ROAS})`;

    if (set.status === "PAUSED") { report = head + "\n\n이미 PAUSED 상태 — 조치 없음."; }
    else if (roas >= BE_ROAS) { report = head + `\n\n→ 손익분기 이상. **유지**합니다(사장님 기준: 개선되지 않으면 종료).`; }
    else {
      // 종료 — MADS pending pause 추천이 있으면 그것을 accept(이력 남김), 없으면 직접 PAUSED
      const { data: rec } = await db.from("mads_recommendations").select("id,action_type,status,reason")
        .eq("meta_adset_id", set.meta_adset_id).eq("status", "pending").order("created_at", { ascending: false }).limit(1).maybeSingle();
      let res, how;
      if (process.env.DRY) { console.log(head + `\n\n[DRY] 손익분기 미달 → 종료 대상. pending 추천: ${rec ? rec.action_type + " " + rec.id.slice(0, 8) : "없음"}`); process.exit(0); }
      if (rec && rec.action_type === "pause") { how = `MADS 추천 accept (${rec.id.slice(0, 8)})`; res = await api("/api/mads/decide", { recommendationId: rec.id, decision: "accept", note: "사장님 지시 2026-09-15: 내일까지 개선 없으면 종료 — 자동 판정" }); }
      else { how = "activate 직접 PAUSED"; res = await api("/api/mads/activate", { adsetId: set.meta_adset_id, status: "PAUSED" }); }
      const ok = res.ok === true || res.status === 200;
      report = head + `\n\n→ 손익분기 미달. **종료 실행**(${how}) → ${ok ? "✅ PAUSED 완료" : "❌ 실패: " + JSON.stringify(res).slice(0, 200)}`;
      if (!ok) report += "\n사장님이 메타에서 직접 꺼주세요.";
    }
  } catch (e) {
    report = `⚠️ 실버 OOTD 자동 판정 오류: ${e.message}\n사장님이 직접 판단해 주세요.`;
  }
  console.log(report);
  if (process.env.DRY) process.exit(0);
  try { await relay(report.replace(/\*\*/g, "")); } catch (e) { console.error("telegram 실패:", e.message); }
  // 일회성 launchd job 자기 제거
  try { require("child_process").execSync(`launchctl bootout gui/$(id -u)/${LABEL} 2>/dev/null; rm -f "${process.env.HOME}/Library/LaunchAgents/${LABEL}.plist"`, { stdio: "ignore" }); } catch {}
  process.exit(0);
})();
