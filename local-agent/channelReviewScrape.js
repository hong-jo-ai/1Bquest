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
async function getJson(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" } });
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

(async () => {
  const which = process.argv[2] || "musinsa";
  console.log("자사몰 상품 로딩...");
  const products = await loadCafe24Products();
  console.log(`자사몰 상품 ${products.length}개 로딩`);
  if (which === "musinsa" || which === "all") await scrapeMusinsa(products);
  process.exit(0);
})().catch((e) => { console.error("ERR", e.stack || e.message); process.exit(1); });
