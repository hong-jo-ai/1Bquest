/**
 * 스마트스토어 송장입력 (Phase 2) — pp_shipments 의 우체국 송장(regi_no)을
 * 네이버 커머스 API 로 역입력해 발송처리(배송중)한다.  2026-09-04 신규.
 *
 *   POST /external/v1/pay-order/seller/product-orders/dispatch
 *   body { dispatchProductOrders:[{ productOrderId, deliveryMethod:"DELIVERY",
 *          deliveryCompanyCode:"EPOST"(우체국택배), trackingNumber, dispatchDate }] }
 *
 * pp_shipments.order_number 에는 orderId(주문번호) 또는 productOrderId 가 들어올 수 있어
 * 최근 주문을 조회해 양쪽으로 매칭한다(과거 단건 접수분 호환).
 * 멱등: 이미 DELIVERING 이상인 상품주문은 스킵. 처리 건수는 SMARTSTORE_DISPATCH_LIMIT 로 제한.
 * --dry 면 실제 호출 없이 대상만 출력.
 */
const fs = require("fs"), path = require("path");
const DASH = path.resolve(__dirname, "..");
function loadEnv(p){ try{ for(const l of fs.readFileSync(p,"utf8").split("\n")){ const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if(!m)continue; const v=m[2].trim().replace(/^["']|["']$/g,""); if(!(m[1] in process.env)) process.env[m[1]]=v; } }catch{} }
loadEnv(path.join(DASH,".env.supabase")); loadEnv(path.join(DASH,".env.local")); loadEnv(path.join(__dirname,".env"));
const { createClient } = require(path.join(DASH,"node_modules/@supabase/supabase-js"));
const { fetchOrders } = require("./smartstoreOutbound");
const bcrypt = require(path.join(DASH,"node_modules","bcryptjs"));

const API = "https://api.commerce.naver.com/external/v1";
const CHANNEL = "스마트스토어";
const DELIVERY_CO = "EPOST";           // 우체국택배
const DRY = process.argv.includes("--dry");
const log = (m) => console.log(`[${new Date().toISOString()}] [스마트스토어송장] ${m}`);
const sb = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function token(){
  const ID=process.env.NAVER_COMMERCE_CLIENT_ID, SEC=process.env.NAVER_COMMERCE_CLIENT_SECRET;
  const ts=Date.now();
  const sign=Buffer.from(bcrypt.hashSync(`${ID}_${ts}`,SEC)).toString("base64");
  const r=await fetch(`${API}/oauth2/token`,{method:"POST",
    headers:{"Content-Type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({client_id:ID,timestamp:String(ts),client_secret_sign:sign,grant_type:"client_credentials",type:"SELF"})});
  const t=await r.text();
  if(!r.ok) throw new Error(`토큰 실패 ${r.status} ${t.slice(0,200)}`);
  return JSON.parse(t).access_token;
}

(async () => {
  const db = sb();
  const { data: ships, error } = await db.from("pp_shipments")
    .select("id,order_number,regi_no,status,product_name")
    .eq("channel", CHANNEL).eq("req_type","1").eq("is_test", false).eq("status","submitted")
    .not("regi_no","is",null).order("created_at",{ascending:false}).limit(100);
  if (error) throw new Error("pp_shipments 조회 실패: "+error.message);
  if (!ships?.length) { log("대상 없음"); return; }

  // 최근 주문에서 orderId/productOrderId ↔ 상태 매핑
  const orders = await fetchOrders(14);
  const byPo = new Map(), byOrder = new Map();
  for (const x of orders) {
    const c=x.content||{}, po=c.productOrder||{}, o=c.order||{};
    const rec={ productOrderId:x.productOrderId, status:po.productOrderStatus, name:po.productName };
    byPo.set(String(x.productOrderId), rec);
    const k=String(o.orderId||""); if(k){ if(!byOrder.has(k)) byOrder.set(k,[]); byOrder.get(k).push(rec); }
  }

  const limit = Number(process.env.SMARTSTORE_DISPATCH_LIMIT || 20);
  let ok=0, skip=0, fail=0, done=0;
  const tk = DRY ? null : await token();

  for (const s of ships) {
    if (done >= limit) break;
    const key = String(s.order_number);
    const recs = byPo.has(key) ? [byPo.get(key)] : (byOrder.get(key) || []);
    if (!recs.length) { log(`  ? ${key} — 최근 14일 주문에서 못 찾음(스킵)`); skip++; continue; }
    const targets = recs.filter(r => r.status === "PAYED");
    if (!targets.length) { log(`  · ${key} 이미 발송처리됨(${recs.map(r=>r.status).join(",")}) — 스킵`); skip++; continue; }

    const body = { dispatchProductOrders: targets.map(r => ({
      productOrderId: r.productOrderId, deliveryMethod: "DELIVERY",
      deliveryCompanyCode: DELIVERY_CO, trackingNumber: String(s.regi_no),
      dispatchDate: new Date(Date.now()+9*36e5).toISOString().slice(0,19)+".000+09:00",
    })) };

    if (DRY) { log(`  [dry] ${key} → 송장 ${s.regi_no} / 상품주문 ${targets.map(t=>t.productOrderId).join(",")}`); done++; continue; }

    const r = await fetch(`${API}/pay-order/seller/product-orders/dispatch`, {
      method:"POST", headers:{Authorization:"Bearer "+tk,"Content-Type":"application/json"}, body:JSON.stringify(body) });
    const txt = await r.text();
    if (r.ok) {
      log(`  ✅ ${key} → ${s.regi_no} (상품주문 ${targets.length}건) 발송처리`);
      await db.from("pp_shipments").update({ status:"dispatched", updated_at:new Date().toISOString() }).eq("id", s.id);
      ok++;
    } else { log(`  ❌ ${key} 실패 HTTP ${r.status}: ${txt.slice(0,300)}`); fail++; }
    done++;
    await new Promise(res=>setTimeout(res,500));
  }
  log(`완료 — 성공 ${ok} / 스킵 ${skip} / 실패 ${fail}${DRY?" (dry)":""}`);
})().catch(e => { console.error("실패:", e.message); process.exit(1); });
