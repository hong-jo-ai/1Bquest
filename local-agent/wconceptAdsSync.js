/**
 * W컨셉 광고비(Moloco RMP) 자동 집계.
 * 폴바이스 2개 광고계정(plvekorea / shong@harriotwatches, 둘 다 W컨셉 폴바이스)에 각각
 * 로그인 → RMP report API(/ad-accounts/<id>/report, group_by DATE)로 일별 집행광고비를 받아
 * 두 계정을 날짜별 합산 → kv_store `ad_spend:wconcept` 에 저장(기존 CSV 업로드 대체).
 *
 *   money_spent 단위 = micros(원 ×1,000,000). 표시 ₩335,940 = 합계 335,940,000,000 검증됨.
 *   인증 = 로그인 후 localStorage `RMP_AUTH_REACT.RMP_AUTH_TOKEN.WCONCEPT`.token (Bearer JWT).
 *
 * 실행:  node wconceptAdsSync.js               ← 최근 120일 롤링 동기화(launchd/트리거)
 *        node wconceptAdsSync.js 2025-01-01    ← 시작일 지정 백필
 */
require("dotenv").config({ override: true });
const fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const DASH = path.resolve(__dirname, "..");
function le(p) { try { for (const l of fs.readFileSync(p, "utf8").split("\n")) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (!m) continue; let v = m[2].trim().replace(/^["']|["']$/g, ""); if (!(m[1] in process.env)) process.env[m[1]] = v; } } catch {} }
le(path.join(DASH, ".env.supabase")); le(path.join(DASH, ".env.local")); le(path.join(__dirname, ".env"));
const { createClient } = require(path.join(DASH, "node_modules/@supabase/supabase-js"));

const env = (n) => process.env[n] || "";
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
const sb = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const KV_KEY = "ad_spend:wconcept";
const REPORT = (id) => `https://wconcept-mgmt.rmp-api.moloco.com/rmp/mgmt/v1/platforms/WCONCEPT/ad-accounts/${id}/report`;

const ACCOUNTS = [
  { key: "1", email: env("WCONCEPT_ADS_ACCOUNT_1_EMAIL"), pw: env("WCONCEPT_ADS_ACCOUNT_1_PW"), id: env("WCONCEPT_ADS_ACCOUNT_1_ID") },
  { key: "2", email: env("WCONCEPT_ADS_ACCOUNT_2_EMAIL"), pw: env("WCONCEPT_ADS_ACCOUNT_2_PW"), id: env("WCONCEPT_ADS_ACCOUNT_2_ID") },
].filter((a) => a.email && a.pw);

function kstDate(offsetDays = 0) {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

async function tg(msg) {
  await require("./telegramRelay").relayText(msg);
}

// 한 계정 로그인 → 토큰 + 계정ID 확보
async function getAuth(acc) {
  const profile = path.join(__dirname, `.moloco-ads-${acc.key}`);
  const ctx = await chromium.launchPersistentContext(profile, { channel: "chrome", headless: true, viewport: { width: 1366, height: 900 } });
  try {
    const page = ctx.pages()[0] || (await ctx.newPage());
    await page.goto("https://wconcept.rmp-portal.moloco.com/sponsored-ads", { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(1500);
    if (/signin/.test(page.url())) {
      await page.fill("#email", acc.email);
      await page.fill("#current-password", acc.pw);
      await Promise.all([page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {}), page.click('button:has-text("로그인")')]);
      await page.waitForTimeout(5000);
    }
    if (/signin/.test(page.url())) throw new Error("로그인 실패(아이디/비번 또는 추가인증 확인)");
    const urlId = (page.url().match(/\/a\/(\d+)/) || [])[1];
    const token = await page.evaluate(() => {
      const raw = localStorage.getItem("RMP_AUTH_REACT.RMP_AUTH_TOKEN.WCONCEPT");
      try { return JSON.parse(raw).token; } catch { return null; }
    });
    if (!token) throw new Error("토큰을 찾지 못함");
    return { token, id: acc.id || urlId };
  } finally {
    await ctx.close();
  }
}

// report API → { 'YYYY-MM-DD': 원 }
async function fetchDaily(acc, start, end) {
  const { token, id } = await getAuth(acc);
  if (!id) throw new Error("광고계정 ID 확인 불가");
  const r = await fetch(REPORT(id), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ timezone: "Asia/Seoul", date_start: start, date_end: end, group_by: ["CURRENCY", "DATE"], order_by: ["TIME_DATE"] }),
  });
  if (!r.ok) throw new Error(`report API ${r.status}: ${(await r.text()).slice(0, 120)}`);
  const j = await r.json();
  const out = {};
  for (const row of j.rows || []) {
    if (!row.date) continue;
    out[row.date] = Math.round(Number(row.money_spent || 0) / 1e6); // micros→원
  }
  return { id, daily: out };
}

async function main() {
  if (!ACCOUNTS.length) throw new Error("WCONCEPT_ADS_ACCOUNT_*_EMAIL/PW 미설정");
  const end = kstDate(0);
  const start = process.argv[2] || env("WCONCEPT_ADS_START_DATE") || kstDate(-120);
  log(`W컨셉 광고비 집계 ${start} ~ ${end} (계정 ${ACCOUNTS.length}개)`);

  const combined = {};
  const perAccount = [];
  for (const acc of ACCOUNTS) {
    try {
      const { id, daily } = await fetchDaily(acc, start, end);
      let sum = 0;
      for (const [d, v] of Object.entries(daily)) { combined[d] = (combined[d] || 0) + v; sum += v; }
      perAccount.push(`계정${acc.key}(${id}) ${Object.keys(daily).length}일 ₩${sum.toLocaleString()}`);
      log(`✓ 계정${acc.key} ${id}: ${Object.keys(daily).length}일, 합 ₩${sum.toLocaleString()}`);
    } catch (e) {
      log(`✗ 계정${acc.key} 실패: ${e.message}`);
      perAccount.push(`계정${acc.key} 실패: ${e.message}`);
    }
  }

  const dates = Object.keys(combined).sort();
  if (!dates.length) { await tg("⚠️ W컨셉 광고비 집계: 데이터 없음(로그인/계정 확인)"); throw new Error("수집된 데이터 없음"); }

  // kv 머지(해당 날짜 = 최신 합산값으로 덮어씀)
  const db = sb();
  const { data: existing } = await db.from("kv_store").select("data").eq("key", KV_KEY).maybeSingle();
  const next = { ...((existing && existing.data) || {}) };
  for (const d of dates) next[d] = combined[d];
  const { error } = await db.from("kv_store").upsert({ key: KV_KEY, data: next, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error("저장 실패: " + error.message);

  const total = dates.reduce((s, d) => s + combined[d], 0);
  const recent = dates.slice(-7).map((d) => `${d.slice(5)} ₩${combined[d].toLocaleString()}`).join("\n");
  log(`저장 완료: ${dates.length}일, 합 ₩${total.toLocaleString()} (누적 ${Object.keys(next).length}일)`);
  await tg(`📊 W컨셉 광고비 집계 완료 (${start}~${end})\n${perAccount.join("\n")}\n합계 ₩${total.toLocaleString()}\n\n최근 7일:\n${recent}`);
}

main().catch((e) => { console.error("ERR", e.message); process.exit(1); });
