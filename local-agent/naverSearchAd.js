/**
 * 네이버 검색광고 API — 키워드 절대 검색량 조회 (2026-08-25 신규).
 *
 * 왜 필요한가:
 *   DataLab(개발자센터)은 상대지수 0~100만 준다. "핑크가 안 팔린다"가 수요 부재인지
 *   노출 부족인지 가르려면 절대 검색수가 필요하다. 그건 검색광고 API에만 있다.
 *
 * 키 발급: searchad.naver.com → 로그인 → 우상단 [도구] → [API 사용 관리]
 *          → 네이버 검색광고 API 등록 → 아래 3개를 local-agent/.env 에 넣는다.
 *            NAVER_AD_CUSTOMER_ID=   (내 정보의 CUSTOMER_ID, 숫자)
 *            NAVER_AD_API_KEY=       (액세스라이선스)
 *            NAVER_AD_SECRET=        (비밀키)
 *   ※ 광고를 집행하지 않아도 계정만 있으면 키워드도구 API는 무료로 쓸 수 있다.
 *
 * 사용:
 *   node naverSearchAd.js check
 *   node naverSearchAd.js status            계정 현황(캠페인·그룹·키워드·비즈머니·30일 성과)
 *   node naverSearchAd.js kw 여성시계 미니멀시계 데일리워치
 *   node naverSearchAd.js kw 여성시계 --json
 */
const crypto = require("crypto");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env"), override: true });
require("dotenv").config({ path: path.join(__dirname, "..", ".env.local"), override: false });

const BASE = "https://api.searchad.naver.com";

function creds() {
  // .env.local 은 NAVER_ADS_*, local-agent/.env 는 NAVER_AD_* 를 쓴다 — 둘 다 받는다.
  const customerId = process.env.NAVER_AD_CUSTOMER_ID || process.env.NAVER_ADS_CUSTOMER_ID;
  const apiKey = process.env.NAVER_AD_API_KEY || process.env.NAVER_ADS_API_KEY;
  const secret = process.env.NAVER_AD_SECRET || process.env.NAVER_ADS_API_SECRET;
  if (!customerId || !apiKey || !secret) {
    throw new Error(
      `네이버 검색광고 키 부족 — CUSTOMER_ID=${customerId?"O":"X"} API_KEY=${apiKey?"O":"X"} SECRET=${secret?"O":"X"}`
    );
  }
  return { customerId, apiKey, secret };
}

/** 서명: base64(HMAC-SHA256(secret, `${ts}.${METHOD}.${path}`)) — 쿼리스트링은 제외한다. */
function sign(ts, method, urlPath, secret) {
  return crypto.createHmac("sha256", secret).update(`${ts}.${method}.${urlPath}`).digest("base64");
}

async function call(method, urlPath, query) {
  const { customerId, apiKey, secret } = creds();
  const ts = Date.now().toString();
  const qs = query ? "?" + new URLSearchParams(query).toString() : "";
  const res = await fetch(`${BASE}${urlPath}${qs}`, {
    method,
    headers: {
      "X-Timestamp": ts,
      "X-API-KEY": apiKey,
      "X-Customer": String(customerId),
      "X-Signature": sign(ts, method, urlPath, secret),
      "Content-Type": "application/json; charset=UTF-8",
    },
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

/** "< 10" 같은 문자열도 숫자로 — 10 미만은 5로 본다(과대추정 방지). */
const n = (v) => (typeof v === "number" ? v : /^\s*<\s*10\s*$/.test(String(v)) ? 5 : Number(String(v).replace(/[^0-9]/g, "")) || 0);

/**
 * 키워드 검색량 조회. 힌트 키워드당 연관 키워드까지 함께 돌려준다.
 * @param {string[]} keywords 최대 5개 (API 제한)
 */
async function keywords(kws) {
  const j = await call("GET", "/keywordstool", {
    hintKeywords: kws.slice(0, 5).join(","),
    showDetail: "1",
  });
  return (j.keywordList || []).map((k) => ({
    keyword: k.relKeyword,
    pc: n(k.monthlyPcQcCnt),
    mobile: n(k.monthlyMobileQcCnt),
    total: n(k.monthlyPcQcCnt) + n(k.monthlyMobileQcCnt),
    comp: k.compIdx || "",
    adCount: n(k.plAvgDepth),
  })).sort((a, b) => b.total - a.total);
}

/** 캠페인/광고그룹/키워드 전체 구조 */
async function tree() {
  const campaigns = await call("GET", "/ncc/campaigns");
  for (const c of campaigns) {
    c.groups = await call("GET", "/ncc/adgroups", { nccCampaignId: c.nccCampaignId });
    for (const g of c.groups) {
      g.keywordList = await call("GET", "/ncc/keywords", { nccAdgroupId: g.nccAdgroupId }).catch(() => []);
    }
  }
  return campaigns;
}

const STAT_FIELDS = ["impCnt", "clkCnt", "salesAmt", "ctr", "cpc", "avgRnk", "ccnt", "convAmt"];

/** 기간 성과. ⚠️ /stats 는 ids(복수)가 아니라 id(단수)만 받는다 — 복수로 주면 11001 에러. */
async function stats(id, since, until) {
  const r = await call("GET", "/stats", {
    id, fields: JSON.stringify(STAT_FIELDS), timeRange: JSON.stringify({ since, until }),
  });
  return (r.data || []).reduce((a, d) => ({
    imp: a.imp + (d.impCnt || 0), clk: a.clk + (d.clkCnt || 0), cost: a.cost + (d.salesAmt || 0),
    conv: a.conv + (d.ccnt || 0), convAmt: a.convAmt + (d.convAmt || 0),
  }), { imp: 0, clk: 0, cost: 0, conv: 0, convAmt: 0 });
}

async function bizmoney() {
  return call("GET", "/billing/bizmoney");
}

const ymd = (d) => d.toISOString().slice(0, 10);
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d); }

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const asJson = rest.includes("--json");
  const args = rest.filter((a) => !a.startsWith("--"));

  if (cmd === "check") {
    creds();
    const r = await call("GET", "/ncc/campaigns");
    console.log(`✅ 인증 성공 — 캠페인 ${Array.isArray(r) ? r.length : 0}개`);
    return;
  }
  if (cmd === "status") {
    const [bm, campaigns] = await Promise.all([bizmoney(), tree()]);
    console.log(`비즈머니 잔액 ${bm.bizmoney.toLocaleString()}원${bm.budgetLock ? " ⚠️예산잠금" : ""}\n`);
    let T = { imp: 0, clk: 0, cost: 0, conv: 0 };
    for (const c of campaigns) {
      const s30 = await stats(c.nccCampaignId, daysAgo(30), daysAgo(1));
      Object.keys(T).forEach((k) => { T[k] += s30[k]; });
      const dead = s30.imp === 0 ? "  ⛔노출0" : "";
      console.log(`■ ${c.name} [${c.campaignTp}] ${c.status} 일예산 ${(c.dailyBudget || 0).toLocaleString()}${dead}`);
      console.log(`   30일: 노출 ${s30.imp.toLocaleString()} · 클릭 ${s30.clk} · 비용 ${Math.round(s30.cost).toLocaleString()}원 · CTR ${(s30.imp ? s30.clk / s30.imp * 100 : 0).toFixed(2)}% · CPC ${s30.clk ? Math.round(s30.cost / s30.clk) : 0}원 · 전환 ${s30.conv}`);
      for (const g of c.groups) {
        console.log(`   └ ${g.name} · 입찰 ${(g.bidAmt || 0).toLocaleString()}원 · 키워드 ${g.keywordList.length}개 · ${g.status}`);
      }
    }
    console.log(`\n합계 30일: 클릭 ${T.clk} · 비용 ${Math.round(T.cost).toLocaleString()}원 · 전환 ${T.conv}`);
    if (T.conv === 0 && T.clk > 50) console.log("⚠️ 클릭은 있는데 전환 0 — 네이버 프리미엄 로그분석(전환추적) 미설치 의심");
    return;
  }
  if (cmd === "kw") {
    if (!args.length) throw new Error("키워드를 하나 이상 주세요");
    const rows = await keywords(args);
    if (asJson) return console.log(JSON.stringify(rows, null, 2));
    console.log(`힌트: ${args.join(", ")} · 연관 ${rows.length}개\n`);
    console.log("키워드                        월간총합     PC    모바일  경쟁도");
    rows.slice(0, 40).forEach((r) =>
      console.log(
        r.keyword.padEnd(26).slice(0, 26),
        String(r.total.toLocaleString()).padStart(9),
        String(r.pc.toLocaleString()).padStart(7),
        String(r.mobile.toLocaleString()).padStart(8),
        "  " + r.comp
      )
    );
    return;
  }
  console.log("사용: node naverSearchAd.js check | status | kw <키워드...> [--json]");
}

if (require.main === module) main().catch((e) => { console.error("ERR", e.message); process.exit(1); });
module.exports = { keywords, call, tree, stats, bizmoney, daysAgo };
