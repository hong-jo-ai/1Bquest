/**
 * 카페24 송장입력 (Phase2) — pp_shipments의 우체국 송장(regi_no)을 카페24 주문에 등록 → 배송중.
 *  POST /api/v2/admin/orders/{order_id}/shipments
 *    request: { tracking_no, shipping_company_code:"0012"(우체국택배), order_item_code:[...], status:"shipping" }
 *  성공 시 pp_shipments.status = "dispatched".
 * CAFE24_DISPATCH_LIMIT 로 처리 건수 제한(파일럿=1). 이미 dispatched면 스킵.
 */
const fs = require("fs"), path = require("path");
const DASH = path.resolve(__dirname, "..");
function loadEnv(p){ try { for(const l of fs.readFileSync(p,"utf8").split("\n")){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);if(!m)continue;let v=m[2].trim().replace(/^["']|["']$/g,"");if(!(m[1] in process.env))process.env[m[1]]=v;} } catch {} }
require("dotenv").config({ override: true });
loadEnv(path.join(DASH,".env.supabase")); loadEnv(path.join(DASH,".env.local"));
const { createClient } = require(path.join(DASH,"node_modules/@supabase/supabase-js"));
const POST_CODE = "0012"; // 우체국택배 (이 몰 기존 배송 주문에서 확인)
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);

// 멀티몰: pp_shipments.channel(=판매처) → 해당 카페24 몰. 폴바이스(카페24) + 해리엇.
const MALLS = [
  { channel:"카페24", mallId:process.env.CAFE24_MALL_ID,         clientId:process.env.CAFE24_CLIENT_ID,         secret:process.env.CAFE24_CLIENT_SECRET,         kvKey:"cafe24_refresh_token" },
  { channel:"해리엇", mallId:process.env.HARRIOT_CAFE24_MALL_ID, clientId:process.env.HARRIOT_CAFE24_CLIENT_ID, secret:process.env.HARRIOT_CAFE24_CLIENT_SECRET, kvKey:"cafe24_refresh_token:harriot" },
];

async function token(sb, m){
  const base=`https://${m.mallId}.cafe24api.com`;
  const {data}=await sb.from("kv_store").select("data").eq("key",m.kvKey).maybeSingle();
  let t=data&&data.data, now=Date.now();
  if(typeof t==="string")t={access_token:"",refresh_token:t,expires_at:0};
  if(!t||!t.refresh_token)throw new Error(`${m.channel} 토큰 없음(${m.kvKey})`);
  if(t.access_token&&t.expires_at&&t.expires_at-90000>now) return t.access_token;
  const r=await fetch(`${base}/api/v2/oauth/token`,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded",Authorization:"Basic "+Buffer.from(`${m.clientId}:${m.secret}`).toString("base64")},body:`grant_type=refresh_token&refresh_token=${encodeURIComponent(t.refresh_token)}`});
  const j=await r.json(); if(!j.access_token)throw new Error(`${m.channel} token refresh 실패`);
  await sb.from("kv_store").upsert({key:m.kvKey,data:{access_token:j.access_token,refresh_token:j.refresh_token,expires_at:now+110*60*1000},updated_at:new Date().toISOString()},{onConflict:"key"});
  return j.access_token;
}
const api=(base,tk)=>async(method,p,body)=>{ const r=await fetch(base+p,{method,headers:{Authorization:`Bearer ${tk}`,"Content-Type":"application/json"},body:body?JSON.stringify(body):undefined}); const j=await r.json().catch(()=>({})); return {ok:r.ok,status:r.status,j}; };

// 한 몰 송장입력 — pp_shipments(channel=판매처) 미발송분을 그 몰 카페24 주문에 등록.
async function dispatchMall(sb, m, limit){
  if(!m.mallId){ log(`[${m.channel}] 몰 미설정 — 스킵`); return {ok:0, fail:0}; }
  const base=`https://${m.mallId}.cafe24api.com`;
  const tk = await token(sb, m);
  const call = api(base, tk);

  // ⚠️ 송장입력 후 pp status를 안 바꿔서(아래 주석) 옛 배송완료건도 계속 'submitted'로 남음.
  //    → 최신순 정렬 필수: 안 그러면 limit이 옛 건(스킵대상)으로 차서 새 주문이 누락됨(2026-06-29 버그수정).
  const { data: ships } = await sb.from("pp_shipments").select("id,order_number,regi_no,status")
    .eq("channel",m.channel).eq("req_type","1").eq("is_test",false).eq("status","submitted")
    .not("regi_no","is",null).neq("regi_no","TESTREGINOAPI")
    .order("created_at",{ascending:false}).limit(limit);
  log(`[${m.channel}] 송장입력 대상 ${ships?.length||0}건 (limit ${limit})`);

  let ok=0, fail=0;
  for (const s of (ships||[])) {
    try {
      // 주문 아이템(배송준비중) 코드 수집
      const od = await call("GET", `/api/v2/admin/orders/${s.order_number}?embed=items`);
      const items = (od.j.order?.items || od.j.orders?.[0]?.items || []);
      const useCodes = items.filter(it=>/배송준비중|상품준비중|배송대기/.test(it.status_text||"")).map(it=>it.order_item_code);
      // 배송준비중 아이템 없음 = 이미 배송중/배송완료(송장입력됨) → 멱등 스킵
      if (!useCodes.length) { log(`  [${m.channel}] ${s.order_number}: 배송준비중 아이템 없음(이미 송장입력/배송중) — 스킵`); continue; }
      // 송장 등록 (배송중)
      const res = await call("POST", `/api/v2/admin/orders/${s.order_number}/shipments`, {
        shop_no: 1,
        request: { tracking_no: s.regi_no, shipping_company_code: POST_CODE, order_item_code: useCodes, status: "shipping" },
      });
      if (res.ok && (res.j.shipments || res.j.shipment)) {
        ok++;
        // status는 CHECK 제약(submitted/error/cancelled 등)이라 변경 안 함 — 멱등성은 카페24 배송준비중 상태로 판단
        await sb.from("pp_shipments").update({ updated_at:new Date().toISOString() }).eq("id", s.id).then(()=>{}).catch(()=>{});
        log(`  ✅ [${m.channel}] ${s.order_number} 송장입력 OK (송장 ${s.regi_no}, 아이템 ${useCodes.length}) → 배송중`);
      } else {
        fail++;
        log(`  ❌ [${m.channel}] ${s.order_number} 실패 HTTP ${res.status}: ${JSON.stringify(res.j).slice(0,300)}`);
      }
    } catch(e){ fail++; log(`  ❌ [${m.channel}] ${s.order_number} 예외: ${e.message}`); }
  }
  return {ok, fail};
}

(async () => {
  const limit = Number(process.env.CAFE24_DISPATCH_LIMIT || 1);
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  let tOk=0, tFail=0;
  for(const m of MALLS){
    try { const r = await dispatchMall(sb, m, limit); tOk+=r.ok; tFail+=r.fail; }
    catch(e){ log(`[${m.channel}] 송장입력 실패: ${e.message}`); }
  }
  log(`카페24 송장입력 완료(전 몰): 성공 ${tOk} / 실패 ${tFail}`);
})().catch(e=>{ console.error("ERR",e); process.exit(1); });
