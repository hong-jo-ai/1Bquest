/**
 * 해리엇 글로벌몰 이전 — 식스샵 옛 URL → cafe24 shop2 301 리다이렉트 일괄 등록.
 * cafe24 redirects API(POST /api/v2/admin/redirects). 심사 승인된 harriot 앱 토큰 사용.
 *
 * 규칙(2026-07-22 실측):
 *  - path(옛경로): 맨 앞 '/', 영문·숫자·'_'·'/'만. 하이픈('-')·점('.') 거부 → 해당 URL은 스킵(로그).
 *  - target(새주소): 전체 URL 필수(HARRIOT_REDIRECT_TARGET_BASE, 기본 https://harriotwatches.com).
 *  - redirect_type: 301. shop_no: 2. 레이트리밋 ≤2/초 → 600ms 간격.
 *  - 멱등: 기존 등록 path 는 스킵. 리다이렉트는 도메인이 cafe24 가리킬 때(컷오버) 활성.
 *
 * 사용: node harriotGlobalRedirects.js            (DRY — 미리보기)
 *       node harriotGlobalRedirects.js --apply    (실제 등록)
 *  매핑 근거 = docs/harriot-global-migration/301-map-draft.md
 */
const fs = require("fs"), path = require("path");
const DASH = path.resolve(__dirname, "..");
function le(p){try{for(const l of fs.readFileSync(p,"utf8").split("\n")){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);if(!m)continue;let v=m[2].trim().replace(/^["']|["']$/g,"");if(!(m[1] in process.env))process.env[m[1]]=v;}}catch{}}
require("dotenv").config({ path: __dirname + "/.env", override: true });
le(DASH + "/.env.supabase"); le(DASH + "/.env.local");
const { createClient } = require(DASH + "/node_modules/@supabase/supabase-js");
const MALL = process.env.HARRIOT_CAFE24_MALL_ID, BASE = `https://${MALL}.cafe24api.com`;
const TB = (process.env.HARRIOT_REDIRECT_TARGET_BASE || "https://harriotwatches.com").replace(/\/$/, "");
const APPLY = process.argv.includes("--apply");
const sleep = ms => new Promise(r => setTimeout(r, ms));

const P = no => `${TB}/product/detail.html?product_no=${no}`;   // 상품
const C = no => `${TB}/product/list.html?cate_no=${no}`;        // 카테고리
const B = no => `${TB}/board/free/read.html?no=${no}&board_no=5`; // ⚠️ 게시판 글 URL 형식은 컷오버 때 실측 확인
const HOME = `${TB}/`;

// [옛 path, 새 target] — 근거: 301-map-draft.md
const MAP = [
  // ── 상품 25 (하이픈 UUID 1건은 자동 스킵) ──
  ["/product/20metalstrap", P(132)], ["/product/20mmblackleatherstrap", P(125)], ["/product/20mmbrownleatherstrap", P(127)],
  ["/product/black", P(121)], ["/product/jade", P(122)], ["/product/white", P(123)],
  ["/product/brownleatherband", P(127)], ["/product/f9af07c0-0aa1-48a4-bae7-38f7a17c692e", P(125)],
  ["/product/dobo", P(120)], ["/product/dobo_lady", P(120)],
  ["/product/ilgu_black", P(101)], ["/product/ilgu_black_30mm", P(101)],
  ["/product/ilgu_brown", P(102)], ["/product/ilgu_brown_30mm", P(103)],
  ["/product/ilgu_cobalt", P(104)], ["/product/ilgu_cobalt_30mm", P(105)],
  ["/product/seohae_rosegold", P(98)], ["/product/seohae_silver", P(99)], ["/product/seohae_sunray", P(100)],
  ["/product/seongsan_rosegold_32mm", P(93)], ["/product/seongsan_rosegold_40mm", P(93)],
  ["/product/seongsan_silver", P(94)], ["/product/seongsan_silver_32mm", P(95)],
  ["/product/seongsan_sunray_32mm", P(97)], ["/product/seongsan_sunray_40mm", P(96)],
  // ── 모델/컬렉션 랜딩 7 → 카테고리 ──
  ["/kiwon", C(42)], ["/seongsan", C(54)], ["/seohae", C(55)], ["/ilgu", C(53)], ["/dobo", C(58)], ["/kari", C(59)], ["/straps", C(44)],
  // ── 블로그 18 → board5 글 (하이픈 6건은 자동 스킵) ──
  ["/blogPost/Introducing-Harriots-First-Diver-Watch", B(25)], ["/blogPost/interview1", B(10)],
  ["/blogPost/madeinkorea", B(11)], ["/blogPost/madeinkorea2", B(12)], ["/blogPost/sungwoo", B(13)],
  ["/blogPost/amitech", B(14)], ["/blogPost/fair", B(15)], ["/blogPost/dobo", B(16)],
  ["/blogPost/watch_for_grandfather", B(17)], ["/blogPost/letterfromsungjo", B(18)], ["/blogPost/kiwon", B(19)],
  ["/blogPost/untitled-15", B(20)], ["/blogPost/untitled-16", B(21)],
  ["/blogPost/korean-american-kiwon-watch-story", B(22)], ["/blogPost/harriot-kiwon-korean-watch-review", B(23)],
  ["/blogPost/watch-for-husbands-with-korean-wife", B(24)],
  ["/blogPost/challenge", HOME], ["/blogPost/kari", HOME], ["/blog", HOME],
  // ── 리뷰 13 → 홈(상품 128776 미식별) ──
  ...Array.from({length:13},(_,i)=>[`/productReview/128776/${i+1}`, HOME]),
  // ── 정보/유틸 ──
  ["/about", HOME], ["/story", HOME], ["/contact", HOME], ["/termsandconditions", HOME],
  ["/", HOME], ["/home", HOME], ["/footer", HOME], ["/untitled-2", HOME], ["/untitled-3", HOME],
];

const badPath = p => !/^\/[A-Za-z0-9_/]*$/.test(p); // 하이픈·점 등 불허 문자 포함

async function token(sb){ const {data}=await sb.from("kv_store").select("data").eq("key","cafe24_refresh_token:harriot").maybeSingle(); return data.data.access_token; }

(async () => {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const tk = await token(sb);
  const H = { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" };
  // 기존 등록 path (멱등)
  const cur = await (await fetch(`${BASE}/api/v2/admin/redirects?shop_no=2&limit=500`, { headers: H })).json();
  const exist = new Set((cur.redirects || []).map(r => r.path));
  console.log(`대상 ${MAP.length}건 | 기존등록 ${exist.size}건 | target base=${TB} | ${APPLY ? "APPLY(실등록)" : "DRY(미리보기)"}`);

  let ok=0, skipHyphen=0, skipDup=0, fail=0; const skipped=[];
  for (const [p, target] of MAP) {
    if (badPath(p)) { skipHyphen++; skipped.push(p); continue; }
    if (exist.has(p)) { skipDup++; continue; }
    if (!APPLY) { console.log(`  + ${p}  →  ${target}`); ok++; continue; }
    try {
      const r = await fetch(`${BASE}/api/v2/admin/redirects`, { method:"POST", headers:H, body: JSON.stringify({ shop_no:2, request:{ path:p, target, redirect_type:"301" } }) });
      if (r.status < 300) { ok++; console.log(`  ✓ ${p}`); }
      else { fail++; console.log(`  ✗ ${p}: ${r.status} ${(await r.text()).slice(0,120)}`); }
    } catch(e){ fail++; console.log(`  ✗ ${p}: ${e.message}`); }
    await sleep(600); // ≤2/초
  }
  console.log(`\n${APPLY?"등록":"등록예정"} ${ok} / 중복스킵 ${skipDup} / 하이픈스킵 ${skipHyphen} / 실패 ${fail}`);
  if (skipped.length) console.log(`⚠️ 하이픈 미등록(재문의 대기): ${skipped.join(", ")}`);
})().catch(e => { console.error("ERR", e.message); process.exit(1); });
