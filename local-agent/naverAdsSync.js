/**
 * 네이버 검색광고 일별 광고비 → kv `ad_spend:naver` (2026-08-25 신규).
 *
 * 왜: 네이버 검색광고비가 손익에 전혀 안 잡히고 있었다. 비즈머니 충전은 은행에서
 *     "네이버페이충전"으로만 찍혀 광고비인지 쇼핑인지 구분이 안 된다.
 *     플랫폼 API에서 직접 일별 소진액을 가져와야 정확하다.
 *
 * 비즈머니 잔액이 임계치 아래면 텔레그램으로 알린다 — 잔액 0이면 광고가 조용히 멈춘다.
 *
 * 사용: node naverAdsSync.js [--days 30] [--apply]
 */
const path = require("path");
const { call, stats, bizmoney } = require("./naverSearchAd.js");
require("dotenv").config({ override: true });
require("dotenv").config({ path: path.join(__dirname, "..", ".env.supabase"), override: false });
const { createClient } = require(path.join(__dirname, "..", "node_modules/@supabase/supabase-js"));

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const KV = "ad_spend:naver";
const LOW_BALANCE = 20000;   // 이 아래면 알림 — CPC 55원 기준 며칠치밖에 안 남는다
const APPLY = process.argv.includes("--apply");
const DAYS = Number((process.argv.find((a) => a.startsWith("--days=")) || "").split("=")[1]) ||
  Number(process.argv[process.argv.indexOf("--days") + 1]) || 30;

const ymd = (d) => d.toISOString().slice(0, 10);
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d); }
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);

async function telegram(text) {
  const t = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!t || !chat) return;
  await fetch(`https://api.telegram.org/bot${t}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text, parse_mode: "HTML" }),
  }).catch(() => {});
}

(async () => {
  log("=== 네이버 검색광고 광고비 동기화 시작 ===");
  const campaigns = await call("GET", "/ncc/campaigns");

  // ⚠️ /stats 는 한 번에 92일까지만 준다(11004). 그보다 길면 90일씩 잘라서 여러 번 받는다.
  const CHUNK = 90;
  const windows = [];
  for (let off = DAYS; off > 0; off -= CHUNK) {
    windows.push({ since: daysAgo(off), until: daysAgo(Math.max(1, off - CHUNK + 1)) });
  }

  const daily = {};
  for (const c of campaigns) {
    let sum = 0;
    for (const w of windows) {
      const r = await call("GET", "/stats", {
        id: c.nccCampaignId,
        fields: JSON.stringify(["salesAmt", "clkCnt", "impCnt", "ccnt", "convAmt"]),
        timeRange: JSON.stringify(w),
      });
      for (const d of r.data || []) {
        daily[d.dateStart] = (daily[d.dateStart] || 0) + (d.salesAmt || 0);
        sum += d.salesAmt || 0;
      }
    }
    log(`${c.name}: ${Math.round(sum).toLocaleString()}원`);
  }

  // 전환추적 점검 — 2026-08-25 캠페인 trackingMode 를 AUTO_TRACKING_MODE 로 켰다.
  // 그전까지 클릭은 있는데 전환이 계속 0이었다. 켠 뒤로도 0이 이어지면 사이트 스크립트
  // 계정 불일치(site wa=s_67fe2d9aabc vs 검색광고 naAccountId=s_58606972ecd2)가 원인이다.
  let clk14 = 0, conv14 = 0;
  for (const c of campaigns) {
    const r = await call("GET", "/stats", {
      id: c.nccCampaignId,
      fields: JSON.stringify(["clkCnt", "ccnt"]),
      timeRange: JSON.stringify({ since: daysAgo(14), until: daysAgo(1) }),
    });
    for (const d of r.data || []) { clk14 += d.clkCnt || 0; conv14 += d.ccnt || 0; }
  }
  log(`최근14일 클릭 ${clk14} · 전환 ${conv14}`);
  if (clk14 >= 50 && conv14 === 0) {
    await telegram(`⚠️ <b>네이버 광고 전환추적 여전히 0</b>\n최근 14일 클릭 ${clk14}건인데 전환 0건입니다.\n프리미엄 로그분석 계정 불일치가 의심됩니다 (사이트 s_67fe2d9aabc ≠ 검색광고 s_58606972ecd2).`);
    log("→ 전환추적 이상 알림 발송");
  }

  const rows = Object.entries(daily)
    .filter(([, v]) => v > 0)
    .map(([date, spend]) => ({ date, spend: Math.round(spend) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const total = rows.reduce((s, r) => s + r.spend, 0);
  log(`${daysAgo(DAYS)}~${daysAgo(1)}: ${rows.length}일 · 합계 ${total.toLocaleString()}원`);

  if (APPLY) {
    const { data: cur } = await sb.from("kv_store").select("data").eq("key", KV).maybeSingle();
    const merged = { ...(cur?.data || {}) };
    rows.forEach((r) => { merged[r.date] = r.spend; });
    const now = new Date().toISOString();
    await sb.from("kv_store").upsert({ key: KV, data: merged, updated_at: now }, { onConflict: "key" });
    log(`✅ ${KV} 반영 (총 ${Object.keys(merged).length}일)`);
  } else {
    log("DRY-RUN — --apply 로 반영");
  }

  const bm = await bizmoney();
  log(`비즈머니 잔액 ${bm.bizmoney.toLocaleString()}원`);
  if (bm.bizmoney < LOW_BALANCE) {
    await telegram(`⚠️ <b>네이버 검색광고 비즈머니 부족</b>\n잔액 ${bm.bizmoney.toLocaleString()}원 (임계 ${LOW_BALANCE.toLocaleString()}원)\n충전하지 않으면 광고가 멈춥니다.`);
    log("→ 잔액 부족 알림 발송");
  }

  await require("./heartbeat").beat("naver-ads-sync", { days: rows.length, total, clk14, conv14 });
  log("=== 완료 ===");
})().catch(async (e) => {
  console.error("ERR", e);
  try { await require("./notifyFail").notifyFail("네이버 검색광고 동기화", e.message || String(e)); } catch (_) {}
  process.exit(1);
});
