/**
 * 조선몰 매출을 대시보드 채널(chosunmall)에 적재.
 *
 * 조선몰은 발주서 메일로만 주문이 오고 카페24를 안 타서 대시보드에 매출이 아예 안 잡혔다
 * (사장님 지적 2026-09-01). 접수 기록(pp_shipments, channel=조선몰)을 원본으로 쓴다 —
 * 발주서에는 **금액 열이 없어** 수량만 알 수 있기 때문이다.
 *
 * 매출 = 공급가(우리 수령액). 조선몰 판매가에서 수수료 35% 를 뗀 금액이고 VAT 포함이다.
 * 근거: docs/chosunmall-supply-price-fix.md (2026-08-26 저쪽과 확정)
 *   서해/성산 179,000 → 116,350 · 광안 로즈골드 169,000 → 109,850 · 가양 여성용 159,000 → 103,350
 *
 * ⚠️ 단가를 못 찾은 상품은 **0원으로 처리하지 않고 실패로 남긴다.** 조용히 0이 섞이면
 *    매출이 틀린 채로 그럴듯해 보인다.
 *
 * 실행: node chosunmallRevenue.js               (오늘 것만, 미리보기)
 *       node chosunmallRevenue.js --send        (적재)
 *       node chosunmallRevenue.js --from 2026-08-31 --send
 */
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env"), override: true });
const DASH = path.resolve(__dirname, "..");
for (const f of [path.join(DASH, ".env.supabase"), path.join(DASH, ".env.local")]) {
  try {
    for (const l of fs.readFileSync(f, "utf8").split("\n")) {
      const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch { /* 없는 파일 무시 */ }
}
const { createClient } = require(path.join(DASH, "node_modules/@supabase/supabase-js"));

// 라인별 공급가(VAT 포함). 상품명에 아래 키워드가 있으면 해당 단가.
const SUPPLY_PRICE = [
  { match: /가양/, price: 103_350, label: "가양 로즈골드 여성용" },
  { match: /광안/, price: 109_850, label: "광안 로즈골드" },
  { match: /서해/, price: 116_350, label: "서해" },
  { match: /성산/, price: 116_350, label: "성산" },
];
const KEY = "channel_upload:chosunmall";

function priceFor(name) {
  const hit = SUPPLY_PRICE.find((p) => p.match.test(String(name)));
  return hit ? hit.price : null;
}

const kstDate = (iso) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(iso));

(async () => {
  const send = process.argv.includes("--send");
  const fromArg = process.argv[process.argv.indexOf("--from") + 1];
  const from = process.argv.includes("--from") && fromArg ? fromArg : kstDate(new Date().toISOString());

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data, error } = await sb
    .from("pp_shipments")
    .select("order_number,product_name,qty,created_at,status,is_test")
    .eq("channel", "조선몰")
    .gte("created_at", `${from}T00:00:00+09:00`)
    .order("created_at");
  if (error) throw new Error(error.message);

  // 취소·테스트 접수는 매출이 아니다.
  const rows = (data ?? []).filter((r) => r.status !== "cancelled" && !r.is_test);
  console.log(`조선몰 접수 ${rows.length}건 (${from} 이후)\n`);

  const byDate = new Map();
  const byProduct = new Map();
  const unpriced = [];
  let revenue = 0, orders = 0;

  for (const r of rows) {
    const unit = priceFor(r.product_name);
    if (unit === null) { unpriced.push(`${r.order_number} ${r.product_name}`); continue; }
    const qty = Number(r.qty || 1);
    const amount = unit * qty;
    const d = kstDate(r.created_at);
    revenue += amount; orders += 1;
    byDate.set(d, { revenue: (byDate.get(d)?.revenue ?? 0) + amount, orders: (byDate.get(d)?.orders ?? 0) + 1 });
    // 각인·색상 꼬리표를 떼고 라인 단위로 묶는다
    const base = String(r.product_name).replace(/\s*\(각인:[\s\S]*$/, "").trim();
    const p = byProduct.get(base) ?? { revenue: 0, sold: 0 };
    p.revenue += amount; p.sold += qty; byProduct.set(base, p);
  }

  for (const [d, v] of [...byDate].sort()) console.log(`  ${d}  ${v.orders}건  ${v.revenue.toLocaleString("ko-KR")}원`);
  console.log(`\n합계 ${orders}건 · ${revenue.toLocaleString("ko-KR")}원`);
  if (unpriced.length) {
    console.log(`\n🔴 단가 미확인 ${unpriced.length}건 — 적재하지 않음:`);
    unpriced.forEach((u) => console.log(`   ${u}`));
  }
  if (!orders) { console.log("적재할 매출 없음"); return; }
  if (!send) { console.log("\nDRY RUN — 적재하려면 --send"); return; }

  const EMPTY = { revenue: 0, orders: 0, avgOrder: 0 };
  const period = { revenue, orders, avgOrder: Math.round(revenue / orders) };
  const dates = [...byDate.keys()].sort();
  const payload = {
    salesSummary: { today: EMPTY, week: EMPTY, month: period, prevMonth: EMPTY },
    // ⚠️ 판매수량 필드명은 `sold` 다. `units` 로 넣으면 머지에서 null 이 되어
    //    매출은 맞는데 수량만 비는 상태가 된다(2026-09-01 실측).
    topProducts: [...byProduct].sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 10)
      .map(([name, v], i) => ({ rank: i + 1, name, sku: "", sold: v.sold, revenue: v.revenue, image: "⌚" })),
    hourlyOrders: Array.from({ length: 24 }, (_, h) => ({ hour: `${String(h).padStart(2, "0")}시`, orders: 0, revenue: 0 })),
    weeklyRevenue: ["월","화","수","목","금","토","일"].map((day) => ({ day, revenue: 0, orders: 0 })),
    dailyRevenue: dates.map((d) => ({ date: d, revenue: byDate.get(d).revenue, orders: byDate.get(d).orders })),
    inventory: [],
  };
  // 날짜 범위를 파일명으로 삼는다 → 같은 구간 재실행 시 교체(누적 중복 방지).
  const fileName = `조선몰_발주_${dates[0]}_${dates[dates.length - 1]}`;
  const meta = { fileName, rowCount: orders, period: { start: dates[0], end: dates[dates.length - 1] }, uploadedAt: new Date().toISOString() };

  const { data: row } = await sb.from("kv_store").select("data").eq("key", KEY).maybeSingle();
  const stored = (row?.data && Array.isArray(row.data.uploads)) ? row.data : { uploads: [] };
  const others = stored.uploads.filter((u) => u.fileName !== fileName);
  others.push({ ...meta, data: payload });
  others.sort((a, b) => String(a.uploadedAt).localeCompare(String(b.uploadedAt)));
  const { error: wErr } = await sb.from("kv_store")
    .upsert({ key: KEY, data: { uploads: others }, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (wErr) throw new Error(wErr.message);
  console.log(`\n적재 완료 — "${fileName}" (누적 ${others.length}건)`);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
