/**
 * 품절임박 배지 + SOLD OUT 테이프 자동 동기화 — 해리엇 + 폴바이스 (iMac launchd, 매일 10:30·16:30)
 *
 * [해리엇] harriotkorea 전 상품 재고 → Supabase review-media/hrt/hrt_scarce.js(국문)·
 *   hrt_scarce_en.js(영문) 업로드. 스킨은 공개 URL 을 <script src> 로 로드(폴바이스와 동일,
 *   SFTP 불필요 — 7일 비번만료 반복 해소). 로더 최초 설치=_hrtLoaderSwap.js(1회). 임계치 ≤10.
 * [폴바이스] icaruse2000 전 상품 재고 → Supabase Storage review-media/pv/pv_badge.js 업로드
 *   (스킨 layout 의 한 줄 로더가 로드. 로직+데이터 일체형 — FTP 불필요.
 *    임계치 차등: 시계 ≤10, 그 외(주얼리·스트랩 등) ≤3. 사장님 확정 2026-07-17)
 *
 * - 카페24 토큰: kv 캐시된 access_token만 사용. 로컬 refresh 금지(SSOT=프로덕션, ops.md).
 *   만료면 해당 몰만 조용히 스킵(지속되면 워치독 감지).
 * - 성공 시 heartbeat `hrt-scarce-sync`, 실패 시 notifyFail.
 *
 * 수동 실행: node hrtScarceSync.js [--dry]
 */
require("dotenv").config({ override: true });
const fs = require("fs");
const path = require("path");
const DASH = path.resolve(__dirname, "..");
function le(p) { try { for (const l of fs.readFileSync(p, "utf8").split("\n")) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (!m) continue; const v = m[2].trim().replace(/^["']|["']$/g, ""); if (!(m[1] in process.env)) process.env[m[1]] = v; } } catch { } }
le(path.join(DASH, ".env.supabase")); le(path.join(DASH, ".env.local")); le(path.join(__dirname, ".env"));
const { createClient } = require(path.join(DASH, "node_modules/@supabase/supabase-js"));

const DRY = process.argv.includes("--dry");
const log = (m, t = "info") => console.log(`[${new Date().toISOString()}][${t}] ${m}`);
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function cachedToken(kvKey) {
  const { data } = await sb.from("kv_store").select("data").eq("key", kvKey).maybeSingle();
  const t = data && data.data;
  if (t && t.access_token && t.expires_at && t.expires_at - 90000 > Date.now()) return t.access_token;
  return null; // 만료 — 로컬 refresh 금지(SSOT=프로덕션)
}

async function fetchAllProducts(base, tok, shopNo) {
  const out = [];
  const sq = shopNo ? `&shop_no=${shopNo}` : "";
  for (let offset = 0; offset < 5000; offset += 100) {
    const r = await fetch(`${base}/api/v2/admin/products?embed=variants&limit=100&offset=${offset}${sq}`, {
      headers: { Authorization: `Bearer ${tok}` }, signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw new Error(`카페24 products HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    const ps = j.products || [];
    out.push(...ps);
    if (ps.length < 100) break;
  }
  return out;
}

function productQty(p) {
  const vs = p.variants || [];
  if (!vs.length) return null;
  return vs.reduce((s, v) => s + (Number(v.quantity) || 0), 0);
}
// 재고 추적(use_inventory=T) 변형만의 수량 합. 추적 변형이 없으면 null(수량 신뢰 불가).
function trackedQty(p) {
  const vs = (p.variants || []).filter((v) => v.use_inventory === "T");
  if (!vs.length) return null;
  return vs.reduce((s, v) => s + (Number(v.quantity) || 0), 0);
}
// 품절 판정 = 카페24 자체 판정(products.sold_out). 수량 필드는 추적 꺼진 상품에서
// 실제 구매가능 여부와 어긋난다(2026-07-17 실측: 폴바이스 수량0인데 구매가능 35개).
function isSoldOut(p) { return p.sold_out === "T"; }

/* ─────────────── 해리엇 ─────────────── */
const HRT_THRESHOLD = Number(process.env.HRT_SCARCE_THRESHOLD || 10);
const HRT_MALL = process.env.HARRIOT_CAFE24_MALL_ID || "harriotkorea";

async function syncHarriot() {
  const tok = await cachedToken("cafe24_refresh_token:harriot");
  if (!tok) { log("[해리엇] access_token 만료 — 스킵", "warn"); return null; }
  const base = `https://${HRT_MALL}.cafe24api.com`;
  // 국문몰(shop1·skin4)·영문몰(shop2·skin5)은 진열/품절 플래그가 shop_no별로 다르다.
  // → 각 몰 데이터를 따로 조회해 각 스킨에 주입(shop1 데이터를 영문몰에 쓰면 shop2 전용 품절 누락).
  const build = (products) => {
    const items = {}, soldout = {};
    for (const p of products) {
      if (p.display !== "T" || p.selling !== "T") continue;
      if (isSoldOut(p)) { soldout[String(p.product_no)] = { name: p.product_name }; continue; }
      // 해리엇은 use_inventory=F여도 quantity를 수동 관리(실측: 기원백색 6→2 감소)하므로 전체 수량 사용
      const qty = productQty(p);
      if (qty === null) continue;
      if (qty > 0 && qty <= HRT_THRESHOLD) items[String(p.product_no)] = { qty, name: p.product_name };
    }
    return { items, soldout };
  };
  const kr = build(await fetchAllProducts(base, tok, 1));   // 국문몰 skin4
  const en = build(await fetchAllProducts(base, tok, 2));   // 영문몰 skin5
  const nos = Object.keys(en.items), soldNos = Object.keys(en.soldout);
  log(`[해리엇] 국문 임박${Object.keys(kr.items).length}/품절${Object.keys(kr.soldout).length} · 영문 임박${nos.length}/품절${soldNos.length} (영문품절: ${soldNos.join(",")})`);
  if (DRY) return { scarce: nos.length, soldout: soldNos.length };

  // PDP SOLD OUT 테이프 애드온 — common.js 번들 캐시와 무관하게 직로드되는 이 파일에서 실행
  // (2026-07-19: 옵티마이저 번들 캐시로 common.js 수정이 늦게 반영되는 문제 우회. 인라인 스타일=CSS 의존 없음)
  const PDP_ADDON = `;(function(){
  var D=window.HRT_SCARCE_DATA||{};var SOLD=D.soldout||{};
  var T='SOLD OUT  SOLD OUT  SOLD OUT  SOLD OUT  SOLD OUT  SOLD OUT  SOLD OUT  SOLD OUT  SOLD OUT  SOLD OUT  SOLD OUT  SOLD OUT';
  function tape(el){
    if(!el||el.querySelector('.hrt2-band'))return;
    if(getComputedStyle(el).position==='static')el.style.position='relative';
    el.style.overflow='hidden';
    for(var i=0;i<2;i++){
      var d=document.createElement('span');d.className='hrt2-band';
      d.style.cssText='position:absolute;left:-25%;width:150%;padding:4.5% 0;z-index:6;pointer-events:none;white-space:nowrap;overflow:hidden;text-align:center;background:#111;color:#fff;font:700 12px/1 Arial,sans-serif;letter-spacing:.28em;box-shadow:0 1px 6px rgba(0,0,0,.25);top:'+(i?'52%':'42%')+';transform:rotate('+(i?'14':'-14')+'deg);'+(i?'opacity:.92;':'');
      d.textContent=T;el.appendChild(d);
    }
  }
  function runPdp(){
    var no=(typeof window.iProductNo!=='undefined')?String(window.iProductNo):null;
    if(!no||!SOLD[no])return;
    var conts=document.querySelectorAll('.xans-product-addimage, .listdiv.RM-product-addimage, .prdImg, .xans-product-image');
    for(var i=0;i<conts.length;i++){
      var c=conts[i];
      if(c.offsetParent===null)continue;
      if(c.getBoundingClientRect().width<150)continue;
      tape(c);return;
    }
    var imgs=document.querySelectorAll('img[src*="/web/product/"]');
    for(var j=0;j<imgs.length;j++){
      var im=imgs[j];
      if(im.offsetParent===null||im.offsetWidth<150)continue;
      if(im.parentElement){tape(im.parentElement);return;}
    }
  }
  function go(){runPdp();setTimeout(runPdp,1500);setTimeout(runPdp,3500);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',go);else go();
})();`;

  // 영문몰(skin5 roma) 전용 애드온 — 컨테이너가 아니라 '메인 상품 이미지'에 직접 오버레이.
  // (skin5는 .xans-product-image가 17357px 거대 래퍼라 컨테이너 방식이 화면 밖으로 나감.)
  const PDP_ADDON_EN = `;(function(){
  var D=window.HRT_SCARCE_DATA||{};var SOLD=D.soldout||{};var ITEMS=D.items||{};
  var T='SOLD OUT  SOLD OUT  SOLD OUT  SOLD OUT  SOLD OUT  SOLD OUT  SOLD OUT  SOLD OUT  SOLD OUT  SOLD OUT  SOLD OUT  SOLD OUT';
  var BADGE='LOW STOCK';
  if(!document.getElementById('hrt-en-css')){var st=document.createElement('style');st.id='hrt-en-css';st.textContent='.hrt-en-badge{position:absolute;top:10px;left:10px;z-index:8;background:#111;color:#c9a96a;font:600 11px/1 Arial,sans-serif;letter-spacing:.14em;padding:5px 9px;pointer-events:none;white-space:nowrap;}';(document.head||document.documentElement).appendChild(st);}
  function hrefNo(href){if(!href)return null;var m=href.match(/[?&]product_no=([0-9]+)(&|$)/);if(m)return m[1];m=href.split('?')[0].match(/\\/product\\/(?:[^/]+\\/)?([0-9]+)(?:\\/|$)/);return m?m[1]:null;}
  function badgeBox(box){if(!box||box.querySelector('.hrt-en-badge'))return;if(getComputedStyle(box).position==='static')box.style.position='relative';var s=document.createElement('span');s.className='hrt-en-badge';s.textContent=BADGE;box.appendChild(s);}
  function tapeImg(img){
    if(!img||img.getAttribute('data-hrt')||!img.parentNode)return; img.setAttribute('data-hrt','1');
    // 이미지에 딱 맞는 래퍼로 감싸 % 기준 테이프 → 어떤 컨테이너에서도 대각선이 정확히 풀로 덮임.
    var wrap=document.createElement('span');wrap.className='hrt2-wrap';
    wrap.style.cssText='position:relative;display:inline-block;overflow:hidden;line-height:0;max-width:100%;vertical-align:top;';
    img.parentNode.insertBefore(wrap,img);wrap.appendChild(img);img.style.maxWidth='100%';img.style.display='block';
    for(var i=0;i<2;i++){
      var d=document.createElement('span');d.className='hrt2-band';
      d.style.cssText='position:absolute;left:-25%;width:150%;padding:4.5% 0;z-index:20;pointer-events:none;white-space:nowrap;overflow:hidden;text-align:center;box-sizing:border-box;background:#111;color:#fff;font:700 12px/1 Arial,sans-serif;letter-spacing:.28em;box-shadow:0 1px 6px rgba(0,0,0,.25);top:'+(i?'52%':'42%')+';transform:rotate('+(i?'14':'-14')+'deg);'+(i?'opacity:.92;':'');
      d.textContent=T;wrap.appendChild(d);
    }
  }
  function mainImg(){var imgs=document.querySelectorAll('img'),best=null,bt=1e9;for(var j=0;j<imgs.length;j++){var im=imgs[j];if(im.offsetParent===null||im.offsetWidth<250)continue;if(!/\\/product\\/|\\/upload\\//i.test(im.src))continue;var t=im.getBoundingClientRect().top+window.pageYOffset;if(t<bt){bt=t;best=im;}}return best;}
  function runPdp(){var no=(typeof window.iProductNo!=='undefined')?String(window.iProductNo):null;if(!no)return;var img=mainImg();if(!img||img.getAttribute('data-hrt'))return;if(SOLD[no])tapeImg(img);else if(ITEMS[no]){img.setAttribute('data-hrt','1');badgeBox(img.parentElement);}}
  function runList(){var links=document.querySelectorAll('a[href*="product_no="], a[href*="/product/"]');for(var i=0;i<links.length;i++){var a=links[i];var no=hrefNo(a.getAttribute('href')||a.href);if(!no)continue;var sold=!!SOLD[no],low=!!ITEMS[no];if(!sold&&!low)continue;var li=a.closest?a.closest('li,.xans-product-listitem,.item,.prdItem'):null;li=li||a.parentElement;if(!li||li.getAttribute('data-hrt-b'))continue;var img=li.querySelector('img');if(!img)continue;li.setAttribute('data-hrt-b','1');if(sold)tapeImg(img);else badgeBox(img.parentElement);}}
  function go(){runPdp();runList();setTimeout(function(){runPdp();runList();},1500);setTimeout(function(){runPdp();runList();},3500);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',go);else go();
})();`;

  const mkData = (o) => "window.HRT_SCARCE_DATA=" + JSON.stringify({ generatedAt: new Date().toISOString(), threshold: HRT_THRESHOLD, items: o.items, soldout: o.soldout }) + ";\n";
  const dataKr = mkData(kr), dataEn = mkData(en);
  // 데이터+로직 일체형 번들을 Supabase Storage 에 올리고, 스킨은 공개 URL 을 <script src> 로
  // 로드한다(폴바이스와 동일 방식). → 카페24 SFTP 불필요 = 7일 비번만료 반복문제 해소.
  //   국문(skin4): /skin4/js/hrt_scarce.js 는 Supabase 를 부르는 로더 스텁(1회 설치, 이후 불변)
  //   영문(skin5): 각 마스터 레이아웃에 <script src=hrt_scarce_en.js>(1회 설치)
  //   최초 로더 설치는 _hrtLoaderSwap.js (1회, SFTP). 이후 본 크론은 Supabase 만 갱신.
  const HDR = "/* 자동 생성 — local-agent/hrtScarceSync.js (수동 편집 금지) */\n";
  const bodyKr = HDR + dataKr + PDP_ADDON;
  const bodyEn = HDR + dataEn + PDP_ADDON_EN;
  // 업로드 전 문법 검증 — 이스케이프 실수로 깨진 스크립트 발행 방지
  for (const [nm, js] of [["hrt_scarce.js", bodyKr], ["hrt_scarce_en.js", bodyEn]]) {
    try { new Function(js); } catch (e) { throw new Error(`${nm} 생성물 문법 오류: ` + e.message); }
  }
  for (const [nm, js] of [["hrt/hrt_scarce.js", bodyKr], ["hrt/hrt_scarce_en.js", bodyEn]]) {
    const { error } = await sb.storage.from("review-media")
      .upload(nm, Buffer.from(js, "utf8"),
        { contentType: "application/javascript; charset=utf-8", upsert: true, cacheControl: "600" });
    if (error) throw new Error(`해리엇 storage 업로드 실패(${nm}): ` + error.message);
  }
  log(`[해리엇] Supabase 업로드 완료 (국문 ${bodyKr.length}B / 영문 ${bodyEn.length}B)`);
  return { scarce: nos.length, soldout: soldNos.length };
}

/* ─────────────── 폴바이스 ─────────────── */
const PV_MALL = process.env.CAFE24_MALL_ID || "icaruse2000";
const PV_WATCH_THRESHOLD = 10;  // 시계
const PV_ETC_THRESHOLD = 3;     // 주얼리·스트랩 등
// 시계 = 손목시계(45)+Archive(50)+61 + 컬렉션(52~59). 스트랩(46)은 시계에서 제외.
const PV_WATCH_CATS = [45, 50, 61, 52, 53, 54, 55, 56, 57, 58, 59];
const PV_STRAP_CATS = [46];
// 운영용 상품 제외(이름 키워드) + 출시 준비중 세트(263·248 — 여름세트 라이브 후 빼도 무방)
const PV_EXCLUDE_NAME = /쇼핑백|대량주문|전용\]/;
const PV_EXCLUDE_NOS = new Set(["263", "248"]);

async function categoryProductNos(base, tok, catNo) {
  const nos = new Set();
  for (let offset = 0; offset < 2000; offset += 100) {
    const r = await fetch(`${base}/api/v2/admin/categories/${catNo}/products?display_group=1&limit=100&offset=${offset}`, {
      headers: { Authorization: `Bearer ${tok}` }, signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) break; // 카테고리 조회 실패는 치명적이지 않음(시계 판정만 영향)
    const j = await r.json();
    const ps = j.products || [];
    for (const p of ps) nos.add(String(p.product_no));
    if (ps.length < 100) break;
  }
  return nos;
}

async function syncPaulvice() {
  const tok = await cachedToken("cafe24_refresh_token");
  if (!tok) { log("[폴바이스] access_token 만료 — 스킵", "warn"); return null; }
  const base = `https://${PV_MALL}.cafe24api.com`;

  // 파생상품(세트·함께구매) 옵션 재고를 구성품과 동기화 — 배지 계산 전에 수행
  if (!DRY) { try { await mirrorPvDerived(tok); } catch (e) { log("[폴바이스] 파생 미러링 실패: " + ((e && e.message) || e), "warn"); } }

  const watchNos = new Set(), strapNos = new Set();
  for (const c of PV_WATCH_CATS) for (const n of await categoryProductNos(base, tok, c)) watchNos.add(n);
  for (const c of PV_STRAP_CATS) for (const n of await categoryProductNos(base, tok, c)) strapNos.add(n);
  for (const n of strapNos) watchNos.delete(n);
  log(`[폴바이스] 시계 판정 ${watchNos.size}개 / 스트랩 ${strapNos.size}개`);

  const products = await fetchAllProducts(base, tok);
  const items = {}, soldout = {};
  for (const p of products) {
    if (p.display !== "T" || p.selling !== "T") continue;
    const no = String(p.product_no);
    if (PV_EXCLUDE_NOS.has(no) || PV_EXCLUDE_NAME.test(p.product_name || "")) continue;
    if (isSoldOut(p)) { soldout[no] = { name: p.product_name }; continue; }
    // 폴바이스는 추적 꺼진 변형의 quantity가 관리되지 않으므로 추적 변형만 신뢰
    const qty = trackedQty(p);
    if (qty === null) continue;
    const th = watchNos.has(no) ? PV_WATCH_THRESHOLD : PV_ETC_THRESHOLD;
    if (qty > 0 && qty <= th) items[no] = { qty, name: p.product_name };
  }
  const nos = Object.keys(items), soldNos = Object.keys(soldout);
  log(`[폴바이스] 상품 ${products.length} — 임박 ${nos.length} / 품절 ${soldNos.length}`);
  if (DRY) { log(`[폴바이스] 임박: ${nos.map(n=>`${n}(${items[n].name.slice(0,10)} ${items[n].qty})`).join(", ")}`); return { scarce: nos.length, soldout: soldNos.length }; }

  const js = renderPvBadgeJs({ generatedAt: new Date().toISOString(), items, soldout });
  // 업로드 전 문법 검증 — 템플릿 이스케이프 실수로 깨진 스크립트가 발행되는 사고 방지
  try { new Function(js); } catch (e) { throw new Error("pv_badge.js 생성물 문법 오류: " + e.message); }
  const { error } = await sb.storage.from("review-media")
    .upload("pv/pv_badge.js", Buffer.from(js, "utf8"),
      { contentType: "application/javascript; charset=utf-8", upsert: true, cacheControl: "600" });
  if (error) throw new Error("폴바이스 storage 업로드 실패: " + error.message);
  log(`[폴바이스] pv_badge.js 업로드 완료 (${js.length}B)`);
  return { scarce: nos.length, soldout: soldNos.length };
}

/* ── 폴바이스 파생상품(세트·함께구매·프로모션) 옵션 재고 미러링 ──
 * 파생상품은 재고관리 장부에 넣지 않는다(실물 재고=구성품). 대신:
 *  - 판매 차감: kv inventory_sku_alias (파생 SKU → 구성품 SKU, 프로덕션 sync가 소급 반영)
 *  - 품절 연동: 아래 BOM대로 파생상품 옵션(variant) 수량을 구성품 재고로 미러 →
 *    구성품이 품절되면 해당 옵션도 자동 품절 표시된다.
 *  - 248(여름세트)은 시계 색상 옵션이 갈려 별칭 불가 → 판매 감지 시 텔레그램 알림(수동 조정 필요).
 * 구성품: 196 에끌라 실버 / 195 에끌라 골드 / 148 큐빅팔찌 실버 / 139 큐빅팔찌 골드 */
const PV_DERIVED_BOM = [
  { no: 248, name: "여름세트(워치+팔찌)", map: { P00000JO000F: 196, P00000JO000G: 195, P00000JO000H: 148, P00000JO000I: 139 } },
  { no: 263, name: "여름세트(실버+메탈밴드)", map: { P00000KD000D: 196, P00000KD000E: 196 } },
  { no: 257, name: "시크릿 프로모션", map: { P00000JX000B: 196, P00000JX000C: 196 } },
  { no: 258, name: "함께구매 골드팔찌", map: { P00000JY000A: 139 } },
  { no: 259, name: "함께구매 실버팔찌", map: { P00000JZ000A: 148 } },
];

async function mirrorPvDerived(tok) {
  const base = `https://${PV_MALL}.cafe24api.com`;
  const compNos = [...new Set(PV_DERIVED_BOM.flatMap((b) => Object.values(b.map)))];
  const compQty = {};
  for (const no of compNos) {
    const r = await fetch(`${base}/api/v2/admin/products/${no}?embed=variants`, { headers: { Authorization: `Bearer ${tok}` } });
    if (!r.ok) continue;
    const p = (await r.json()).product;
    compQty[no] = (p.variants || []).reduce((s, v) => s + (Number(v.quantity) || 0), 0);
  }
  // ⚠️ 임시 오버라이드 — 에끌라 골드(195) 예약판매 기간(≤2026-08-18) 동안:
  //  ① 세트 248 골드 변형은 실물이 없으므로 강제 0 (예약분은 195 단품으로만 판매)
  //  ② 195 자체 재고는 예약 허용수량(변형 3개 중복합산 방지) — 미러링 외 용도 없음
  const PV_MIRROR_OVERRIDE =
    new Date().toISOString().slice(0, 10) < "2026-08-19" ? { P00000JO000G: 0 } : {};
  let updated = 0;
  for (const b of PV_DERIVED_BOM) {
    for (const [vc, comp] of Object.entries(b.map)) {
      let q = compQty[comp];
      if (vc in PV_MIRROR_OVERRIDE) q = PV_MIRROR_OVERRIDE[vc];
      if (q === undefined) continue;
      const pr = await fetch(`${base}/api/v2/admin/products/${b.no}/variants/${vc}`, {
        method: "PUT", headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
        body: JSON.stringify({ shop_no: 1, request: { quantity: q, use_inventory: "T", display_soldout: "T" } }),
      });
      if (pr.ok) updated++;
      await new Promise((r2) => setTimeout(r2, 120));
    }
  }
  log(`[폴바이스] 파생상품 옵션 미러링 ${updated}건 (구성품 재고: ${Object.entries(compQty).map(([k, v]) => `#${k}=${v}`).join(", ")})`);

  // 248 판매 감지 → 텔레그램(별칭 불가 상품이라 수동 재고조정 필요)
  try {
    const since = new Date(Date.now() - 26 * 3600e3).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    const r = await fetch(`${base}/api/v2/admin/orders?start_date=${since}&end_date=${today}&limit=100&embed=items`, { headers: { Authorization: `Bearer ${tok}` } });
    const orders = (await r.json()).orders || [];
    const hits = [];
    for (const od of orders) for (const it of od.items || []) {
      if (it.product_code === "P00000JO") hits.push(`${it.quantity}개 (${(it.option_value || "").slice(0, 40)})`);
    }
    if (hits.length) {
      await require("./notifyFail").notifyFail(
        "여름세트(248) 판매 감지 — 수동 재고조정 필요",
        `시계 색상 옵션 확인 후 재고관리 페이지에서 해당 워치·팔찌 수동조정: ${hits.join(" / ")}`
      );
    }
  } catch { /* 알림 실패는 치명적이지 않음 */ }
}

/* 폴바이스 배지 스크립트(로직+데이터 일체) — BI 그레이(#B1AAA2)+화이트, 골드 금지 (사장님 확정 2026-07-17) */
function renderPvBadgeJs(data) {
  return `/* PAULVICE 품절임박 배지 + SOLD OUT 테이프 — 자동 생성(hrtScarceSync.js), 수동 편집 금지 */
(function(){
  var D=${JSON.stringify(data)};
  var SCARCE=D.items||{}, SOLD=D.soldout||{};
  var BADGE='품절임박';
  var NOTE='마지막 수량입니다 — 재고 소진 시 재입고까지 시간이 걸릴 수 있습니다.';
  var TAPE='SOLD OUT  SOLD OUT  SOLD OUT  SOLD OUT  SOLD OUT  SOLD OUT  SOLD OUT  SOLD OUT  SOLD OUT  SOLD OUT  SOLD OUT  SOLD OUT';
  function ensureCss(){
    if(document.getElementById('pv-scarce-css'))return;
    var st=document.createElement('style');st.id='pv-scarce-css';
    st.textContent=
      '.pv-scarce-badge{position:absolute;bottom:10px;left:10px;z-index:5;background:#B1AAA2;color:#fff;font-size:11px;letter-spacing:.14em;font-weight:600;padding:5px 10px;line-height:1;pointer-events:none;font-family:Pretendard,-apple-system,"Noto Sans KR",sans-serif;}'+
      '.pv-scarce-pdp{display:block;width:fit-content;background:#B1AAA2;color:#fff;font-size:12px;letter-spacing:.16em;font-weight:600;padding:7px 13px;line-height:1;margin:0 0 10px;font-family:Pretendard,-apple-system,"Noto Sans KR",sans-serif;}'+
      '.pv-scarce-note{display:block;font-size:12.5px;color:#8a837b;margin:8px 0 0;font-family:Pretendard,-apple-system,"Noto Sans KR",sans-serif;letter-spacing:.02em;}'+
      '.pv-so-wrap{overflow:hidden!important;}'+
      '.pv-so-band{position:absolute;left:-25%;width:150%;padding:4.5% 0;z-index:6;pointer-events:none;white-space:nowrap;overflow:hidden;text-align:center;background:#B1AAA2;color:#fff;font-family:"Helvetica Neue",Arial,sans-serif;font-weight:700;font-size:11px;letter-spacing:.28em;box-shadow:0 1px 6px rgba(0,0,0,.25);}'+
      '.pv-so-b1{top:42%;transform:rotate(-14deg);}'+
      '.pv-so-b2{top:52%;transform:rotate(14deg);opacity:.92;}'+
      '.pv-so-pdp .pv-so-band{font-size:14px;}';
    document.head.appendChild(st);
  }
  /* href에서 상품번호를 정확히 추출 — SEO 경로의 카테고리 번호(/category/46/ 등)를
     상품번호로 오인하지 않도록 위치 기반 파싱 (2026-07-17 수정) */
  function hrefNo(href){
    if(!href)return null;
    /* 템플릿 리터럴 이스케이프 문제를 피하려고 정규식은 문자열 생성자로 작성 */
    var m=href.match(new RegExp('[?&]product_no=([0-9]+)(&|$)'));
    if(m)return m[1];
    m=href.split('?')[0].match(new RegExp('/product/(?:[^/]+/)?([0-9]+)(/|$)'));
    return m?m[1]:null;
  }
  function matchIn(map,href){
    var no=hrefNo(href);
    return (no&&map[no])?no:null;
  }
  /* 폴바이스 카드는 앵커가 이미지+텍스트 전체를 감싸므로, 배지·테이프는 이미지를 감싼 박스 기준 */
  function thumbBox(a){
    var img=a.querySelector('img');
    if(!img)return null;
    var b=img.parentElement&&a.contains(img.parentElement)?img.parentElement:a;
    return b;
  }
  function addTape(el,pdp){
    if(!el||el.querySelector('.pv-so-band'))return;
    if(window.getComputedStyle(el).position==='static')el.style.position='relative';
    if(el.getBoundingClientRect().height<10)el.style.display='block';
    el.classList.add('pv-so-wrap');
    if(pdp)el.classList.add('pv-so-pdp');
    ['pv-so-b1','pv-so-b2'].forEach(function(c){
      var d=document.createElement('span');d.className='pv-so-band '+c;d.textContent=TAPE;el.appendChild(d);
    });
  }
  function decorateLists(){
    var as=document.querySelectorAll('a[href*="/product/"], a[href*="product_no="]');
    for(var i=0;i<as.length;i++){
      var a=as[i],href=a.getAttribute('href');
      var box=thumbBox(a);
      if(!box)continue;
      if(matchIn(SOLD,href)){addTape(box,false);continue;}
      var no=matchIn(SCARCE,href);
      if(!no||box.querySelector('.pv-scarce-badge'))continue;
      if(window.getComputedStyle(box).position==='static')box.style.position='relative';
      if(box.getBoundingClientRect().height<10)box.style.display='block';
      var d=document.createElement('span');d.className='pv-scarce-badge';d.textContent=BADGE;
      box.appendChild(d);
    }
    var ic=document.querySelectorAll('img[src*="ico_product_soldout"]');
    for(var k=0;k<ic.length;k++)ic[k].style.setProperty('display','none','important');
    var sp=document.querySelectorAll('.product_price span, .price span, li span');
    for(var j=0;j<sp.length;j++){
      if(sp[j].children.length===0&&sp[j].textContent.trim()==='품절')sp[j].style.display='none';
    }
  }
  /* PDP 대표이미지: 화면에 보이는 가장 큰 상품 이미지의 갤러리 컨테이너(.prdImg) 우선 */
  function pdpTarget(){
    var best=null,area=0,imgs=document.querySelectorAll('img');
    for(var i=0;i<imgs.length;i++){
      var im=imgs[i];
      if((im.src||'').indexOf('/web/product/')<0)continue;
      var r=im.getBoundingClientRect(),a=r.width*r.height;
      if(r.width>=200&&a>area){area=a;best=im;}
    }
    if(!best)return null;
    return (best.closest&&best.closest('.prdImg'))||best.parentElement;
  }
  function decoratePdp(){
    var no=(typeof window.iProductNo!=='undefined')?String(window.iProductNo):null;
    if(!no)return;
    if(SOLD[no]){
      var t=pdpTarget();
      if(t)addTape(t,true);
      return;
    }
    if(!SCARCE[no]||document.querySelector('.pv-scarce-pdp'))return;
    var cands=document.querySelectorAll('.headingArea h1, .xans-product-detail h1, .infoArea h1, h1, .headingArea h2, .infoArea h2');
    var h=null;
    for(var i=0;i<cands.length;i++){
      if(cands[i].textContent.trim()&&cands[i].getBoundingClientRect().height>0){h=cands[i];break;}
    }
    if(!h)return;
    var b=document.createElement('span');b.className='pv-scarce-pdp';b.textContent=BADGE;
    h.parentNode.insertBefore(b,h);
    var n=document.createElement('span');n.className='pv-scarce-note';n.textContent=NOTE;
    h.parentNode.insertBefore(n,h.nextSibling);
  }
  function run(){ensureCss();decorateLists();decoratePdp();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run);else run();
  setTimeout(run,1200);setTimeout(run,3000);

  /* ── 에끌라 골드(195) 재입고 예약판매 UI 패치 — 2026-08-19 자동 만료 (2026-07-26) ──
     PDP 주입 JS(스킨)가 그리는 ①출고 카운트다운(#pv-ship) ②"오늘 발송" 신뢰타일(#pv-trust)
     ③여름세트 크로스셀(#pv-xsell)이 예약판매와 모순 → 예약 안내로 교체/제거.
     원본 tick 은 분리된 노드에 계속 쓰므로(무해) 노드 자체를 제거·대체한다. */
  try{
    var PRE_NO='195', PRE_UNTIL='2026-08-19';
    var pvpn=(location.search.match(/product_no=(\\d+)/)||[])[1]
          ||(location.pathname.match(/^\\/product\\/[^/]+\\/(\\d+)\\//)||[])[1]||'';
    if(pvpn===PRE_NO && (new Date().toISOString().slice(0,10))<PRE_UNTIL){
      var preN=0, preT=setInterval(function(){
        preN++;
        try{
          var ship=document.getElementById('pv-ship');
          if(ship){
            var pd=document.createElement('div');
            pd.id='pv-preorder-ship';
            pd.style.cssText='display:flex;align-items:center;gap:8px;margin:10px 0 2px;padding:12px 14px;background:#faf9f7;border:1px solid #e2ded9;border-radius:6px;font-size:12.8px;line-height:1.55;color:#111;font-family:Pretendard,-apple-system,"Noto Sans KR",sans-serif;';
            pd.innerHTML='<span style="font-size:14px;">📦</span><span><b>재입고 예약 주문</b> — 8/19 입고 후 주문 순서대로 발송 · <b>브라운 가죽밴드(25,000원) 무료 증정</b></span>';
            ship.parentNode.insertBefore(pd,ship); ship.remove();
          }
          var tr=document.getElementById('pv-trust');
          if(tr&&!tr.getAttribute('data-preorder')){
            tr.setAttribute('data-preorder','1');
            var tile=tr.firstElementChild;
            if(tile&&tile.children.length>=2){
              tile.children[0].textContent='8/19 예약 발송';
              tile.children[1].textContent='입고 후 순차 출고';
            }
          }
          var xs=document.getElementById('pv-xsell'); if(xs) xs.remove();
        }catch(e){}
        if(preN>40) clearInterval(preT);
      },400);
    }
  }catch(e){}
})();
`;
}

/* ─────────────── main ─────────────── */
(async () => {
  let hrtRes = null, pvRes = null, failed = [];
  try { hrtRes = await syncHarriot(); }
  catch (e) { failed.push("해리엇: " + ((e && e.message) || e)); log("[해리엇] 실패: " + ((e && e.message) || e), "error"); }
  try { pvRes = await syncPaulvice(); }
  catch (e) { failed.push("폴바이스: " + ((e && e.message) || e)); log("[폴바이스] 실패: " + ((e && e.message) || e), "error"); }

  if (failed.length) {
    try { await require("./notifyFail").notifyFail("품절임박/SOLD OUT 동기화", failed.join(" / ")); } catch { }
    process.exitCode = 1;
    return;
  }
  if (!DRY && (hrtRes || pvRes)) {
    await require("./heartbeat").beat("hrt-scarce-sync", {
      hrt: hrtRes || "skip(token)", pv: pvRes || "skip(token)",
    });
  }
})();
