/**
 * W컨셉 송장입력 — '이미 로그인된 page'를 받아 상품준비중내역(Ready)에서 송장 등록.
 * 매출 sync(syncWconcept) 세션 재사용용. 행별 택배사<select>=우체국택배 + 송장 input + 전체체크(chkItem) → 송장번호 저장.
 * 송장 소스: pp_shipments(채널 W컨셉, submitted). 주문번호(Z..) 매칭. 멱등(이미 송장있는 행은 W컨셉이 무시/저장만).
 */
const fs=require("fs"), path=require("path"), http=require("http");
const DASH="/Users/mac/sungjo_ai/paulwise-dashboard";
function le(p){try{for(const l of fs.readFileSync(p,"utf8").split("\n")){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);if(!m)continue;let v=m[2].trim().replace(/^["']|["']$/g,"");if(!(m[1] in process.env))process.env[m[1]]=v;}}catch{}}
const READY="https://newpin.wconcept.co.kr/Order/LstShippingOrderReady";
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));

function httpGet(url){return new Promise((res,rej)=>{const req=http.get(url,r=>{let d="";r.setEncoding("utf8");r.on("data",c=>d+=c);r.on("end",()=>res(d));});req.on("error",rej);req.setTimeout(8000,()=>{req.destroy();rej(new Error("timeout"));});});}
function decXml(s){return String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,"$1").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&").trim();}
// 우체국 종추적: 이미 '배달완료'된 송장인가? 교환으로 주문이 상품준비중에 재등록될 때
// 옛(배달완료) 송장이 자동 재입력되는 사고 방지용. 키 없거나 오류면 false(=기존 동작 유지, fail-open).
async function isDelivered(regiNo){
  const KEY=process.env.POSTPARCEL_TRACK_KEY;
  if(!KEY||!regiNo) return false;
  try{
    const xml=await httpGet(`http://biz.epost.go.kr/KpostPortal/openapi?regkey=${encodeURIComponent(KEY)}&target=trace&query=${encodeURIComponent(regiNo)}&showRec=Y`);
    const re=/<eventnm\s*>([\s\S]*?)<\/eventnm>/g; let m;
    while((m=re.exec(xml))){ const nm=decXml(m[1]); if(nm==="배달완료"||nm==="배달") return true; }
  }catch{}
  return false;
}

async function fetchTrackMap(log){
  le(DASH+"/.env.supabase"); le(DASH+"/.env.local");
  if(!process.env.SUPABASE_URL){ log&&log("Supabase 미설정 — 송장입력 스킵"); return new Map(); }
  const { createClient }=require(DASH+"/node_modules/@supabase/supabase-js");
  const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
  const {data}=await sb.from("pp_shipments").select("order_number,regi_no").eq("channel","W컨셉").eq("req_type","1").eq("is_test",false).eq("status","submitted").not("regi_no","is",null);
  return new Map((data||[]).map(r=>[String(r.order_number),r.regi_no]));
}

/** 로그인된 page 로 Ready 송장입력 수행. 반환 {filled, saved}. 절대 throw 안 하도록 호출측에서 catch 권장. */
async function dispatchInvoicesOnPage(page, log=console.log){
  const map=await fetchTrackMap(log);
  if(!map.size){ log("W컨셉 송장 대상 없음"); return {filled:0,saved:false}; }
  log(`W컨셉 송장입력 대상 ${map.size}건`);
  page.on("dialog", d=>{ log("DIALOG: "+d.message().slice(0,80)); d.accept().catch(()=>{}); });
  await page.goto(READY,{waitUntil:"domcontentloaded",timeout:60000}).catch(()=>{});
  await sleep(3000);
  await page.locator('button:has-text("1개월"),a:has-text("1개월")').first().click({timeout:4000}).catch(()=>{});
  await page.locator('#btnSearch,button:has-text("조회")').first().click({timeout:4000}).catch(()=>{});
  await sleep(4000); await page.waitForLoadState("networkidle",{timeout:12000}).catch(()=>{});

  const rows=page.locator('tr').filter({has:page.locator('select')});
  const n=await rows.count().catch(()=>0);
  let filled=0; const seen=new Set(); const skipped=[];
  for(let i=0;i<n;i++){
    const row=rows.nth(i);
    const orderNo=((await row.innerText().catch(()=>"")).match(/Z\d{6,}/)||[])[0]||"";
    const t=map.get(orderNo);
    if(!t||seen.has(orderNo)) continue;
    // 가드: 이미 배달완료된 송장이면 입력 차단(교환 재배송 의심 — 옛 송장 재입력 사고 방지)
    if(await isDelivered(t)){ seen.add(orderNo); skipped.push({orderNo,t}); log(`  ⚠️ ${orderNo}: 송장 ${t} 이미 배달완료 → 재입력 차단(교환 재배송 의심, 새 송장 수동 확인 필요)`); continue; }
    const sel=row.locator('select').first();
    await sel.selectOption({label:/우체국택배/}).catch(async()=>{ await sel.selectOption({label:"우체국택배"}).catch(()=>{}); });
    let inputEl=row.locator('input[name*="invoice" i],input[id*="invoice" i],input[placeholder*="송장" i]').first();
    if(!(await inputEl.count())) inputEl=row.locator('input[type="text"]').first();
    await inputEl.fill(t).catch(async()=>{ await inputEl.click().catch(()=>{}); await inputEl.pressSequentially(t,{delay:30}).catch(()=>{}); });
    const v=await inputEl.inputValue().catch(()=>"");
    if(v===t){ filled++; seen.add(orderNo); log(`  ${orderNo}: 우체국택배 + 송장 ${t}`); }
    await sleep(250);
  }
  if(skipped.length){
    const msg=`⚠️ W컨셉 송장 재입력 차단 ${skipped.length}건 (이미 배달완료 = 교환 재배송 의심)\n`+skipped.map(s=>`- ${s.orderNo}: ${s.t}`).join("\n")+`\n→ 새 송장 발급/입력을 수동 확인하세요.`;
    log(msg);
    try{ await require("./telegramRelay").relayText(msg); }catch{}
  }
  if(!filled){ log("입력된 행 없음 — 저장 생략"); return {filled:0,saved:false,skipped}; }
  // 행 체크 (Ready 체크박스 name=chkItem) — 필터 체크박스 제외하고 JS 전체 체크
  await page.evaluate(()=>{ const cs=[...document.querySelectorAll('input[type=checkbox]')].filter(c=>!/all|chkall|res_sdate|exptcancel/i.test(c.id+c.name)); cs.forEach(c=>{ if(!c.checked){ c.checked=true; c.dispatchEvent(new Event('change',{bubbles:true})); } }); });
  await sleep(400);
  await page.getByRole("button",{name:/송장번호 저장/}).first().click({timeout:8000}).catch(async()=>{ await page.locator('button:has-text("송장번호 저장")').first().click({timeout:6000}).catch(()=>{}); });
  await sleep(5000);
  log(`W컨셉 송장입력 저장 시도 (${filled}건)`);
  return {filled, saved:true, skipped};
}

module.exports = { dispatchInvoicesOnPage };
