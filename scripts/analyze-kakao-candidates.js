const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");

for (const file of [".env.supabase", ".env.local"]) {
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, "utf8").split(/\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
  }
}

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const asOf = process.env.AS_OF || "2026-06-16";
const today = new Date(`${asOf}T00:00:00+09:00`);

// kakao_gift_sku_map is currently empty in production data, so infer the
// active Kakao catalog from recent PO product/option names. These are only used
// to exclude already-selling items and to subtract known Kakao PO demand.
const CURRENT_KAKAO_SKU_OVERRIDES = {
  "큐빅 싱글라인 테니스 팔찌-실버": "P00000BT",
  "볼비드 하트 펜던트 팔찌-실버": "P00000BU",
  "에끌라 오벌 워치 - 골드&실버|골드": "P00000HN",
  "에끌라 오벌 워치 - 골드&실버|실버": "P00000HO",
  "하트 진주 자개 팔찌-화이트": "P00000BW",
  "오벌 진주 볼 믹스비드 팔찌-샴페인": "P00000BV",
  "6mm 스와로브스키 진주 귀걸이-화이트": "P00000BJ",
  "데이지 플라워 이어커프-실버": "P00000BQ",
  "하트 진주 자개 귀걸이-화이트": "P00000CK",
  "데이지 플라워 링-실버": "P00000HZ",
  "오드리 컬렉션 사각 가죽 시계|화이트 브라운": "P00000GA",
  "청키 하트 하프 후프 귀걸이-실버": "P00000BM",
  "3mm 볼 귀걸이-실버": "P00000BP",
};

const num = (v) => {
  const n = parseFloat(String(v ?? 0).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const ymd = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => ymd(new Date(today.getTime() - n * 86400000));

function normalizeUpload(raw) {
  if (raw && typeof raw === "object") {
    if (Array.isArray(raw.uploads)) return raw.uploads;
    if (raw.data && raw.meta) return [{ ...raw.meta, data: raw.data }];
  }
  return [];
}

function addSales(map, sku, patch) {
  if (!sku) return;
  const current = map.get(sku) || {
    sku,
    name: "",
    sold90: 0,
    sold30: 0,
    sold14: 0,
    rev90: 0,
    cafe24Qty90: 0,
    cafe24Qty30: 0,
    cafe24Qty14: 0,
    kakaoQty90: 0,
    kakaoQty30: 0,
    kakaoQty14: 0,
    channels: {},
  };
  for (const [key, value] of Object.entries(patch)) {
    if (key === "name") {
      if (value && !current.name) current.name = value;
    } else if (key === "channels") {
      for (const [channel, sold] of Object.entries(value)) {
        current.channels[channel] = (current.channels[channel] || 0) + sold;
      }
    } else {
      current[key] = (current[key] || 0) + value;
    }
  }
  map.set(sku, current);
}

function lineItemRevenue(item) {
  let qty = num(item.actual_quantity);
  if (qty === 0) qty = Math.max(0, num(item.quantity) - num(item.claim_quantity));
  if (qty === 0) return 0;
  return Math.max(
    0,
    qty * (num(item.product_price) + num(item.option_price)) -
      num(item.coupon_discount_price) -
      num(item.additional_discount_price),
  );
}

async function cafe24Fetch(path, token) {
  const res = await fetch(`https://${process.env.CAFE24_MALL_ID}.cafe24api.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Cafe24-Api-Version": "2026-03-01",
    },
  });
  if (!res.ok) throw new Error(`Cafe24 ${res.status}: ${await res.text()}`);
  return res.json();
}

async function fetchCafe24Products(token) {
  const products = [];
  let offset = 0;
  while (token) {
    const data = await cafe24Fetch(
      `/api/v2/admin/products?limit=100&display=T&offset=${offset}&embed=categories`,
      token,
    );
    const batch = data.products || [];
    products.push(
      ...batch.map((p) => ({
        sku: p.product_code || String(p.product_no),
        name: p.product_name || "",
        image: p.list_image || p.small_image || p.detail_image || "",
        price: num(p.price),
        retail: num(p.retail_price),
        category: Array.isArray(p.categories) ? p.categories[0]?.category_name || "" : "",
      })),
    );
    if (batch.length < 100) break;
    offset += 100;
  }
  return products;
}

async function fetchCafe24OrderSales(token, startDate, endDate) {
  const sales = new Map();
  let offset = 0;
  while (token) {
    const data = await cafe24Fetch(
      `/api/v2/admin/orders?start_date=${startDate}&end_date=${endDate}&limit=100&offset=${offset}&embed=items`,
      token,
    );
    const batch = data.orders || [];
    for (const order of batch) {
      const orderDate = String(order.ordered_date || order.order_date || "").slice(0, 10);
      for (const item of order.items || []) {
        const sku = item.product_code;
        const qty = num(item.actual_quantity) || Math.max(0, num(item.quantity) - num(item.claim_quantity)) || num(item.quantity);
        const revenue = lineItemRevenue(item);
        const patch = {
          name: item.product_name || "",
          cafe24Qty90: orderDate >= daysAgo(90) ? qty : 0,
          cafe24Qty30: orderDate >= daysAgo(30) ? qty : 0,
          cafe24Qty14: orderDate >= daysAgo(14) ? qty : 0,
          rev90: orderDate >= daysAgo(90) ? revenue : 0,
          channels: orderDate >= daysAgo(90) ? { cafe24: qty } : {},
        };
        addSales(sales, sku, patch);
      }
    }
    if (batch.length < 100) break;
    offset += 100;
  }
  return sales;
}

function findOptionCode(optionMap, kakaoSku, option) {
  const cleaned = String(option || "").replace(/^[^:：]+[:：]\s*/, "").trim();
  if (!kakaoSku || !cleaned) return null;
  const exact = optionMap.get(`${kakaoSku}|${cleaned}`);
  if (exact) return exact;
  for (const [key, value] of optionMap) {
    const [keySku, keyOption] = key.split("|");
    if (keySku !== kakaoSku) continue;
    if (keyOption.includes(cleaned) || cleaned.includes(keyOption)) return value;
  }
  return null;
}

function inferCurrentKakaoSku(productName, optionText) {
  const cleanOption = String(optionText || "")
    .replace(/^[^:：]+[:：]\s*/, "")
    .split(",")[0]
    .replace(/\s*\/\s*각인문구:.*/, "")
    .trim();
  for (const [pattern, sku] of Object.entries(CURRENT_KAKAO_SKU_OVERRIDES)) {
    const [productPattern, optionPattern] = pattern.split("|");
    if (!productName.includes(productPattern)) continue;
    if (optionPattern && !cleanOption.includes(optionPattern)) continue;
    return sku;
  }
  return CURRENT_KAKAO_SKU_OVERRIDES[cleanOption] || null;
}

async function main() {
  const { data: rows, error } = await db
    .from("kv_store")
    .select("key,data,updated_at")
    .or(
      "key.eq.paulvice_inventory_v1,key.eq.paulvice_manual_products_v1,key.eq.kakao_gift_sku_map,key.like.channel_upload:%,key.like.kakao_gift_po:%,key.eq.cafe24_refresh_token",
    );
  if (error) throw error;

  const kv = Object.fromEntries(rows.map((row) => [row.key, row]));
  const inventory = kv.paulvice_inventory_v1?.data || {};
  const mappings = kv.kakao_gift_sku_map?.data?.mappings || [];
  const mappedCodes = new Set(mappings.map((m) => m.cafe24Code).filter(Boolean));
  const nameToKakao = new Map();
  const singleMap = new Map();
  const optionMap = new Map();

  for (const m of mappings) {
    if (m.kakaoName) nameToKakao.set(m.kakaoName, m.kakaoSku);
    if (m.optionText) optionMap.set(`${m.kakaoSku}|${m.optionText}`, m.cafe24Code);
    else singleMap.set(m.kakaoSku, m.cafe24Code);
  }

  const sales = new Map();
  const channelUploads = {};
  for (const row of rows.filter((r) => r.key.startsWith("channel_upload:"))) {
    const channel = row.key.slice("channel_upload:".length);
    const uploads = normalizeUpload(row.data);
    channelUploads[channel] = {
      uploads: uploads.length,
      updated_at: row.updated_at,
      files: uploads.map((u) => ({ fileName: u.fileName, period: u.period, rowCount: u.rowCount })),
    };
    for (const upload of uploads) {
      const periodStart = upload.period?.start || "0000-00-00";
      const periodEnd = upload.period?.end || "";
      const recent90 = periodStart >= daysAgo(90) || periodEnd >= daysAgo(90);
      const recent30 = periodStart >= daysAgo(30) || periodEnd >= daysAgo(30);
      const recent14 = periodStart >= daysAgo(14) || periodEnd >= daysAgo(14);
      for (const product of upload.data?.topProducts || []) {
        let sku = String(product.sku || "");
        if (channel === "kakao_gift") {
          sku = singleMap.get(sku) || "";
          if (!sku) continue;
        }
        const sold = num(product.sold);
        const revenue = num(product.revenue);
        addSales(sales, sku, {
          name: product.name || "",
          sold90: recent90 ? sold : 0,
          sold30: recent30 ? sold : 0,
          sold14: recent14 ? sold : 0,
          rev90: recent90 ? revenue : 0,
          channels: recent90 ? { [channel]: sold } : {},
        });
      }
    }
  }

  const poAgg = new Map();
  let poFiles = 0;
  let poOrders = 0;
  let poQty = 0;
  for (const row of rows.filter((r) => /^kakao_gift_po:\d/.test(r.key))) {
    const po = row.data;
    poFiles += 1;
    for (const order of po.orders || []) {
      poOrders += 1;
      const qty = num(order.qty) || 1;
      poQty += qty;
      const kakaoSku = nameToKakao.get(order.product);
      const code =
        findOptionCode(optionMap, kakaoSku, order.option) ||
        singleMap.get(kakaoSku) ||
        inferCurrentKakaoSku(order.product || "", order.option || "") ||
        null;
      const key = code || `UNMAPPED:${order.product}|${order.option || ""}`;
      const agg = poAgg.get(key) || {
        sku: code,
        name: order.product || "",
        option: String(order.option || "").replace(/^[^:：]+[:：]\s*/, "").trim(),
        qty90: 0,
        qty30: 0,
        qty14: 0,
        orders90: 0,
        orders30: 0,
        orders14: 0,
      };
      if (po.date >= daysAgo(90)) {
        agg.qty90 += qty;
        agg.orders90 += 1;
      }
      if (po.date >= daysAgo(30)) {
        agg.qty30 += qty;
        agg.orders30 += 1;
      }
      if (po.date >= daysAgo(14)) {
        agg.qty14 += qty;
        agg.orders14 += 1;
      }
      poAgg.set(key, agg);
      if (code) {
        addSales(sales, code, {
          name: order.product || "",
          kakaoQty90: po.date >= daysAgo(90) ? qty : 0,
          kakaoQty30: po.date >= daysAgo(30) ? qty : 0,
          kakaoQty14: po.date >= daysAgo(14) ? qty : 0,
          channels: po.date >= daysAgo(90) ? { kakao_po: qty } : {},
        });
      }
    }
  }

  let products = [];
  let cafe24Sales = new Map();
  const tokenRow = kv.cafe24_refresh_token?.data;
  const token = typeof tokenRow === "object" ? tokenRow.access_token : null;
  if (token) {
    products = await fetchCafe24Products(token);
    cafe24Sales = await fetchCafe24OrderSales(token, daysAgo(90), asOf);
    for (const [sku, value] of cafe24Sales) addSales(sales, sku, value);
  }

  const productBySku = new Map(products.map((p) => [p.sku, p]));
  const candidates = [];
  for (const [sku, entry] of Object.entries(inventory)) {
    if (entry.discontinued) continue;
    const product = productBySku.get(sku) || { sku, name: "", category: "", price: 0 };
    const s = sales.get(sku) || {
      name: "",
      sold90: 0,
      sold30: 0,
      sold14: 0,
      cafe24Qty90: 0,
      cafe24Qty30: 0,
      cafe24Qty14: 0,
      kakaoQty90: 0,
      kakaoQty30: 0,
      kakaoQty14: 0,
      rev90: 0,
      channels: {},
    };
    const totalSoldForStock = (s.sold90 || 0) + (s.cafe24Qty90 || 0) + (s.kakaoQty90 || 0);
    const currentStock = Math.max(
      0,
      num(entry.initialStock) + num(entry.manualAdjustment) - totalSoldForStock - num(entry.dutyfreeOut),
    );
    const daysInStock = Math.floor(
      (today.getTime() - new Date(`${entry.stockInDate || asOf}T00:00:00+09:00`).getTime()) / 86400000,
    );
    const category = entry.categoryOverride || product.category || "";
    const uploaded =
      mappedCodes.has(sku) ||
      Object.values(CURRENT_KAKAO_SKU_OVERRIDES).includes(sku) ||
      (s.kakaoQty90 || 0) > 0 ||
      (s.channels?.kakao_gift || 0) > 0;
    const qty90 = (s.sold90 || 0) + (s.cafe24Qty90 || 0) + (s.kakaoQty90 || 0);
    const qty30 = (s.sold30 || 0) + (s.cafe24Qty30 || 0) + (s.kakaoQty30 || 0);
    const qty14 = (s.sold14 || 0) + (s.cafe24Qty14 || 0) + (s.kakaoQty14 || 0);
    const stockScore = Math.min(currentStock, 30) * 1.2;
    const velocityScore = qty30 * 3 + qty14 * 2 + qty90 * 0.35;
    const agingScore = daysInStock >= 365 ? 10 : daysInStock >= 180 ? 6 : 0;
    const categoryScore = /주얼|jewel/i.test(category) ? 5 : /워치|watch/i.test(category) ? 4 : 0;
    candidates.push({
      sku,
      name: product.name || s.name || sku,
      category,
      price: product.price || 0,
      initialStock: num(entry.initialStock),
      currentStock,
      stockInDate: entry.stockInDate || "",
      daysInStock,
      qty90,
      qty30,
      qty14,
      cafe24Qty30: s.cafe24Qty30 || 0,
      kakaoQty30: s.kakaoQty30 || 0,
      otherQty30: s.sold30 || 0,
      channels90: s.channels || {},
      uploaded,
      score: Math.round(stockScore + velocityScore + agingScore + categoryScore),
      notes: entry.notes || "",
    });
  }

  candidates.sort((a, b) => b.score - a.score);

  const output = {
    asOf,
    sourceFreshness: {
      inventoryUpdatedAt: kv.paulvice_inventory_v1?.updated_at,
      kakaoUploadUpdatedAt: kv["channel_upload:kakao_gift"]?.updated_at,
      kakaoMapEntries: mappings.length,
      cafe24Products: products.length,
    },
    counts: {
      inventorySkus: Object.keys(inventory).length,
      candidatePool: candidates.filter((c) => !c.uploaded && c.currentStock > 0).length,
      currentKakaoSkus: candidates.filter((c) => c.uploaded).length,
      poFiles,
      poOrders,
      poQty,
    },
    channelUploads,
    currentKakao: candidates
      .filter((c) => c.uploaded)
      .sort((a, b) => b.qty30 - a.qty30 || b.currentStock - a.currentStock)
      .slice(0, 40),
    topCandidates: candidates
      .filter((c) => !c.uploaded && c.currentStock > 0)
      .slice(0, 40),
    watchJewelryCandidates: candidates
      .filter((c) => !c.uploaded && c.currentStock > 0 && /주얼|jewel|워치|watch/i.test(`${c.category} ${c.name}`))
      .slice(0, 40),
    unmappedKakaoPo: [...poAgg.values()]
      .filter((v) => !v.sku)
      .sort((a, b) => b.qty30 - a.qty30 || b.qty90 - a.qty90)
      .slice(0, 30),
    zeroStockNotUploaded: candidates
      .filter((c) => !c.uploaded && c.currentStock <= 0)
      .sort((a, b) => b.qty30 - a.qty30)
      .slice(0, 30),
  };

  if (process.argv.includes("--aging-jewelry")) {
    const jewelry = candidates.filter(
      (c) =>
        !c.uploaded &&
        c.currentStock > 0 &&
        /주얼|귀걸이|목걸이|팔찌|반지|이어커프|링|펜던트|진주|큐빅|원석|하트/i.test(`${c.category} ${c.name}`),
    );
    const slow = jewelry
      .filter((c) => c.qty90 <= 1)
      .sort((a, b) => b.currentStock - a.currentStock || b.daysInStock - a.daysInStock);
    const lightSignal = jewelry
      .filter((c) => c.qty90 > 1 && c.qty30 <= 2)
      .sort((a, b) => b.currentStock - a.currentStock || b.qty90 - a.qty90);
    const highStock = jewelry
      .filter((c) => c.currentStock >= 20)
      .sort((a, b) => b.currentStock - a.currentStock || a.qty90 - b.qty90);
    console.log(
      JSON.stringify(
        {
          asOf,
          sourceFreshness: output.sourceFreshness,
          currentKakaoLowStock: output.currentKakao.filter((c) => c.currentStock <= 5),
          agingJewelry: {
            definition: "not currently inferred as Kakao-listed, currentStock > 0, jewelry-like name/category",
            slowOrNoSales90d: slow.slice(0, 60),
            lightSalesButUsableSignal: lightSignal.slice(0, 30),
            highStockJewelry: highStock.slice(0, 40),
          },
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
