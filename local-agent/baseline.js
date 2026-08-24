/**
 * 기준선 스냅샷 — 변경 전 상태를 찍어 둔다. 2026-08-25 신설.
 *
 * 왜: 가격 인하·메인 개편·광고 집행의 효과를 재려면 **직전 상태**가 있어야 한다.
 *     안 찍어두면 "좋아진 것 같다"로 끝나고 영영 비교 불가([[decide-by-data]]).
 *
 * 담는 것: GA4 상품별 조회·장바구니·구매 / 카페24 가격·진열·판매 / 재고 장부 / 누적판매
 * 사용: node baseline.js --tag before-miniel-99k [--grep 미니엘]
 *       node baseline.js --list
 */
require("dotenv").config({ override: true });
const path = require("path"), fs = require("fs");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env.supabase"), override: false });
const { createClient } = require(path.resolve(__dirname, "..", "node_modules/@supabase/supabase-js"));
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const OUT = path.resolve(__dirname, "..", "downloads", "baseline");
const BASE = "https://icaruse2000.cafe24api.com/api/v2/admin";

async function tok() {
  const { data } = await sb.from("kv_store").select("data").eq("key", "cafe24_refresh_token").maybeSingle();
  return data.data.access_token;
}
async function ga4(days) {
  const { runReportExport } = require("./ga4Export");
  return runReportExport(days);
}

(async () => {
  if (process.argv.includes("--list")) {
    fs.mkdirSync(OUT, { recursive: true });
    fs.readdirSync(OUT).sort().forEach((f) => console.log("  " + f));
    return;
  }
  const ti = process.argv.indexOf("--tag");
  const tag = ti > 0 ? process.argv[ti + 1] : "snapshot";
  const gi = process.argv.indexOf("--grep");
  const grep = gi > 0 ? process.argv[gi + 1] : null;
  const stamp = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date());

  const t = await tok();
  let products = [];
  for (let off = 0; off < 300; off += 100) {
    const r = await fetch(`${BASE}/products?shop_no=1&limit=100&offset=${off}&fields=product_no,product_name,product_code,price,retail_price,display,selling`, { headers: { Authorization: `Bearer ${t}` } });
    const j = await r.json(); if (!j.products?.length) break; products = products.concat(j.products);
  }
  if (grep) products = products.filter((p) => p.product_name.includes(grep));

  const { data: inv } = await sb.from("kv_store").select("data").eq("key", "paulvice_inventory_v1").maybeSingle();
  const { data: sold } = await sb.from("kv_store").select("data").eq("key", "cafe24_cumulative_sold:paulvice").maybeSingle();
  const I = inv.data, S = (sold.data && sold.data.soldBySku) || {};

  const ga = await ga4(90).catch((e) => { console.log("GA4 실패:", e.message); return {}; });

  const rows = products.map((p) => {
    const e = I[p.product_code];
    const stock = e ? e.initialStock + e.manualAdjustment - (S[p.product_code] || 0) - (e.dutyfreeOut || 0) : null;
    const g = ga[p.product_name] || {};
    return {
      no: p.product_no, code: p.product_code, name: p.product_name,
      price: Math.round(Number(p.price)), retail: Math.round(Number(p.retail_price)),
      display: p.display, selling: p.selling,
      stock, sold90: S[p.product_code] ?? null,
      views: g.views ?? null, carts: g.carts ?? null, buys: g.buys ?? null,
    };
  });

  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `${stamp}_${tag}.json`);
  fs.writeFileSync(file, JSON.stringify({ tag, at: new Date().toISOString(), grep, gaDays: 90, rows }, null, 1));
  console.log(`✅ 기준선 저장: ${file}`);
  console.log(`   상품 ${rows.length}종 · GA4 매칭 ${rows.filter((r) => r.views !== null).length}종`);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
