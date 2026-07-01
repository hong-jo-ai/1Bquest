/**
 * 외부 채널(무신사·29CM·W컨셉) 상품평 수집 → channel_reviews.
 * 공개 상품페이지의 리뷰 API에서 긁어와 자사몰 product_no로 매칭 저장. 출처(channel) 표기.
 * 현재: 무신사(폴바이스) 구현. 29CM·W컨셉은 각 API 정찰 후 추가.
 *
 * 실행: node channelReviewScrape.js [musinsa]
 */
const fs = require("fs");
const path = require("path");
for (const f of [".env.local", ".env.supabase"]) {
  try { for (const l of fs.readFileSync(path.join(__dirname, "..", f), "utf8").split("\n")) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) { let v = m[2].trim().replace(/^["']|["']$/g, ""); if (!(m[1] in process.env)) process.env[m[1]] = v; }
  } } catch {}
}
const { createClient } = require(path.join(__dirname, "..", "node_modules", "@supabase/supabase-js"));
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const MSS_IMG = "https://image.msscdn.net";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJson(url, origin) {
  const h = { "User-Agent": UA, "Accept": "application/json" };
  if (origin) { h["Origin"] = origin; h["Referer"] = origin + "/"; }
  const r = await fetch(url, { headers: h });
  return r.json();
}

// ── 자사몰 상품 매칭 ─────────────────────────────────────────────
function norm(s) {
  return String(s || "").toLowerCase()
    .replace(/폴바이스|paul\s*vice/gi, "")
    .replace(/\bpv[0-9a-z]+\b/gi, "")      // SKU 코드 제거(PV903RG 등)
    .replace(/[^가-힣a-z0-9]/g, "");
}
function bigrams(s) { const o = new Set(); for (let i = 0; i < s.length - 1; i++) o.add(s.slice(i, i + 2)); return o; }
function jaccard(a, b) {
  const A = bigrams(a), B = bigrams(b); if (!A.size || !B.size) return 0;
  let inter = 0; for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}
function matchProduct(goodsName, products) {
  const core = norm(String(goodsName).split(" - ")[0]) || norm(goodsName);
  const model = norm(String(goodsName).trim().split(/\s+/)[0]); // 첫 단어(모델명)
  let best = null, score = 0, modelBest = null, modelScore = -1;
  for (const p of products) {
    const pn = norm(p.product_name);
    const s = jaccard(core, pn);
    if (s > score) { score = s; best = p; }
    // 모델명(≥2자)이 자사몰 상품명에 포함되면 폴백 후보
    if (model.length >= 2 && pn.includes(model) && s > modelScore) { modelScore = s; modelBest = p; }
  }
  if (score >= 0.45) return { ...best, _score: score };
  if (modelBest) return { ...modelBest, _score: modelScore, _by: "model" }; // 모델명 매칭 폴백
  return null;
}

async function loadCafe24Products() {
  const { data } = await db.from("kv_store").select("data").eq("key", "cafe24_refresh_token").maybeSingle();
  const at = data.data.access_token, mall = process.env.CAFE24_MALL_ID;
  const H = { Authorization: `Bearer ${at}`, "X-Cafe24-Api-Version": "2026-03-01" };
  let all = [], offset = 0;
  for (let p = 0; p < 20; p++) {
    const r = await getJsonAuth(`https://${mall}.cafe24api.com/api/v2/admin/products?limit=100&offset=${offset}&fields=product_no,product_name`, H);
    const arr = r.products || []; if (!arr.length) break;
    all = all.concat(arr); offset += 100; if (arr.length < 100) break;
  }
  return all;
}
async function getJsonAuth(url, H) { const r = await fetch(url, { headers: H }); return r.json(); }

// ── 무신사 ───────────────────────────────────────────────────────
async function musinsaGoods(brand) {
  let all = [];
  for (let page = 1; page <= 10; page++) {
    const d = await getJson(`https://api.musinsa.com/api2/dp/v2/plp/goods?brand=${brand}&sortCode=POPULAR&size=100&page=${page}&caller=FLAGSHIP&gf=A`);
    const list = d && d.data && d.data.list; if (!list || !list.length) break;
    all = all.concat(list.map((g) => ({ goodsNo: g.goodsNo, goodsName: g.goodsName, reviewCount: g.reviewCount || 0, reviewScore: g.reviewScore })));
    if (list.length < 100) break;
    await sleep(200);
  }
  return all;
}
async function musinsaReviews(goodsNo) {
  let out = [];
  for (let page = 0; page < 60; page++) {
    const d = await getJson(`https://goods.musinsa.com/api2/review/v1/view/list?page=${page}&pageSize=20&goodsNo=${goodsNo}&sort=up_cnt_desc&selectedSimilarNo=${goodsNo}&myFilter=false&hasPhoto=false&isExperience=false`);
    const list = d && d.data && d.data.list; if (!list || !list.length) break;
    out = out.concat(list);
    const total = (d.data && d.data.totalCount) || 0;
    if (out.length >= total || list.length < 20) break;
    await sleep(300);
  }
  return out;
}
function mapMusinsaReview(r, g, prod) {
  const photos = (r.images || []).map((im) => {
    const u = im.imageUrl || ""; return u.startsWith("http") ? u : MSS_IMG + u;
  }).filter(Boolean);
  return {
    channel: "musinsa",
    channel_review_id: String(r.no),
    channel_goods_no: String(g.goodsNo),
    channel_goods_name: g.goodsName,
    product_no: prod ? prod.product_no : null,
    mall: "paulvice_kr",
    rating: Number(r.grade) || null,
    content: (r.content || "").trim(),
    author: (r.userProfileInfo && r.userProfileInfo.userNickName) || "무신사 구매자",
    photos,
    review_date: r.createDate || null,
  };
}

async function scrapeMusinsa(products) {
  const goods = await musinsaGoods("paulvice");
  const withRev = goods.filter((g) => g.reviewCount > 0);
  console.log(`무신사 상품 ${goods.length}개, 리뷰 있는 상품 ${withRev.length}개`);
  let total = 0, matchedGoods = 0;
  for (const g of withRev) {
    const prod = matchProduct(g.goodsName, products);
    let reviews;
    try { reviews = await musinsaReviews(g.goodsNo); } catch (e) { console.log(`  ⚠️ ${g.goodsNo} 리뷰수집 실패: ${e.message}`); continue; }
    const rows = reviews.map((r) => mapMusinsaReview(r, g, prod)).filter((x) => x.content || x.photos.length);
    if (rows.length) {
      // 200개씩 나눠 upsert
      for (let i = 0; i < rows.length; i += 200) {
        const { error } = await db.from("channel_reviews").upsert(rows.slice(i, i + 200), { onConflict: "channel,channel_review_id" });
        if (error) console.log(`  ⚠️ upsert 오류: ${error.message}`);
      }
      total += rows.length; if (prod) matchedGoods++;
    }
    console.log(`  ${g.goodsName.slice(0, 34).padEnd(34)} → 리뷰 ${String(rows.length).padStart(3)} ${prod ? `✓#${prod.product_no}(${prod._score.toFixed(2)})` : "✗미매칭"}`);
    await sleep(400);
  }
  console.log(`\n무신사 완료: 리뷰 ${total}건 저장, 매칭 ${matchedGoods}/${withRev.length}상품`);
}

// ── W컨셉 (브라우저 기반: API가 x-authorization 토큰 + 상품메타 필요) ──────
const WC_BRAND = process.env.WCONCEPT_BRAND_CD || "102136"; // 폴바이스
function mapWconceptReview(r, g, prod) {
  const photos = (r.reviewFiles || []).filter((f) => f.filePath && (f.fileType === 1 || !f.fileType)).map((f) => f.filePath);
  return {
    channel: "wconcept",
    channel_review_id: String(r.reviewMasterSeqNo),
    channel_goods_no: String(g.itemCd),
    channel_goods_name: g.itemName,
    product_no: prod ? prod.product_no : null,
    mall: "paulvice_kr",
    rating: Number(r.reviewRating) || null,
    content: (r.contents || "").trim(),
    author: r.custId || "W컨셉 구매자",
    photos,
    review_date: r.reviewRegDate ? r.reviewRegDate.replace(" ", "T") + "+09:00" : null,
  };
}
async function scrapeWconcept(products) {
  const { chromium } = require(path.join(__dirname, "node_modules", "playwright"));
  const REV_URL = "https://gw-backend.wconcept.co.kr/api/v2/review/tab/list/with-summary";
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ userAgent: UA });
  try {
    // 1) 브랜드 상품 나열(브라우저에서 응답 가로채기)
    const collected = [];
    const brandHandler = async (resp) => {
      if (/brand\/v2\/brand\/\d+\/products/i.test(resp.url())) {
        try { const j = await resp.json(); if (j && j.data && j.data.content) collected.push(...j.data.content); } catch {}
      }
    };
    page.on("response", brandHandler);
    await page.goto(`https://display.wconcept.co.kr/rn/brand/${WC_BRAND}`, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(4000);
    for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, 3000).catch(() => {}); await page.waitForTimeout(1600); }
    page.off("response", brandHandler);
    const goods = [...new Map(collected.map((c) => [String(c.itemCd), { itemCd: String(c.itemCd), itemName: c.itemName, reviewCnt: c.reviewCnt || 0 }])).values()];
    const withRev = goods.filter((g) => g.reviewCnt > 0);
    console.log(`W컨셉 상품 ${goods.length}개, 리뷰 있는 상품 ${withRev.length}개`);

    let token = null, total = 0, matchedGoods = 0;
    const seen = new Set(); // W컨셉이 같은 상품을 여러 itemCd(변형)로 등록 + 리뷰 복제 → (상품+내용+작성자) 중복 제거
    for (const g of withRev) {
      let reqBody = null, first = null;
      const revHandler = async (resp) => {
        if (/review\/tab\/list\/with-summary/i.test(resp.url())) {
          try { reqBody = JSON.parse(resp.request().postData() || "{}"); if (!token) token = resp.request().headers()["x-authorization"]; first = await resp.json(); } catch {}
        }
      };
      page.on("response", revHandler);
      await page.goto(`https://www.wconcept.co.kr/Product/${g.itemCd}`, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
      await page.waitForTimeout(3000);
      for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, 2500).catch(() => {}); await page.waitForTimeout(1000); }
      for (const sel of ['text=리뷰', 'button:has-text("리뷰")', 'a:has-text("리뷰")']) { try { const el = page.locator(sel).first(); if (await el.count()) { await el.click({ timeout: 2500 }); await page.waitForTimeout(2000); break; } } catch {} }
      await page.waitForTimeout(1500);
      page.off("response", revHandler);
      if (!reqBody || !first || !first.data) { console.log(`  ${g.itemName.slice(0, 30).padEnd(30)} → 요청 못잡음`); await sleep(300); continue; }

      let reviews = first.data.reviews || [];
      const totalPages = first.data.reviewTotalPages || 1;
      const size = reqBody.pageSize || 10;
      for (let p = 2; p <= totalPages && p <= 40; p++) {
        const b = { ...reqBody, pageNo: p, pageSize: size };
        const j = await fetch(REV_URL, { method: "POST", headers: { "Content-Type": "application/json", "X-Authorization": token, "Origin": "https://www.wconcept.co.kr", "User-Agent": UA }, body: JSON.stringify(b) }).then((r) => r.json()).catch(() => null);
        if (j && j.data && j.data.reviews) reviews.push(...j.data.reviews); else break;
        await sleep(300);
      }
      const prod = matchProduct(g.itemName, products);
      const rows = [...new Map(reviews.map((r) => [String(r.reviewMasterSeqNo), r])).values()].map((r) => mapWconceptReview(r, g, prod)).filter((x) => x.content || x.photos.length).filter((x) => {
        const k = (x.product_no ?? "x") + "|" + x.content + "|" + x.author;
        if (seen.has(k)) return false; seen.add(k); return true;
      });
      if (rows.length) {
        for (let i = 0; i < rows.length; i += 200) {
          const { error } = await db.from("channel_reviews").upsert(rows.slice(i, i + 200), { onConflict: "channel,channel_review_id" });
          if (error) console.log(`  ⚠️ upsert: ${error.message}`);
        }
        total += rows.length; if (prod) matchedGoods++;
      }
      console.log(`  ${g.itemName.slice(0, 30).padEnd(30)} → 리뷰 ${String(rows.length).padStart(3)} ${prod ? `✓#${prod.product_no}` : "✗미매칭"}`);
      await sleep(400);
    }
    console.log(`\nW컨셉 완료: 리뷰 ${total}건 저장, 매칭 ${matchedGoods}/${withRev.length}상품`);
  } finally { await browser.close().catch(() => {}); }
}

// ── 29CM (오픈 GET API, 리뷰 적음) ───────────────────────────────
const CM29_BRAND = process.env.CM29_FRONT_BRAND_NO || "116837"; // 폴바이스
async function cm29Goods() {
  let all = [];
  for (let page = 1; page <= 10; page++) {
    const d = await getJson(`https://search-api.29cm.co.kr/api/v4/products/brand?frontBrandNo=${CM29_BRAND}&page=${page}&size=100`, "https://www.29cm.co.kr");
    const arr = Array.isArray(d.data) ? d.data : (d.data && (d.data.products || d.data.content || d.data.items)) || [];
    if (!arr.length) break;
    all = all.concat(arr.map((g) => ({ itemNo: String(g.itemNo), itemName: g.itemName, reviewCount: g.reviewCount || 0 })));
    if (arr.length < 100) break;
    await sleep(200);
  }
  return all;
}
async function cm29Reviews(itemNo) {
  let out = [];
  for (let page = 0; page < 30; page++) {
    const d = await getJson(`https://review-api.29cm.co.kr/api/v4/reviews?itemId=${itemNo}&page=${page}&size=100&sort=BEST`, "https://www.29cm.co.kr");
    const arr = (d.data && d.data.results) || [];
    if (!arr.length) break;
    out = out.concat(arr);
    const total = (d.data && d.data.count) || 0;
    if (out.length >= total || arr.length < 100) break;
    await sleep(250);
  }
  return out;
}
function mapCm29Review(r, g, prod) {
  const photos = (r.uploadFiles || []).map((f) => (typeof f === "string" ? f : f.url || f.fileUrl || f.imageUrl || f.thumbnailUrl || "")).filter(Boolean);
  let date = null; const t = r.insertTimestamp; if (t) date = typeof t === "number" ? new Date(t).toISOString() : String(t);
  return {
    channel: "29cm", channel_review_id: String(r.itemReviewNo), channel_goods_no: String(g.itemNo),
    channel_goods_name: g.itemName, product_no: prod ? prod.product_no : null, mall: "paulvice_kr",
    rating: Number(r.point) || null, content: (r.contents || "").trim(), author: r.userId || "29CM 구매자", photos, review_date: date,
  };
}
async function scrape29cm(products) {
  const goods = await cm29Goods();
  const withRev = goods.filter((g) => g.reviewCount > 0);
  console.log(`29CM 상품 ${goods.length}개, 리뷰 있는 상품 ${withRev.length}개`);
  let total = 0, matchedGoods = 0;
  for (const g of withRev) {
    const prod = matchProduct(g.itemName, products);
    let reviews; try { reviews = await cm29Reviews(g.itemNo); } catch (e) { console.log(`  ⚠️ ${g.itemNo}: ${e.message}`); continue; }
    const rows = reviews.filter((r) => !r.isBlind).map((r) => mapCm29Review(r, g, prod)).filter((x) => x.content || x.photos.length);
    if (rows.length) {
      const { error } = await db.from("channel_reviews").upsert(rows, { onConflict: "channel,channel_review_id" });
      if (error) console.log(`  ⚠️ upsert: ${error.message}`);
      total += rows.length; if (prod) matchedGoods++;
    }
    console.log(`  ${g.itemName.slice(0, 30).padEnd(30)} → 리뷰 ${String(rows.length).padStart(3)} ${prod ? `✓#${prod.product_no}` : "✗미매칭"}`);
    await sleep(300);
  }
  console.log(`\n29CM 완료: 리뷰 ${total}건, 매칭 ${matchedGoods}/${withRev.length}상품`);
}

(async () => {
  const which = process.argv[2] || "musinsa";
  console.log("자사몰 상품 로딩...");
  const products = await loadCafe24Products();
  console.log(`자사몰 상품 ${products.length}개 로딩`);
  if (which === "musinsa" || which === "all") await scrapeMusinsa(products);
  if (which === "wconcept" || which === "all") await scrapeWconcept(products);
  if (which === "29cm" || which === "all") await scrape29cm(products);
  process.exit(0);
})().catch((e) => { console.error("ERR", e.stack || e.message); process.exit(1); });
