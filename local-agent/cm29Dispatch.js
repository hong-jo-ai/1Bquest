/**
 * 29CM 송장입력 (Phase2) — 출고관리에서 행별 택배사=우체국택배 + 운송장번호 입력 + 체크 → 출고 처리.
 * 송장 소스: pp_shipments(channel=29CM, submitted, regi_no). 주문번호(ORD...)로 행 매칭.
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
// 날짜 범위는 매 실행 오늘 기준 최근 90일 (고정값이면 당일 주문이 범위 밖으로 빠져 행을 못 읽음)
const _now=new Date(); const _start=ymd(new Date(_now.getTime()-90*864e5)); const _end=ymd(_now);
const SHIPMENT=`https://partner-order.29cm.co.kr/shipment?filter=TOTAL&orderStartDate=${_start}&orderEndDate=${_end}&datePeriod=3&page=1&size=100`;

(async()=>{
  const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data } = await sb.from("pp_shipments").select("order_number,regi_no").eq("channel","29CM").eq("req_type","1").eq("is_test",false).eq("status","submitted").not("regi_no","is",null);
  const map=new Map((data||[]).map(r=>[r.order_number, r.regi_no]));
  log(`29CM 송장 대상 ${map.size}건: ${[...map.entries()].map(([o,t])=>o+"→"+t).join(", ")}`);
  if(!map.size){ log("대상 없음 — 종료"); return; }

  const { page, context } = await getMarketplacePage("29cm", log);
  page.on("dialog", d=>{ log("DIALOG: "+d.message().slice(0,80)); d.accept().catch(()=>{}); });
  await ensureLoggedIn("29cm", page, log);
  await page.goto(SHIPMENT,{waitUntil:"domcontentloaded",timeout:60000}).catch(()=>{});
  await sleep(4000);
  await page.locator('button:has-text("검색하기")').first().click({timeout:6000}).catch(()=>{});
  await sleep(5000); await page.waitForLoadState("networkidle",{timeout:12000}).catch(()=>{});

  const rows = page.locator('tbody tr').filter({ has: page.locator('td') });
  const n = await rows.count().catch(()=>0);
  log("출고관리 행수: "+n);
  let filled=0;
  for(let i=0;i<n;i++){
    const row=rows.nth(i);
    const cells=await row.locator("td").allInnerTexts().catch(()=>[]);
    // 주문번호는 보통 독립 셀이지만, 날짜와 같은 셀에 묶이거나 셀 분할이 달라질 수 있어 행 전체 텍스트에서 추출(앵커 없이)
    const rowText=cells.join(" ").replace(/\s+/g," ").trim() || (await row.innerText().catch(()=>"")).replace(/\s+/g," ").trim();
    const orderNo=(rowText.match(/ORD\d{6,8}-\d+/)||[])[0]||"";
    const tracking=map.get(orderNo);
    if(!tracking){ log(`  행 ${i}: ${orderNo||"(주문번호 못읽음)"} — 대상 아님, 스킵`); continue; }
    // 1) 택배사 react-select → 우체국택배 (정확 매칭 + 검증)
    const ctrl=row.locator('.Select__control').first();
    await ctrl.click({timeout:5000}).catch(()=>{});
    await sleep(900);
    await page.locator('[class*="-option"], [id*="-option-"]').filter({hasText:/^우체국택배$/}).first().click({timeout:5000})
      .catch(async()=>{ await page.locator('[class*="-option"], [id*="-option-"]').filter({hasText:"우체국택배"}).first().click({timeout:4000}).catch(()=>{}); });
    await sleep(700);
    const carrierVal=(await ctrl.innerText().catch(()=>"")).replace(/\s+/g," ").trim();
    if(!/우체국택배/.test(carrierVal)){ log(`  ⚠️ ${orderNo}: 택배사 '${carrierVal}'(우체국택배 아님) — 이 행 스킵`); continue; }
    // 2) 운송장 번호 입력
    const inv=row.locator('input[placeholder*="운송장"]').first();
    await inv.fill(tracking).catch(async()=>{ await inv.click().catch(()=>{}); await inv.pressSequentially(tracking,{delay:30}).catch(()=>{}); });
    // 3) 행 체크 — input은 숨김, 형제 <label for> 클릭이 토글
    await row.locator('td').first().locator('label').first().click({timeout:4000}).catch(async()=>{ await row.locator('input[type=checkbox]').first().check({timeout:3000}).catch(()=>{}); });
    log(`  ✏️ ${orderNo}: 택배사 ${carrierVal} + 송장 ${tracking} + 체크`);
    filled++;
    await sleep(500);
  }
  const checked=await page.locator('tbody input[type=checkbox]:checked').count().catch(()=>0);
  log(`체크된 행: ${checked} (입력 ${filled})`);
  if(!filled){ log("입력된 행 없음 — 출고처리 생략"); await closeMarketplaceBrowsers(); return; }
  if(checked===0){ log("⚠️ 체크된 행 0 — 출고처리 생략(미선택 토스트 방지)"); await page.screenshot({path:"/tmp/29cm_dispatch.png"}).catch(()=>{}); await closeMarketplaceBrowsers(); return; }

  // 출고 처리
  log(`출고 처리 클릭`);
  await page.getByRole("button",{name:/출고\s*처리/}).first().click({timeout:8000}).catch(async()=>{ await page.locator('button:has-text("출고 처리")').first().click({timeout:6000}).catch(()=>{}); });
  await sleep(3000);
  // 확인 모달/다이얼로그 (커스텀 포함) 덤프 + 확인
  const dlg=page.locator('[role=dialog]:visible, .modal:visible, [class*="modal" i]:visible').last();
  if(await dlg.count()){ log("모달: "+(await dlg.innerText().catch(()=>"")).replace(/\s+/g," ").slice(0,200)); }
  await page.screenshot({path:"/tmp/29cm_dispatch.png"}).catch(()=>{});
  for(const t of ["확인","출고처리","예","처리"]){ const b=page.getByRole("button",{name:t,exact:true}).filter({visible:true}).first(); if(await b.count()){ await b.click({timeout:4000}).catch(()=>{}); log("모달 버튼 클릭: "+t); break; } }
  await sleep(5000); await page.waitForLoadState("networkidle",{timeout:12000}).catch(()=>{});
  log("출고처리 시도 완료 — 검색 후 잔여 확인 필요");
  await sleep(1500); await closeMarketplaceBrowsers().catch(()=>{});
})().catch(e=>{console.error("ERR",e);process.exit(1);});
