/**
 * 식스샵 송장입력 (Phase2) — 주문 상세 '배송 정보'에서 택배사=우체국택배 + 송장번호 입력 → 배송 정보 저장.
 * 송장 소스: pp_shipments(channel=식스샵, submitted, regi_no). 주문번호로 주문 찾아 입력.
 *
 * ⚠️ 주문 상세는 IFRAME(src*="shopOrderDetail") 안에 렌더된다 — 메인 문서가 아니라 frameLocator 로 접근.
 *    송장칸 #parcelNumber, 택배사 select #dashboardOrderDetailShipping, 저장 버튼 "배송 정보 저장".
 * 멱등: 송장칸에 이미 값이 있으면(이미 입력됨) 스킵. SIXSHOP_DISPATCH_LIMIT 로 건수 제한(테스트용).
 */
require("dotenv").config({ override: true });
const os=require("os"), path=require("path"), fs=require("fs");
const DASH="/Users/mac/sungjo_ai/paulwise-dashboard";
function le(p){try{for(const l of fs.readFileSync(p,"utf8").split("\n")){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);if(!m)continue;let v=m[2].trim().replace(/^["']|["']$/g,"");if(!(m[1] in process.env))process.env[m[1]]=v;}}catch{}}
le(DASH+"/.env.supabase"); le(DASH+"/.env.local");
const { chromium } = require("playwright");
const { createClient } = require(DASH+"/node_modules/@supabase/supabase-js");
const { loginSixshop, ensureStore } = require("./sixshopSync");
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const log=(m)=>console.log(`[${new Date().toISOString()}] ${m}`);
const ORDERS_URL="https://www.sixshop.com/dashboard/shop-orders";

// ── 일반 주문: 상세 IFRAME(shopOrderDetail)의 배송 정보 칸에 송장 입력 ──
async function dispatchRegular(page, s){
  await page.goto(ORDERS_URL,{waitUntil:"domcontentloaded",timeout:60000}).catch(()=>{});
  await sleep(4500); await page.waitForLoadState("networkidle",{timeout:12000}).catch(()=>{});
  const cell=page.getByText(s.order_number,{exact:false}).first();
  if(!(await cell.count())){ log(`  ${s.order_number}(${s.recipient_name||""}): 목록에 없음(이미 처리/기간외) — 스킵`); return "skip"; }
  await cell.click({timeout:5000}).catch(()=>{});
  const frame=page.frameLocator('iframe[src*="shopOrderDetail"]');
  const inv=frame.locator('#parcelNumber');
  let hasInput=false;
  for(let t=0;t<15&&!hasInput;t++){ await sleep(1000); if(await inv.count().catch(()=>0)){ if(await inv.isVisible().catch(()=>false)) hasInput=true; } }
  if(!hasInput){ log(`  ${s.order_number}: 상세 송장칸 안 나타남 — 스킵`); await page.screenshot({path:"/tmp/sixshop_disp_fail.png"}).catch(()=>{}); return "skip"; }
  const cur=(await inv.inputValue().catch(()=>"")).trim();
  if(cur){ log(`  ${s.order_number}: 이미 송장(${cur}) 입력됨 — 스킵`); return "skip"; }
  await frame.locator('#dashboardOrderDetailShipping').selectOption({label:"우체국택배"}).catch(()=>{});
  await inv.fill(s.regi_no).catch(()=>{});
  if((await inv.inputValue().catch(()=>"")).trim()!==s.regi_no){ log(`  ⚠️ ${s.order_number}: 송장 입력 실패 — 스킵`); return "skip"; }
  await frame.locator('button:has-text("배송 정보 저장")').first().click({timeout:6000}).catch(()=>{});
  await sleep(2500);
  await frame.locator('button:has-text("확인")').first().click({timeout:2500}).catch(()=>{});
  await page.locator('button:has-text("확인")').filter({hasNotText:"취소"}).first().click({timeout:2500}).catch(()=>{});
  await sleep(2500);
  log(`  ✅ ${s.order_number}(${s.recipient_name||""}): [일반] 송장 ${s.regi_no} 저장`);
  return "ok";
}

// ── 네이버페이 주문형: 목록 체크박스 → '발송 처리' → 모달(배송방법=택배/택배회사=우체국택배/송장번호) → 처리하기 ──
async function dispatchNaverPay(page, s){
  await page.goto(ORDERS_URL,{waitUntil:"domcontentloaded",timeout:60000}).catch(()=>{});
  await sleep(4500); await page.waitForLoadState("networkidle",{timeout:12000}).catch(()=>{});
  // 주문 행 찾기 → 이미 발송됐으면 스킵(멱등), 아니면 체크박스 클릭(라벨 경유)
  const info=await page.evaluate((order)=>{
    const node=[...document.querySelectorAll("*")].find(e=>e.children.length===0&&(e.textContent||"").trim()===order);
    if(!node) return {st:"noorder"};
    let row=node;
    for(let i=0;i<10&&row;i++){ if(row.querySelector&&row.querySelector('input[type=checkbox]')) break; row=row.parentElement; }
    if(!row||!row.querySelector('input[type=checkbox]')) return {st:"nocb"};
    if(/배송\s*중|배송\s*완료|발송\s*완료|구매\s*확정/.test(row.textContent||"")) return {st:"shipped"};
    const cb=row.querySelector('input[type=checkbox]');
    const lab=cb.id?document.querySelector(`label[for="${cb.id}"]`):null;
    (lab||cb).click();
    return {st:"checked"};
  },s.order_number);
  if(info.st==="noorder"){ log(`  ${s.order_number}(${s.recipient_name||""}): 목록에 없음(이미 처리/기간외) — 스킵`); return "skip"; }
  if(info.st==="shipped"){ log(`  ${s.order_number}(${s.recipient_name||""}): 이미 발송됨(배송중) — 스킵`); return "skip"; }
  if(info.st!=="checked"){ log(`  ${s.order_number}: 체크박스 못 찾음 — 스킵`); return "skip"; }
  await sleep(1500);
  // '발송 처리' 버튼(선택 시 표시) 클릭
  const clicked=await page.evaluate(()=>{const b=[...document.querySelectorAll("button")].find(x=>/발송\s*처리/.test(x.innerText||"")&&x.getBoundingClientRect().height>0);if(b){b.click();return true;}return false;});
  if(!clicked){ log(`  ${s.order_number}: '발송 처리' 버튼 안나타남 — 스킵`); return "skip"; }
  // 모달: 배송방법=택배(DELIVERY) → 택배회사=우체국택배(EPOST) → 송장번호 → 처리하기
  const method=page.locator('select.js-deliveryMethodCodeSelect').first();
  try { await method.waitFor({state:"visible",timeout:8000}); } catch { log(`  ${s.order_number}: 발송처리 모달 안나타남 — 스킵`); return "skip"; }
  await method.selectOption("DELIVERY").catch(()=>{});
  await sleep(1000);
  await page.locator('select.js-deliveryCompanyCodeSelect').first().selectOption("EPOST").catch(()=>{});
  const tn=page.locator('input.js-trackingNumberInput').first();
  await tn.fill(s.regi_no).catch(()=>{});
  if((await tn.inputValue().catch(()=>"")).trim()!==s.regi_no){ log(`  ⚠️ ${s.order_number}: 송장 입력 실패 — 스킵`); return "skip"; }
  // 처리하기 = 보이는 버튼을 JS로 클릭(숨은 템플릿 버튼 회피)
  await page.evaluate(()=>{const b=[...document.querySelectorAll("button.js-operate")].find(x=>/처리하기/.test(x.innerText||"")&&x.getBoundingClientRect().height>0);b&&b.click();});
  await sleep(3500);
  // 성공 확인: "발송 처리가 완료되었습니다" 토스트
  const okMsg=await page.evaluate(()=>document.body.innerText.includes("발송 처리가 완료"));
  if(!okMsg){ log(`  ⚠️ ${s.order_number}: 처리하기 후 완료확인 못함 — 확인필요`); await page.screenshot({path:"/tmp/sixshop_naver_fail.png"}).catch(()=>{}); return "skip"; }
  log(`  ✅ ${s.order_number}(${s.recipient_name||""}): [네이버페이] 송장 ${s.regi_no} 발송처리`);
  return "ok";
}

(async()=>{
  const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
  // 최근 14일 접수분만 — 일일 실행이 과거 건(특히 송장칸 없는 네이버페이)을 무한 재확인하지 않게.
  const since=new Date(Date.now()-14*86400000).toISOString();
  const { data }=await sb.from("pp_shipments").select("order_number,recipient_name,regi_no").eq("channel","식스샵").eq("req_type","1").eq("is_test",false).eq("status","submitted").not("regi_no","is",null).gte("created_at",since).order("created_at",{ascending:false});
  let targets=data||[];
  if(process.env.ONLY_ORDER) targets=targets.filter(t=>t.order_number===process.env.ONLY_ORDER); // 단건 테스트용
  const limit=Number(process.env.SIXSHOP_DISPATCH_LIMIT||0);
  if(limit>0) targets=targets.slice(0,limit);
  log(`식스샵 송장 대상 ${data?.length||0}건${limit?` (LIMIT ${limit})`:""}`);
  if(!targets.length){ log("대상 없음"); return; }

  const profileDir=path.join(os.homedir(),".paulvice-marketplace-agent","sixshop");
  const ctx=await chromium.launchPersistentContext(profileDir,{headless:false,channel:"chrome",acceptDownloads:true,locale:"ko-KR",viewport:null,args:["--disable-blink-features=AutomationControlled","--start-maximized","--lang=ko-KR"],ignoreDefaultArgs:["--enable-automation"]});
  ctx.on("page",(p)=>p.on("dialog",d=>{log("DIALOG: "+d.message().slice(0,80));d.accept().catch(()=>{});}));
  let ok=0, skip=0, naver=0;
  try{
    const page=ctx.pages()[0]||await ctx.newPage();
    page.on("dialog",d=>{log("DIALOG: "+d.message().slice(0,80));d.accept().catch(()=>{});});
    if(!(await loginSixshop(page,log))) throw new Error("식스샵 로그인 실패");
    await ensureStore(page,"harriotwatches",log);

    for(const s of targets){
      // 주문번호 형식으로 유형 구분: 네이버페이 주문형 = 전부 숫자(예 2026060981562430), 일반 = 영숫자(예 20260610VNX94)
      const isNaverPay=/^\d{12,}$/.test(s.order_number);
      let res;
      try { res=isNaverPay ? await dispatchNaverPay(page,s) : await dispatchRegular(page,s); }
      catch(e){ log(`  ${s.order_number}: 예외 — ${e.message.slice(0,60)}`); res="skip"; }
      if(res==="ok"){ ok++; if(isNaverPay) naver++; } else skip++;
    }
    log(`식스샵 송장입력 완료: 성공 ${ok}건(네이버페이 ${naver}) / 스킵 ${skip}`);
  } finally { await ctx.close().catch(()=>{}); }
})().catch(e=>{console.error("ERR",e);process.exit(1);});
