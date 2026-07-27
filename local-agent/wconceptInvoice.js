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
  const {data}=await sb.from("pp_shipments").select("order_number,regi_no,created_at").eq("channel","W컨셉").eq("req_type","1").eq("is_test",false).eq("status","submitted").not("regi_no","is",null).order("created_at",{ascending:true});
  // 교환/재발송은 주문번호에 -EX/-RE 접미사를 붙여 접수(같은 W컨셉 주문번호). 페이지 행은 접미사 없는 Z번호라
  // 접미사를 벗겨 정규화하고, created_at 오름차순이라 나중(=최신) 접수가 덮어써 새 송장이 옛 송장을 이김.
  const m=new Map();
  for(const r of data||[]){ const base=String(r.order_number).replace(/-(EX|RE)\d*$/i,""); m.set(base, r.regi_no); }
  return m;
}

/** 로그인된 page 로 Ready 송장입력 수행. 반환 {filled, saved}. 절대 throw 안 하도록 호출측에서 catch 권장. */
async function dispatchInvoicesOnPage(page, log=console.log){
  const map=await fetchTrackMap(log);
  if(!map.size){ log("W컨셉 송장 대상 없음"); return {filled:0,saved:false}; }
  log(`W컨셉 송장입력 대상 ${map.size}건`);
  const dialogs=[];
  page.on("dialog", d=>{ dialogs.push(d.message()); log("DIALOG: "+d.message().slice(0,80)); d.accept().catch(()=>{}); });
  await page.goto(READY,{waitUntil:"domcontentloaded",timeout:60000}).catch(()=>{});
  await sleep(3000);
  await page.locator('button:has-text("1개월"),a:has-text("1개월")').first().click({timeout:4000}).catch(()=>{});
  await page.locator('#btnSearch,button:has-text("조회")').first().click({timeout:4000}).catch(()=>{});
  await sleep(4000); await page.waitForLoadState("networkidle",{timeout:12000}).catch(()=>{});

  const rows=page.locator('tr').filter({has:page.locator('select')});
  const n=await rows.count().catch(()=>0);
  // ⚠️ 다상품 주문 = 상품(행)별로 모두 채워야 함(한 주문이 N개 상품행). 한 주문의 첫 행만 채우면
  //    나머지 상품이 미출고로 남음(2026-07-01 버그수정, 29CM와 동일). seen 스킵 제거 — 같은 주문의
  //    모든 상품행에 같은 송장을 채운다. 배달완료 가드만 주문당 1회 체크(중복 API 방지).
  let filled=0; const filledRows=[]; const checkedDelivery=new Set(); const deliveredOrders=new Set(); const skipped=[];
  for(let i=0;i<n;i++){
    const row=rows.nth(i);
    const orderNo=((await row.innerText().catch(()=>"")).match(/Z\d{6,}/)||[])[0]||"";
    const t=map.get(orderNo);
    if(!t) continue;
    if(deliveredOrders.has(orderNo)) continue; // 배달완료 판정된 주문의 다른 상품행도 스킵
    // 가드: 이미 배달완료된 송장이면 입력 차단(교환 재배송 의심). 주문당 1회만 체크.
    if(!checkedDelivery.has(orderNo)){
      checkedDelivery.add(orderNo);
      if(await isDelivered(t)){ deliveredOrders.add(orderNo); skipped.push({orderNo,t}); log(`  ⚠️ ${orderNo}: 송장 ${t} 이미 배달완료 → 재입력 차단(교환 재배송 의심, 새 송장 수동 확인 필요)`); continue; }
    }
    const sel=row.locator('select').first();
    await sel.selectOption({label:/우체국택배/}).catch(async()=>{ await sel.selectOption({label:"우체국택배"}).catch(()=>{}); });
    let inputEl=row.locator('input[name*="invoice" i],input[id*="invoice" i],input[placeholder*="송장" i]').first();
    if(!(await inputEl.count())) inputEl=row.locator('input[type="text"]').first();
    await inputEl.fill(t).catch(async()=>{ await inputEl.click().catch(()=>{}); await inputEl.pressSequentially(t,{delay:30}).catch(()=>{}); });
    const v=await inputEl.inputValue().catch(()=>"");
    if(v===t){ filled++; filledRows.push(i); log(`  ${orderNo}: 우체국택배 + 송장 ${t} (행 ${i+1})`); }
    await sleep(250);
  }
  if(skipped.length){
    const msg=`⚠️ W컨셉 송장 재입력 차단 ${skipped.length}건 (이미 배달완료 = 교환 재배송 의심)\n`+skipped.map(s=>`- ${s.orderNo}: ${s.t}`).join("\n")+`\n→ 새 송장 발급/입력을 수동 확인하세요.`;
    log(msg);
    try{ await require("./telegramRelay").relayText(msg); }catch{}
  }
  if(!filled){ log("입력된 행 없음 — 저장 생략"); return {filled:0,saved:false,skipped}; }
  // ⚠️ 반드시 '채운 행만' 체크한다. 예전엔 페이지의 모든 체크박스를 켰는데(check-all), 매칭 안 되거나
  //    아직 송장이 없는(=미접수) 행까지 함께 선택돼 W컨셉이 "택배사를 선택해 주십시오"로 저장을
  //    '전체' 거부 → 채운 건까지 하나도 저장 안 됨. 그런데 코드는 saved:true를 반환해 조용히 성공으로
  //    보고 → 매일 같은 주문이 상품준비중에 남고, 결국 배달완료 후 위 재입력차단 가드에 걸려 영구 미출고.
  //    (plvekorea 백로그 누적 사고, 2026-07-21 수정.) 이제 입력 성공한 행의 체크박스만 켠다.
  for(const idx of filledRows){
    const cb=rows.nth(idx).locator('input[type=checkbox]').first();
    if(await cb.count().catch(()=>0)){
      await cb.check({timeout:2000}).catch(async()=>{ await cb.evaluate(el=>{ el.checked=true; el.dispatchEvent(new Event("change",{bubbles:true})); }).catch(()=>{}); });
    }
  }
  await sleep(400);
  const dlgBefore=dialogs.length;
  await page.getByRole("button",{name:/송장번호 저장/}).first().click({timeout:8000}).catch(async()=>{ await page.locator('button:has-text("송장번호 저장")').first().click({timeout:6000}).catch(()=>{}); });
  await sleep(5000);
  // 저장 결과 판정 — 성공 확인 다이얼로그("…처리되었습니다")가 떠야 실제 저장. "택배사를 선택"·"송장번호를
  //   입력" 등 검증 다이얼로그가 뜨면 거부(=미저장)다. 조용한 성공보고 재발 방지: 미저장이면 텔레그램 알림.
  const after=dialogs.slice(dlgBefore);
  const ok=after.some(m=>/처리되었습니다|저장되었습니다|정상.*처리|완료되었습니다/.test(m));
  const errMsg=after.find(m=>/택배사를?\s*선택|송장번호를?\s*입력|선택해\s*주|입력해\s*주/.test(m));
  if(!ok){
    const detail=errMsg?errMsg.replace(/\s+/g," ").slice(0,60):"성공 확인 다이얼로그 없음";
    log(`❌ W컨셉 송장 저장 실패(${filled}건 미저장): ${detail}`);
    try{ await require("./telegramRelay").relayText(`❌ W컨셉 송장 저장 실패 — ${filled}건 미저장\n사유: ${detail}\n→ 상품준비중 목록 수동 확인 필요`); }catch{}
    return {filled, saved:false, skipped, error:detail};
  }
  log(`W컨셉 송장입력 저장 완료 (${filled}건)`);
  return {filled, saved:true, skipped};
}

module.exports = { dispatchInvoicesOnPage };
