/**
 * 스마트스토어(해리엇 와치스) 출고대기 주문 수집 — 2026-09-04
 *
 * 커머스 API(api.commerce.naver.com)로 결제완료(PAYED)·발송대기 주문을 읽어
 * buildPostOffice.js 의 11컬럼 우체국 양식 행으로 변환한다.
 *
 * 호출 규칙(실측):
 *  - 목록 조회 파라미터는 `from`/`to` (lastChangedFrom 아님 — 400 "from 필드는 필수값").
 *  - 응답은 `data.contents[]`, 각 원소에 `content.order` / `content.productOrder` 전부 포함.
 *    별도 상세조회 불필요.
 *  - 창은 24시간 단위. 연속 호출 시 GW.RATE_LIMIT(429) → 400ms 이상 간격 + 백오프 필요.
 *  - 호출 IP는 커머스 API 센터 > 내 스토어 애플리케이션 > API호출 IP 에 등록돼 있어야 한다.
 *    (미등록 시 GW.IP_NOT_ALLOWED. 최대 3개, 공인 IP 바뀌면 갱신)
 *
 * 같은 수취인 여러 상품은 buildPostOffice 쪽 합배송 로직이 묶으므로 여기선 상품별 1행으로 낸다.
 */
const fs = require("fs"), path = require("path");
const DASH = path.resolve(__dirname, "..");
function loadEnv(p){ try{ for(const l of fs.readFileSync(p,"utf8").split("\n")){ const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if(!m)continue; const v=m[2].trim().replace(/^["']|["']$/g,""); if(!(m[1] in process.env)) process.env[m[1]]=v; } }catch{} }
loadEnv(path.join(DASH,".env.local")); loadEnv(path.join(__dirname,".env"));
const bcrypt = require(path.join(DASH,"node_modules","bcryptjs"));

const API = "https://api.commerce.naver.com/external/v1";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const kst = (d) => new Date(d.getTime() + 9*36e5).toISOString().slice(0,19) + ".000+09:00";
const log = (m) => console.log(`[${new Date().toISOString()}] [스마트스토어] ${m}`);

// 발송 대상 상태. PAYED=결제완료(발송대기), DELIVERING 이후는 이미 발송된 것.
const SHIPPABLE = new Set(["PAYED"]);

/**
 * 주문 옵션에 없는 각인 요청 — 각인 옵션이 없는 상품(에끌라 등)은 고객이 **톡톡으로** 각인을 요청한다.
 * 그건 API 주문 데이터 어디에도 없어서, 그냥 두면 송장에 안 찍히고 **각인 없이 출고된다.**
 * (2026-09-03 조선몰 강한석 건과 같은 계열의 사고 — 송장을 보고 각인 작업을 하기 때문이다.)
 * kv `smartstore_engraving_overrides` = { "<주문번호>": "각인문구" } 를 읽어 품목명에 붙인다.
 */
const OVERRIDE_KEY = "smartstore_engraving_overrides";
async function loadEngravingOverrides(){
  try{
    const { createClient } = require(path.join(DASH,"node_modules","@supabase/supabase-js"));
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data } = await sb.from("kv_store").select("data").eq("key", OVERRIDE_KEY).maybeSingle();
    return (data && data.data) || {};
  }catch(e){ log(`각인 오버라이드 조회 실패(무시): ${e.message}`); return {}; }
}

async function token() {
  const ID = process.env.NAVER_COMMERCE_CLIENT_ID, SEC = process.env.NAVER_COMMERCE_CLIENT_SECRET;
  if (!ID || !SEC) throw new Error("NAVER_COMMERCE_CLIENT_ID/SECRET 없음");
  const ts = Date.now();
  const sign = Buffer.from(bcrypt.hashSync(`${ID}_${ts}`, SEC)).toString("base64");
  const r = await fetch(`${API}/oauth2/token`, { method:"POST",
    headers:{"Content-Type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({client_id:ID,timestamp:String(ts),client_secret_sign:sign,grant_type:"client_credentials",type:"SELF"}) });
  const t = await r.text();
  if (!r.ok) throw new Error(`토큰 실패 ${r.status} ${t.slice(0,200)}`);
  return JSON.parse(t).access_token;
}

/** 최근 days일 상품주문 원본 수집 */
async function fetchOrders(days = 14) {
  const H = { Authorization: "Bearer " + (await token()) };
  const seen = new Map();
  for (let d = days - 1; d >= 0; d--) {
    const to = new Date(Date.now() - d*864e5), from = new Date(to.getTime() - 864e5 + 1000);
    for (let page = 1; ; page++) {
      const u = `${API}/pay-order/seller/product-orders?from=${encodeURIComponent(kst(from))}&to=${encodeURIComponent(kst(to))}&page=${page}&size=300`;
      const res = await fetch(u, { headers: H });
      if (res.status === 429) { await sleep(4000); continue; }
      if (!res.ok) break;
      const j = await res.json();
      (j.data?.contents || []).forEach(c => seen.set(c.productOrderId, c));
      if (!j.data?.pagination?.hasNext) break;
      await sleep(400);
    }
    await sleep(420);
  }
  return [...seen.values()];
}

/** 우체국 양식 행으로 변환 (buildPostOffice HEADER 순서와 동일한 객체 키) */
function toRows(orders, engravings = {}) {
  const rows = [];
  for (const x of orders) {
    const c = x.content || {}, po = c.productOrder || {}, o = c.order || {};
    if (!SHIPPABLE.has(po.productOrderStatus)) continue;
    const sa = po.shippingAddress || {};
    const phone = String(sa.tel1 || sa.tel2 || "").replace(/\s/g,"");
    const isMobile = /^01[016789]/.test(phone.replace(/\D/g,""));
    const opt = (po.productOption || "").trim();
    const orderNo = o.orderId || po.productOrderId;
    // 톡톡으로 온 각인은 옵션에 없다 → 품목명에 실어 송장에 찍히게 한다.
    const eng = engravings[orderNo] || engravings[po.productOrderId] || "";
    rows.push({
      order: orderNo,
      name: sa.name || "",
      mobile: isMobile ? phone : "",
      tel: isMobile ? "" : phone,          // 0502 안심번호는 일반전화 칸으로
      addr: [sa.baseAddress, sa.detailedAddress].filter(Boolean).join(" "),
      zip: sa.zipCode || "",
      prod: (opt ? `${po.productName} (${opt})` : po.productName) + (eng ? ` (각인:${eng})` : ""),
      color: "",
      qty: String(po.quantity || 1),
      memo: sa.shippingMemo || "",
      seller: "스마트스토어",
      _due: (po.shippingDueDate || "").slice(0,10),
    });
  }
  return rows;
}

async function getSmartstoreOutboundRows(days = 14) {
  const orders = await fetchOrders(days);
  const engravings = await loadEngravingOverrides();
  const rows = toRows(orders, engravings);
  const engRows = rows.filter(r => /\(각인:/.test(r.prod));
  log(`상품주문 ${orders.length}건 조회 → 발송대기 ${rows.length}행${engRows.length?` · 각인 ${engRows.length}행`:""}`);
  engRows.forEach(r => log(`  ✍️ ${r.order} ${r.name}: ${r.prod}`));
  return rows;
}

module.exports = { getSmartstoreOutboundRows, fetchOrders, toRows };

if (require.main === module) {
  getSmartstoreOutboundRows(Number(process.argv[2] || 14))
    .then(rows => { console.log(JSON.stringify(rows, null, 1)); })
    .catch(e => { console.error("실패:", e.message); process.exit(1); });
}
