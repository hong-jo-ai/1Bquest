/** baseline.js 용 — GA4 상품별 지표를 { 상품명: {views,carts,buys} } 로 반환 */
require("dotenv").config({ override: true });
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env.supabase"), override: false });

async function accessToken() {
  const { createClient } = require(path.resolve(__dirname, "..", "node_modules/@supabase/supabase-js"));
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data } = await sb.from("kv_store").select("data").eq("key", "google_refresh_token").maybeSingle();
  const rt = typeof data?.data === "string" ? data.data : data?.data?.refresh_token;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, refresh_token: rt, grant_type: "refresh_token" }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error("토큰 갱신 실패");
  return j.access_token;
}

async function runReportExport(days) {
  const t = await accessToken();
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${process.env.GA4_PROPERTY_ID}:runReport`, {
    method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      dateRanges: [{ startDate: `${days}daysAgo`, endDate: "today" }],
      dimensions: [{ name: "itemName" }],
      metrics: [{ name: "itemsViewed" }, { name: "itemsAddedToCart" }, { name: "itemsPurchased" }],
      limit: 500,
    }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(j).slice(0, 200));
  const out = {};
  for (const r of j.rows || []) {
    // GA4 itemName 은 "상품명 - PAULVICE" 처럼 접미어가 붙는다 → 접미어 제거 후 합산
    const raw = r.dimensionValues[0].value;
    const name = raw.replace(/\s*-\s*(PAULVICE|PLVE)\s*$/i, "").trim();
    const cur = out[name] || { views: 0, carts: 0, buys: 0 };
    cur.views += Number(r.metricValues[0].value || 0);
    cur.carts += Number(r.metricValues[1].value || 0);
    cur.buys += Number(r.metricValues[2].value || 0);
    out[name] = cur;
  }
  return out;
}
module.exports = { runReportExport };
