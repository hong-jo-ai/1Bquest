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
      await page.goto("https://www.sixshop.com/dashboard/shop-orders",{waitUntil:"domcontentloaded",timeout:60000}).catch(()=>{});
      await sleep(4500); await page.waitForLoadState("networkidle",{timeout:12000}).catch(()=>{});
      const cell=page.getByText(s.order_number,{exact:false}).first();
      if(!(await cell.count())){ log(`  ${s.order_number}(${s.recipient_name||""}): 목록에 없음(이미 처리/기간외) — 스킵`); skip++; continue; }
      await cell.click({timeout:5000}).catch(()=>{});

      // 상세 iframe 안의 송장칸 대기. 네이버페이 주문형은 송장칸이 없으므로 빠르게 감지해 스킵.
      const frame=page.frameLocator('iframe[src*="shopOrderDetail"]');
      const inv=frame.locator('#parcelNumber');
      let hasInput=false, isNaver=false;
      for(let t=0;t<15;t++){
        await sleep(1000);
        if(await inv.count().catch(()=>0)){ if(await inv.isVisible().catch(()=>false)){ hasInput=true; break; } }
        // 네이버페이 주문형은 상세 헤더(메인 문서)에 "네이버페이 주문형" 표기 + 송장칸 없음
        if(await page.locator('text=네이버페이 주문형').count().catch(()=>0)){ isNaver=true; break; }
      }
      if(!hasInput){
        if(isNaver){ log(`  ${s.order_number}(${s.recipient_name||""}): 네이버페이 주문 — sixshop 송장칸 없음(네이버페이센터 처리) 스킵`); naver++; }
        else { log(`  ${s.order_number}: 상세 송장칸 안 나타남 — 스킵`); await page.screenshot({path:"/tmp/sixshop_disp_fail.png"}).catch(()=>{}); skip++; }
        continue;
      }

      // 멱등: 이미 송장 입력돼 있으면 건너뜀
      const cur=(await inv.inputValue().catch(()=>"")).trim();
      if(cur){ log(`  ${s.order_number}: 이미 송장(${cur}) 입력됨 — 스킵`); skip++; continue; }

      // 택배사 = 우체국택배 (기본값이지만 확실히)
      await frame.locator('#dashboardOrderDetailShipping').selectOption({label:"우체국택배"}).catch(()=>{});
      // 송장번호 입력
      await inv.fill(s.regi_no).catch(()=>{});
      const v=(await inv.inputValue().catch(()=>"")).trim();
      if(v!==s.regi_no){ log(`  ⚠️ ${s.order_number}: 송장 입력 실패('${v}') — 스킵`); skip++; continue; }
      // 저장
      await frame.locator('button:has-text("배송 정보 저장")').first().click({timeout:6000}).catch(()=>{});
      await sleep(2500);
      // 저장 확인 모달(있으면) — 프레임/메인 양쪽 확인 버튼
      await frame.locator('button:has-text("확인")').first().click({timeout:2500}).catch(()=>{});
      await page.locator('button:has-text("확인")').filter({hasNotText:"취소"}).first().click({timeout:2500}).catch(()=>{});
      await sleep(2500);
      log(`  ✅ ${s.order_number}(${s.recipient_name||""}): 송장 ${s.regi_no} 저장`);
      ok++;
    }
    log(`식스샵 송장입력 완료: 성공 ${ok} / 스킵 ${skip} / 네이버페이 ${naver}`);
  } finally { await ctx.close().catch(()=>{}); }
})().catch(e=>{console.error("ERR",e);process.exit(1);});
