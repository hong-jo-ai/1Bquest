/**
 * 해리엇 단체·법인 대량주문 → channel_upload:b2b_harriot 적재.
 *
 * 카페24를 안 타는 오프라인 매출(현금결제 + 세금계산서 발행)을 대시보드에 넣기 위한 스크립트.
 *  - 매출: dailyRevenue(결제일 기준) → 매출 스냅샷 크론이 harriot 브랜드 b2b_harriot 채널로 합산
 *  - 재고: salesByOption(SKU=해리엇 카페24 P코드) → 재고차감 크론(7시)이 harriot_inventory_v1 차감
 *
 * ⚠️ 폴바이스와 해리엇은 카페24 P코드가 겹친다(해리엇 P00000DW=서해 선레이 / 폴바이스 P00000DW=[증정]
 *    가죽 스트랩 블랙). inventorySync 에 몰 가드가 있어 이 채널은 harriot 몰에서만 차감된다.
 *
 * 실행: node b2bHarriotUpload.js
 */
const path = require("path"), fs = require("fs");
const DASH = path.resolve(__dirname, "..");
function le(p) { try { for (const l of fs.readFileSync(p, "utf8").split("\n")) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (!m) continue; const v = m[2].trim().replace(/^["']|["']$/g, ""); if (!(m[1] in process.env)) process.env[m[1]] = v; } } catch {} }
require(path.join(__dirname, "node_modules/dotenv")).config({ path: path.join(__dirname, ".env"), override: true });
le(path.join(DASH, ".env.supabase")); le(path.join(DASH, ".env.local"));
const { createClient } = require(path.join(DASH, "node_modules/@supabase/supabase-js"));

// ── 최선정형외과 1주년 기념 단체주문 (거래명세서 HRT-20260824-CHOISUN-01) ──
const FILE = "최선정형외과_단체주문_20260824";
const DATE = "2026-08-24";           // 세금계산서 작성일자 = 매출 인식일
const ORDERS = 1;
// 신규 출고분만. 기출고 3점(서해1·가양선레이1·성산실버1)은 카페24 주문으로 매출·재고가 이미 반영됨.
const SOLD = [
  { sku: "P00000DW", name: "서해 선레이",      option: "", sold: 22, price: 133000 }, // 190,000 -30%
  { sku: "P00000EF", name: "가양 실버 여성용", option: "", sold: 52, price: 119000 }, // 170,000 -30%
];
// 청구 잔액 = 8,968,000. 정가30%합(9,114,000)에서 기출고 3점 과납분 146,000을 차감한 실수금액.
const REVENUE = 8968000;

const HOURS = Array.from({ length: 24 }, (_, h) => ({ hour: `${String(h).padStart(2, "0")}시`, orders: 0, revenue: 0 }));
const WEEK = ["월", "화", "수", "목", "금", "토", "일"].map((day) => ({
  day, revenue: day === "월" ? REVENUE : 0, orders: day === "월" ? ORDERS : 0,
}));
const P0 = { revenue: 0, orders: 0, avgOrder: 0 };
const PT = { revenue: REVENUE, orders: ORDERS, avgOrder: REVENUE };

const data = {
  salesSummary: { today: PT, week: PT, month: PT, prevMonth: P0 },
  topProducts: SOLD.map((x, i) => ({ rank: i + 1, name: `[최선정형외과] ${x.name}`, sku: x.sku, sold: x.sold, revenue: x.sold * x.price, image: "" })),
  hourlyOrders: HOURS,
  weeklyRevenue: WEEK,
  dailyRevenue: [{ date: DATE, revenue: REVENUE, orders: ORDERS, shipments: 0 }],
  inventory: [],
  salesByOption: SOLD.map(({ sku, name, option, sold }) => ({ sku, name, option, sold })),
};

(async () => {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const KEY = "channel_upload:b2b_harriot";
  const { data: row } = await sb.from("kv_store").select("data").eq("key", KEY).maybeSingle();
  const stored = row?.data && Array.isArray(row.data.uploads) ? row.data : { uploads: [] };
  const upload = {
    fileName: FILE, rowCount: SOLD.length,
    period: { start: DATE, end: DATE },
    uploadedAt: new Date().toISOString(),
    data,
  };
  stored.uploads = stored.uploads.filter((u) => u.fileName !== FILE).concat(upload);
  await sb.from("kv_store").upsert({ key: KEY, data: stored, updated_at: new Date().toISOString() }, { onConflict: "key" });
  console.log(`${KEY} 적재 — 매출 ${REVENUE.toLocaleString()}원 / ${ORDERS}주문 / 시계 ${SOLD.reduce((s, x) => s + x.sold, 0)}점`);

  // skumap identity 매핑 (상품명 매칭 실패 시 폴백)
  const SKUMAP_KEY = "channel_pricing:skumap:b2b_harriot";
  const { data: sm } = await sb.from("kv_store").select("data").eq("key", SKUMAP_KEY).maybeSingle();
  const map = (sm?.data && typeof sm.data === "object") ? sm.data : {};
  for (const it of SOLD) map[it.sku] = it.sku;
  await sb.from("kv_store").upsert({ key: SKUMAP_KEY, data: map, updated_at: new Date().toISOString() }, { onConflict: "key" });
  console.log(`${SKUMAP_KEY} = ${JSON.stringify(map)}`);
})();
