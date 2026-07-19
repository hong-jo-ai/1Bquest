/**
 * 29CM 송장입력 (Phase2) — 출고관리에서 행별 택배사=우체국택배 + 운송장번호 입력 + 체크 → 출고 처리.
 * 송장 소스: pp_shipments(channel=29CM, submitted, regi_no). 주문번호(ORD...)로 행 매칭.
 * ⚠️ 한 주문에 상품 2개 이상이면 그리드에 행이 여러 개 → 각 행마다 같은 송장을 모두 입력해야 함.
 *    → 멀티패스(최대 3회): 채워서 출고처리 → 재검색 → 남은 행 재시도 (한 행만 넣고 끝나는 버그 방지).
 * 출고처리 후 주문은 출고관리에서 빠지므로 재실행 멱등(다음엔 행 없음).
 */
require("dotenv").config({ override: true });
const fs=require("fs"), path=require("path");
const DASH="/Users/mac/sungjo_ai/paulwise-dashboard";
function le(p){try{for(const l of fs.readFileSync(p,"utf8").split("\n")){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);if(!m)continue;let v=m[2].trim().replace(/^["']|["']$/g,"");if(!(m[1] in process.env))process.env[m[1]]=v;}}catch{}}
le(DASH+"/.env.supabase"); le(DASH+"/.env.local");
const { createClient } = require(DASH+"/node_modules/@supabase/supabase-js");
const { getMarketplacePage, ensureLoggedIn, closeMarketplaceBrowsers } = require("./marketplaceSync");
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const log=(m)=>console.log(`[${new Date().toISOString()}] ${m}`);
function ymd(d){ return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10); }
const _now=new Date(); const _start=ymd(new Date(_now.getTime()-90*864e5)); const _end=ymd(_now);
const SHIPMENT=`https://partner-order.29cm.co.kr/shipment?filter=TOTAL&orderStartDate=${_start}&orderEndDate=${_end}&datePeriod=3&page=1&size=100`;

// 택배사 react-select → 우체국택배 (열기→옵션클릭→검증, 1회 재시도)
async function selectCarrier(page, row){
  const ctrl=row.locator('.Select__control').first();
  for(let attempt=0; attempt<2; attempt++){
    const cur=(await ctrl.innerText().catch(()=>"")).replace(/\s+/g," ").trim();
    if(/우체국택배/.test(cur)) return cur;
    await ctrl.click({timeout:5000}).catch(()=>{});
    await sleep(900);
    await page.locator('[class*="-option"], [id*="-option-"]').filter({hasText:/^우체국택배$/}).first().click({timeout:4000})
      .catch(async()=>{ await page.locator('[class*="-option"], [id*="-option-"]').filter({hasText:"우체국택배"}).first().click({timeout:3500}).catch(()=>{}); });
    await sleep(700);
    const v=(await ctrl.innerText().catch(()=>"")).replace(/\s+/g," ").trim();
    if(/우체국택배/.test(v)) return v;
    await page.keyboard.press("Escape").catch(()=>{});
    await sleep(300);
  }
  return (await ctrl.innerText().catch(()=>"")).replace(/\s+/g," ").trim();
}

// 현재 그리드의 모든 대상 행을 채우고 체크. 반환: 입력 행 수
async function fillGrid(page, map){
  const rows = page.locator('tbody tr').filter({ has: page.locator('td') });
  const n = await rows.count().catch(()=>0);
  log("출고관리 행수: "+n);
  let filled=0, lastOrder="";
  for(let i=0;i<n;i++){
    const row=rows.nth(i);
    const cells=await row.locator("td").allInnerTexts().catch(()=>[]);
    const rowText=cells.join(" ").replace(/\s+/g," ").trim() || (await row.innerText().catch(()=>"")).replace(/\s+/g," ").trim();
    let orderNo=(rowText.match(/ORD\d{6,8}-\d+/)||[])[0]||"";
    // 멀티라인 주문: 2번째 상품 행에 주문번호가 비어있으면 직전 주문번호 승계
    if(!orderNo && lastOrder && map.has(lastOrder)) orderNo=lastOrder;
    if(orderNo) lastOrder=orderNo;
    const tracking=map.get(orderNo);
    if(!tracking){ log(`  행 ${i}: ${orderNo||"(주문번호 못읽음)"} — 대상 아님, 스킵`); continue; }
    // 이미 체크된 행이면 건너뜀(중복 입력 방지)
    const already=await row.locator('input[type=checkbox]:checked').count().catch(()=>0);
    if(already){ log(`  행 ${i} ${orderNo}: 이미 체크됨 — 유지`); filled++; continue; }
    // 1) 택배사
    const carrierVal=await selectCarrier(page, row);
    if(!/우체국택배/.test(carrierVal)){ log(`  ⚠️ 행 ${i} ${orderNo}: 택배사 '${carrierVal}'(우체국택배 아님) — 이번 패스 스킵`); continue; }
    // 2) 운송장 번호
    const inv=row.locator('input[placeholder*="운송장"]').first();
    await inv.fill(tracking).catch(async()=>{ await inv.click().catch(()=>{}); await inv.pressSequentially(tracking,{delay:30}).catch(()=>{}); });
    // 3) 행 체크
    await row.locator('td').first().locator('label').first().click({timeout:4000}).catch(async()=>{ await row.locator('input[type=checkbox]').first().check({timeout:3000}).catch(()=>{}); });
    log(`  ✏️ 행 ${i} ${orderNo}: 택배사 ${carrierVal} + 송장 ${tracking} + 체크`);
    filled++;
    await sleep(400);
  }
  return filled;
}

(async()=>{
  const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data } = await sb.from("pp_shipments").select("order_number,regi_no").eq("channel","29CM").eq("req_type","1").eq("is_test",false).eq("status","submitted").not("regi_no","is",null);
  const map=new Map((data||[]).map(r=>[r.order_number, r.regi_no]));
  log(`29CM 송장 대상 ${map.size}건: ${[...map.entries()].map(([o,t])=>o+"→"+t).join(", ")}`);
  if(!map.size){ log("대상 없음 — 종료"); return; }

  const { page } = await getMarketplacePage("29cm", log);
  page.on("dialog", d=>{ log("DIALOG: "+d.message().slice(0,80)); d.accept().catch(()=>{}); });
  await ensureLoggedIn("29cm", page, log);

  let totalShipped=0;
  for(let pass=1; pass<=3; pass++){
    log(`--- 패스 ${pass} ---`);
    await page.goto(SHIPMENT,{waitUntil:"domcontentloaded",timeout:60000}).catch(()=>{});
    await sleep(4000);
    await page.locator('button:has-text("검색하기")').first().click({timeout:6000}).catch(()=>{});
    await sleep(5000); await page.waitForLoadState("networkidle",{timeout:12000}).catch(()=>{});

    const filled=await fillGrid(page, map);
    if(!filled){ log(`패스 ${pass}: 입력할 대상 행 없음 — 종료`); break; }
    const checked=await page.locator('tbody input[type=checkbox]:checked').count().catch(()=>0);
    log(`패스 ${pass}: 입력 ${filled} / 체크 ${checked}`);
    if(checked===0){ log("⚠️ 체크된 행 0 — 출고처리 생략"); await page.screenshot({path:"/tmp/29cm_dispatch.png"}).catch(()=>{}); break; }

    // 출고 처리
    log(`출고 처리 클릭`);
    await page.getByRole("button",{name:/출고\s*처리/}).first().click({timeout:8000}).catch(async()=>{ await page.locator('button:has-text("출고 처리")').first().click({timeout:6000}).catch(()=>{}); });
    await sleep(3000);
    // ⚠️ 화면 우상단 '모바일 리포트 출시' 토스트에도 '확인' 버튼이 있어, 페이지 전역 .first()로
    //    '확인'을 누르면 토스트만 닫히고 출고처리 모달은 확정 안 됨 → 주문이 큐에 계속 남는다.
    //    반드시 출고처리 모달 컨테이너로 스코프해서 확인을 누른다.
    const confirmScope = page.locator('div').filter({ hasText: /출고 처리 하시겠습니까|배송시작 상태로 변경/ });
    const confirmBtn = confirmScope.getByRole("button",{name:"확인",exact:true}).first();
    if(await confirmBtn.count().catch(()=>0)){
      log("출고처리 모달 확인 클릭(모달 스코프)");
      await confirmBtn.click({timeout:5000}).catch(async()=>{ await confirmBtn.click({force:true,timeout:3000}).catch(()=>{}); });
    } else {
      log("⚠️ 출고처리 확인 모달 못 찾음 — 폴백(전역 확인) 시도");
      await page.getByRole("button",{name:"확인",exact:true}).filter({visible:true}).last().click({timeout:4000}).catch(()=>{});
    }
    await sleep(5000); await page.waitForLoadState("networkidle",{timeout:12000}).catch(()=>{});
    totalShipped+=checked;
    log(`패스 ${pass}: 출고처리 완료 (누적 ${totalShipped}행)`);
    await sleep(2000);
  }
  log(`=== 29CM 송장입력 종료: 총 ${totalShipped}행 출고 ===`);
  await sleep(1000); await closeMarketplaceBrowsers().catch(()=>{});
})().catch(e=>{console.error("ERR",e);process.exit(1);});
