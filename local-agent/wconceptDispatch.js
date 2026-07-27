/**
 * W컨셉 송장입력 (Phase2) 독립 실행본 — 로그인 후 가드된 dispatchInvoicesOnPage 위임.
 * 송장입력 로직(배달완료 재입력 차단 가드 포함)은 wconceptInvoice.js 단일 소스 사용.
 * 계정1(icaruse2000)+계정2(plvekorea) 모두 순회. WC_ACCOUNT=1|2 로 단일계정 지정 가능. SMS 필요.
 */
require("dotenv").config({ override: true });
const os=require("os"), path=require("path"), fs=require("fs");
const DASH="/Users/mac/sungjo_ai/paulwise-dashboard";
function le(p){try{for(const l of fs.readFileSync(p,"utf8").split("\n")){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);if(!m)continue;let v=m[2].trim().replace(/^["']|["']$/g,"");if(!(m[1] in process.env))process.env[m[1]]=v;}}catch{}}
le(DASH+"/.env.supabase"); le(DASH+"/.env.local");
const { chromium } = require("playwright");
const { loginWconcept, ACCOUNTS } = require("./wconceptSync");
const { dispatchInvoicesOnPage } = require("./wconceptInvoice");
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const log=(m)=>console.log(`[${new Date().toISOString()}] ${m}`);
const READY="https://newpin.wconcept.co.kr/Order/LstShippingOrderReady";

(async()=>{
  const accounts = process.env.WC_ACCOUNT ? ACCOUNTS.filter(a=>a.key===process.env.WC_ACCOUNT) : ACCOUNTS;
  let totalFilled=0;
  for(const acc of accounts){
    log(`── W컨셉 계정 ${acc.key}(${acc.id}) 송장입력 ──`);
    const ctx=await chromium.launchPersistentContext(path.join(os.homedir(),".paulvice-marketplace-agent",`wconcept_${acc.key}`),{headless:false,channel:"chrome",acceptDownloads:true,locale:"ko-KR",viewport:null,args:["--disable-blink-features=AutomationControlled","--start-maximized","--lang=ko-KR"],ignoreDefaultArgs:["--enable-automation"]});
    try{
      const page=ctx.pages()[0]||await ctx.newPage();
      await page.goto(READY,{waitUntil:"domcontentloaded",timeout:60000}).catch(()=>{});
      await sleep(3000);
      if(/Auth\/Login/i.test(page.url())){ const ok=await loginWconcept(ctx,page,acc,log); if(!ok){ log(`계정 ${acc.key} 로그인 실패 — 스킵`); continue; } }
      const r=await dispatchInvoicesOnPage(page, log);
      totalFilled += r.filled||0;
      log(`계정 ${acc.key} 송장입력: ${r.filled}건 입력${r.saved?" 저장":""}${r.skipped&&r.skipped.length?` / 배달완료 차단 ${r.skipped.length}건`:""}`);
    } catch(e){ log(`계정 ${acc.key} 오류: ${e.message}`); }
    finally { await ctx.close().catch(()=>{}); }
  }
  log(`=== W컨셉 송장입력 종료: 총 ${totalFilled}건 ===`);
})().catch(e=>{console.error("ERR",e);process.exit(1);});
