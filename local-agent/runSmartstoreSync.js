/**
 * 스마트스토어(해리엇) 매출 동기화 — 커머스 API → channel_upload:naver_smartstore
 *
 * 왜 API 인가: 스마트스토어 주문조회 엑셀은 네이버가 **암호를 걸어** 내려준다(개인정보).
 *   그래서 파일 업로드 경로로는 자동화가 안 된다. 출고(smartstoreOutbound.js)가 이미
 *   커머스 API 인증을 뚫어놨으므로 매출도 같은 경로로 가져온다.
 *
 * ⚠️ API 제약: from/to 는 **최대 24시간** 차이만 허용(400). 그래서 하루씩 훑는다.
 *   연속 호출 시 GW.RATE_LIMIT(429) → 간격 + 백오프 필요.
 *
 * 매출 인식: 취소·반품·미결제는 제외한다(회사 규칙 — 결제일 기준, 취소/반품/환불만 제외).
 *
 * 실행:
 *   node runSmartstoreSync.js                  최근 14일
 *   node runSmartstoreSync.js 2025-04-01 2026-09-04   기간 지정(전체 백필)
 */
const fs = require("fs"), path = require("path");
const DASH = path.resolve(__dirname, "..");
function loadEnv(p){ try{ for(const l of fs.readFileSync(p,"utf8").split("\n")){ const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if(!m)continue; const v=m[2].trim().replace(/^["']|["']$/g,""); if(!(m[1] in process.env)) process.env[m[1]]=v; } }catch{} }
loadEnv(path.join(DASH,".env.local")); loadEnv(path.join(DASH,".env.supabase")); loadEnv(path.join(__dirname,".env"));
const bcrypt = require(path.join(DASH,"node_modules","bcryptjs"));
const { createClient } = require(path.join(DASH,"node_modules","@supabase/supabase-js"));

const API = "https://api.commerce.naver.com/external/v1";
const KEY = "channel_upload:naver_smartstore";
/**
 * 주문 원본 캐시. **왜 필요한가**: 대시보드 머지는 dailyRevenue 는 날짜로 덮어쓰지만
 * topProducts·salesByOption 은 **합산**한다. 그래서 기간이 겹치는 업로드가 둘 있으면
 * 상품별 집계가 이중 계상된다. 업로드 레코드를 **항상 하나(고정 fileName)** 로 유지하고
 * 그 하나를 매번 전체 캐시에서 다시 만들면 겹칠 일이 없다.
 * 취소분도 그대로 캐시에 넣는다 — 나중에 취소로 바뀐 주문이 다음 실행에서 반영되도록.
 */
const CACHE_KEY = "smartstore_orders_v1";
const FILE_NAME = "smartstore_api";
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const kst = d => new Date(d.getTime()+9*36e5).toISOString().slice(0,19)+".000+09:00";
const log = m => console.log(`[${new Date().toISOString().slice(11,19)}] ${m}`);

/** 매출에서 뺄 상태 — 취소·반품·미결제. 그 외(결제완료·배송중·배송완료·구매확정)는 매출. */
const EXCLUDED = new Set(["CANCELED","RETURNED","CANCELED_BY_NOPAYMENT"]);

async function token(){
  const ID=process.env.NAVER_COMMERCE_CLIENT_ID, SEC=process.env.NAVER_COMMERCE_CLIENT_SECRET;
  if(!ID||!SEC) throw new Error("NAVER_COMMERCE_CLIENT_ID/SECRET 없음");
  const ts=Date.now();
  const sign=Buffer.from(bcrypt.hashSync(`${ID}_${ts}`,SEC)).toString("base64");
  const r=await fetch(`${API}/oauth2/token`,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({client_id:ID,timestamp:String(ts),client_secret_sign:sign,grant_type:"client_credentials",type:"SELF"})});
  if(!r.ok) throw new Error(`토큰 실패 ${r.status} ${(await r.text()).slice(0,150)}`);
  return (await r.json()).access_token;
}

async function fetchRange(startYmd, endYmd){
  let H = { Authorization: "Bearer " + (await token()) };
  let tokenAt = Date.now();
  const seen = new Map();
  const start = new Date(startYmd+"T00:00:00Z"), end = new Date(endYmd+"T00:00:00Z");
  const days = Math.round((end-start)/864e5)+1;
  for (let i=0;i<days;i++){
    if (Date.now()-tokenAt > 40*60e3) { H={Authorization:"Bearer "+(await token())}; tokenAt=Date.now(); }  // 토큰 만료 방지
    const from=new Date(start.getTime()+i*864e5), to=new Date(from.getTime()+864e5-1000);
    for (let page=1;;page++){
      const u=`${API}/pay-order/seller/product-orders?from=${encodeURIComponent(kst(from))}&to=${encodeURIComponent(kst(to))}&page=${page}&size=300`;
      const res=await fetch(u,{headers:H});
      if(res.status===429){ await sleep(4000); continue; }
      if(!res.ok){ log(`  ⚠️ ${from.toISOString().slice(0,10)} HTTP ${res.status}`); break; }
      const j=await res.json();
      (j.data?.contents||[]).forEach(c=>seen.set(c.productOrderId,c));
      if(!j.data?.pagination?.hasNext) break;
      await sleep(400);
    }
    if(i%30===0||i===days-1) log(`  ${from.toISOString().slice(0,10)} … 누적 ${seen.size}건 (${i+1}/${days}일)`);
    await sleep(430);
  }
  return [...seen.values()];
}

/** 커머스 API 원본 → 캐시에 넣을 정규화 행(취소분 포함) */
function normalize(orders){
  const out={};
  for(const x of orders){
    const c=x.content||{}, po=c.productOrder||{}, o=c.order||{};
    const paidAt=(o.paymentDate||o.orderDate||"").slice(0,19);
    if(!paidAt) continue;
    // 판매자 실매출 = 상품가×수량 − 판매자부담할인. 플랫폼 부담분은 차감하지 않는다.
    const amount = Number(po.totalPaymentAmount ?? ((po.unitPrice||0)*(po.quantity||1))) || 0;
    out[x.productOrderId]={
      status: po.productOrderStatus||"",
      date: paidAt.slice(0,10),
      hour: Number(paidAt.slice(11,13))||0,
      orderId: o.orderId||po.productOrderId,
      sku: String(po.productId||""),
      name: po.productName||"",
      option: (po.productOption||"").trim(),
      qty: Number(po.quantity||1),
      revenue: amount,
    };
  }
  return out;
}

/** 캐시 전체 → 대시보드 MultiChannelData */
function build(cache){
  const rows=Object.values(cache).filter(r=>!EXCLUDED.has(r.status));

  const byDate=new Map(), byHour=new Map(), byProd=new Map(), byOpt=new Map(), byDow=new Map();
  const orderIds=new Set();
  for(const r of rows){
    orderIds.add(r.orderId);
    const d=byDate.get(r.date)||{date:r.date,orders:new Set(),revenue:0,shipments:0};
    d.orders.add(r.orderId); d.revenue+=r.revenue; d.shipments+=r.qty; byDate.set(r.date,d);
    const h=byHour.get(r.hour)||{orders:new Set(),revenue:0};
    h.orders.add(r.orderId); h.revenue+=r.revenue; byHour.set(r.hour,h);
    const p=byProd.get(r.sku)||{sku:r.sku,name:r.name,sold:0,revenue:0};
    p.sold+=r.qty; p.revenue+=r.revenue; byProd.set(r.sku,p);
    const ok=r.sku+"|"+r.option;
    const op=byOpt.get(ok)||{sku:r.sku,name:r.name,option:r.option,sold:0};
    op.sold+=r.qty; byOpt.set(ok,op);
    const dow=["일","월","화","수","목","금","토"][new Date(r.date+"T00:00:00+09:00").getDay()];
    const w=byDow.get(dow)||{day:dow,orders:new Set(),revenue:0};
    w.orders.add(r.orderId); w.revenue+=r.revenue; byDow.set(dow,w);
  }

  const dailyRevenue=[...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date))
    .map(d=>({date:d.date,orders:d.orders.size,revenue:d.revenue,shipments:d.shipments}));
  const hourlyOrders=Array.from({length:24},(_,h)=>{
    const v=byHour.get(h); return {hour:String(h).padStart(2,"0")+"시",orders:v?v.orders.size:0,revenue:v?v.revenue:0};
  });
  const topProducts=[...byProd.values()].sort((a,b)=>b.revenue-a.revenue)
    .map((p,i)=>({sku:p.sku,name:p.name,rank:i+1,sold:p.sold,image:"⌚",revenue:p.revenue}));
  const salesByOption=[...byOpt.values()].sort((a,b)=>b.sold-a.sold);
  const weeklyRevenue=["월","화","수","목","금","토","일"].map(day=>{
    const v=byDow.get(day); return {day,orders:v?v.orders.size:0,revenue:v?v.revenue:0};
  });

  const todayK=new Date(Date.now()+9*36e5).toISOString().slice(0,10);
  const period=(fromYmd,toYmd)=>{
    const sel=dailyRevenue.filter(d=>d.date>=fromYmd&&d.date<=toYmd);
    const revenue=sel.reduce((s,d)=>s+d.revenue,0), orders=sel.reduce((s,d)=>s+d.orders,0);
    return {orders,revenue,avgOrder:orders?Math.round(revenue/orders):0};
  };
  const dAgo=n=>new Date(Date.now()+9*36e5-n*864e5).toISOString().slice(0,10);
  const m0=todayK.slice(0,7), pm=new Date(todayK+"T00:00:00Z"); pm.setUTCMonth(pm.getUTCMonth()-1);
  const pmK=pm.toISOString().slice(0,7);
  const salesSummary={
    today: period(todayK,todayK),
    week:  period(dAgo(6),todayK),
    month: period(m0+"-01",m0+"-31"),
    prevMonth: period(pmK+"-01",pmK+"-31"),
  };
  return {
    data:{dailyCogs:[],inventory:[],topProducts,dailyRevenue,hourlyOrders,salesSummary,salesByOption,unmatchedSkus:[],weeklyRevenue,unmatchedNames:[]},
    rowCount: rows.length,
    orderCount: orderIds.size,
  };
}

(async()=>{
  const argFrom=process.argv[2], argTo=process.argv[3];
  const todayK=new Date(Date.now()+9*36e5).toISOString().slice(0,10);
  const from=argFrom||new Date(Date.now()+9*36e5-13*864e5).toISOString().slice(0,10);
  const to=argTo||todayK;
  log(`스마트스토어 매출 수집: ${from} ~ ${to}`);

  const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
  const {data:cRow}=await sb.from("kv_store").select("data").eq("key",CACHE_KEY).maybeSingle();
  const cache=(cRow&&cRow.data)||{};
  const before=Object.keys(cache).length;

  const orders=await fetchRange(from,to);
  const fresh=normalize(orders);
  Object.assign(cache,fresh);   // 같은 productOrderId 는 최신 상태로 덮어쓴다(취소 반영)
  log(`원본 ${orders.length}건 조회 → 캐시 ${before} → ${Object.keys(cache).length}건`);

  const {data,rowCount,orderCount}=build(cache);
  const total=data.dailyRevenue.reduce((s,d)=>s+d.revenue,0);
  log(`매출 인식 ${rowCount}행 / 주문 ${orderCount}건 / 합계 ${total.toLocaleString()}원`);

  if(process.argv.includes("--dry")){ log("(dry — 저장 안 함)"); return; }

  await sb.from("kv_store").upsert({key:CACHE_KEY,data:cache,updated_at:new Date().toISOString()},{onConflict:"key"});
  const dates=data.dailyRevenue.map(d=>d.date);
  const rec={fileName:FILE_NAME,rowCount,period:{start:dates[0]||from,end:dates[dates.length-1]||to},uploadedAt:new Date().toISOString(),data};
  // 업로드는 **항상 이 하나뿐**이어야 한다(겹침 = topProducts 이중계상).
  const {error}=await sb.from("kv_store").upsert({key:KEY,data:{uploads:[rec]},updated_at:new Date().toISOString()},{onConflict:"key"});
  if(error) throw new Error("저장 실패: "+error.message);
  log(`✅ 적재 완료 — ${KEY} (업로드 1건, ${rec.period.start}~${rec.period.end})`);
  try{ await require("./heartbeat").beat("smartstore-sync"); }catch{}
})().catch(e=>{ log("❌ 실패: "+e.message); process.exitCode=1; });
