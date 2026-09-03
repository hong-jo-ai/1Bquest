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

/**
 * 조선몰 상품명 → **카페24 상품명**.
 *
 * ⚠️ 재고 차감은 상품명으로 SKU 를 찾는다. 조선몰이 쓰는
 * "[단독최저가] 해리엇 서해 시리즈 시계 - 로즈골드" 는 카페24의 "서해 로즈골드" 와
 * 정규화해도 안 맞아, **팔린 만큼 재고가 안 빠졌다**(2026-09-02 실측: 로즈골드 14개 누락).
 * 매출과 재고가 같은 이름을 쓰도록 여기서 카페24 이름으로 바꿔 적재한다.
 */
const LINE = [
  { match: /가양/, line: "가양" }, { match: /광안/, line: "광안" },
  { match: /서해/, line: "서해" }, { match: /성산/, line: "성산" },
];
const COLOR = [
  { match: /로즈\s*골드/, color: "로즈골드" }, { match: /선레이/, color: "선레이" },
  { match: /실버/, color: "실버" }, { match: /블랙/, color: "블랙" },
];
function cafe24Name(raw) {
  const s = String(raw ?? "");
  const line = LINE.find((l) => l.match.test(s))?.line;
  let color = COLOR.find((c) => c.match.test(s))?.color;
  // 같은 색으로 남성용·여성용이 따로 있는 라인이 있다(성산 실버 / 성산 실버 여성용).
  // 떼어내면 남성용 SKU 에서 재고가 빠진다.
  if (color && /여성용/.test(s)) color += " 여성용";
  // 라인·색을 못 읽으면 원본을 그대로 둔다 — 억지로 바꿔 엉뚱한 SKU 에서 빠지는 게 더 나쁘다.
  return line && color ? `${line} ${color}` : s;
}
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
    // ⚠️ 한 주문에 여러 개면 품목명이 "1) …로즈골드 + 2) …실버" 로 합쳐져 있다.
    //    통째로 세면 4개가 전부 로즈골드로 잡혀 **재고가 엉뚱한 색에서 빠진다**.
    const raw = String(r.product_name);
    const parts = raw.includes(" + ") ? raw.split(" + ") : [raw];
    for (const part of parts) {
      const base = cafe24Name(part.replace(/^\d\)\s*/, "").replace(/\s*\(각인:[\s\S]*$/, "").trim());
      const p = byProduct.get(base) ?? { revenue: 0, sold: 0 };
      p.revenue += unit;   // 합본은 라인당 1개씩 — 금액도 라인 단가로 쪼갠다
      p.sold += 1;
      byProduct.set(base, p);
    }
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
  // ⚠️ 파일명을 **날짜별**로 쪼갠다. 날짜범위로 잡으면 --from 을 바꿔 돌릴 때마다
  //    파일명이 달라져 기존 항목이 남고 **매출·판매수량이 이중계상**된다(2026-09-02 실측).
  //    날짜 단위면 언제 어떤 범위로 돌려도 그 날짜만 덮어쓴다.
  const { data: row } = await sb.from("kv_store").select("data").eq(  "key", KEY).maybeSingle();
  const stored = (row?.data && Array.isArray(row.data.uploads)) ? row.data : { uploads: [] };
  const touched = new Set(dates.map((d) => `조선몰_발주_${d}`));
  const others = stored.uploads.filter((u) => !touched.has(u.fileName));

  for (const d of dates) {
    const dayRows = rows.filter((r) => kstDate(r.created_at) === d);
    const dayProduct = new Map();
    let dayRev = 0, dayOrders = 0;
    for (const r of dayRows) {
      const unit = priceFor(r.product_name);
      if (unit === null) continue;
      dayOrders += 1;
      const raw = String(r.product_name);
      for (const part of (raw.includes(" + ") ? raw.split(" + ") : [raw])) {
        const base = cafe24Name(part.replace(/^\d\)\s*/, "").replace(/\s*\(각인:[\s\S]*$/, "").trim());
        const p = dayProduct.get(base) ?? { revenue: 0, sold: 0 };
        p.revenue += unit; p.sold += 1; dayProduct.set(base, p);
        dayRev += unit;
      }
    }
    const payload = {
      salesSummary: { today: EMPTY, week: EMPTY, month: { revenue: dayRev, orders: dayOrders, avgOrder: Math.round(dayRev / Math.max(1, dayOrders)) }, prevMonth: EMPTY },
      topProducts: [...dayProduct].sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 10)
        .map(([name, v], i) => ({ rank: i + 1, name, sku: "", sold: v.sold, revenue: v.revenue, image: "⌚" })),
      hourlyOrders: Array.from({ length: 24 }, (_, h) => ({ hour: `${String(h).padStart(2, "0")}시`, orders: 0, revenue: 0 })),
      weeklyRevenue: ["월","화","수","목","금","토","일"].map((day) => ({ day, revenue: 0, orders: 0 })),
      dailyRevenue: [{ date: d, revenue: dayRev, orders: dayOrders }],
      inventory: [],
    };
    others.push({ fileName: `조선몰_발주_${d}`, rowCount: dayOrders, period: { start: d, end: d },
                  uploadedAt: new Date().toISOString(), data: payload });
  }
  others.sort((a, b) => String(a.fileName).localeCompare(String(b.fileName)));
  const { error: wErr } = await sb.from("kv_store")
    .upsert({ key: KEY, data: { uploads: others }, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (wErr) throw new Error(wErr.message);
  console.log(`\n적재 완료 — ${dates.length}일치 (저장소 누적 ${others.length}건)`);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
