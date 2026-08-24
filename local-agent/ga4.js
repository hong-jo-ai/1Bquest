/**
 * GA4 Data API — 서비스 계정(JWT) 인증. 2026-08-25 신설.
 *
 * 왜: 기존 lib/ga4Client.ts 는 브라우저 OAuth 쿠키(ga_rt) 기반이라 헤드리스에서 못 쓴다.
 *     "노출이 적은가 / 색이 안 팔리는가" 같은 판단을 조회수 없이 판매량만 보고 하면 계속 오진한다
 *     (2026-08-25 미니엘 핑크 오판이 그 사례). 서비스 계정을 붙여 에이전트가 직접 뽑게 한다.
 *
 * 설정: .env 에 GA4_PROPERTY_ID 만 있으면 된다(인증은 kv google_refresh_token 재사용).
 * 사용: node ga4.js items --days 90 --grep 미니엘     상품별 조회수·구매수·전환율
 *       node ga4.js check                              연결 확인
 */
require("dotenv").config({ override: true });
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env.supabase"), override: false });

/**
 * 인증 = kv `google_refresh_token` (스코프에 analytics.readonly 포함, 2026-06-17 저장분).
 * ⚠️ 서비스 계정을 새로 만들 필요 없다 — 2026-08-25 확인. 같은 토큰을 Gmail·캘린더·시트도 쓴다.
 *    이 토큰이 폐기되면 대시보드에서 구글 재연결 → kv 가 갱신된다.
 */
async function accessToken() {
  const { createClient } = require(path.resolve(__dirname, "..", "node_modules/@supabase/supabase-js"));
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data } = await sb.from("kv_store").select("data").eq("key", "google_refresh_token").maybeSingle();
  const rt = typeof data?.data === "string" ? data.data : data?.data?.refresh_token;
  if (!rt) throw new Error("kv google_refresh_token 없음 — 대시보드에서 구글 재연결 필요");
  const id = process.env.GOOGLE_CLIENT_ID, secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!id || !secret) throw new Error("GOOGLE_CLIENT_ID/SECRET 없음");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: rt, grant_type: "refresh_token" }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error("토큰 갱신 실패: " + JSON.stringify(j).slice(0, 300));
  return j.access_token;
}

async function runReport(body) {
  const pid = process.env.GA4_PROPERTY_ID;
  if (!pid) throw new Error("GA4_PROPERTY_ID 가 필요합니다(.env)");
  const t = await accessToken();
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${pid}:runReport`, {
    method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`runReport ${res.status}: ${JSON.stringify(j).slice(0, 400)}`);
  return j;
}

/** 상품별 조회수·장바구니·구매 — 노출 문제인지 상품 문제인지 가르는 핵심 지표 */
async function items(days, grep) {
  const j = await runReport({
    dateRanges: [{ startDate: `${days}daysAgo`, endDate: "today" }],
    dimensions: [{ name: "itemName" }],
    metrics: [{ name: "itemsViewed" }, { name: "itemsAddedToCart" }, { name: "itemsPurchased" }],
    limit: 200,
  });
  const rows = (j.rows || []).map((r) => ({
    name: r.dimensionValues[0].value,
    views: Number(r.metricValues[0].value || 0),
    carts: Number(r.metricValues[1].value || 0),
    buys: Number(r.metricValues[2].value || 0),
  })).filter((r) => !grep || r.name.includes(grep));
  rows.sort((a, b) => b.views - a.views);
  console.log(`최근 ${days}일 · ${grep ? `"${grep}" ` : ""}상품 ${rows.length}종\n`);
  console.log(`${"상품".padEnd(34)}${"조회".padStart(7)}${"장바구니".padStart(9)}${"구매".padStart(6)}${"조회→구매".padStart(11)}`);
  for (const r of rows) {
    const cvr = r.views ? (r.buys / r.views * 100).toFixed(1) + "%" : "-";
    console.log(`${r.name.slice(0, 33).padEnd(34)}${String(r.views).padStart(7)}${String(r.carts).padStart(9)}${String(r.buys).padStart(6)}${cvr.padStart(11)}`);
  }
  const T = rows.reduce((a, r) => ({ v: a.v + r.views, c: a.c + r.carts, b: a.b + r.buys }), { v: 0, c: 0, b: 0 });
  console.log(`\n합계 조회 ${T.v} · 장바구니 ${T.c} · 구매 ${T.b}`);
}

(async () => {
  const cmd = process.argv[2] || "check";
  const days = Number((process.argv.find((a) => a.startsWith("--days=")) || "").split("=")[1]
    || process.argv[process.argv.indexOf("--days") + 1] || 90);
  const gi = process.argv.indexOf("--grep");
  const grep = gi > 0 ? process.argv[gi + 1] : null;
  if (cmd === "check") {
    const j = await runReport({ dateRanges: [{ startDate: "7daysAgo", endDate: "today" }], metrics: [{ name: "sessions" }] });
    console.log("✅ GA4 연결 OK — 최근 7일 세션:", j.rows?.[0]?.metricValues?.[0]?.value ?? 0);
  } else if (cmd === "items") { await items(days, grep); }
  else console.log("사용: node ga4.js check | items [--days 90] [--grep 미니엘]");
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
