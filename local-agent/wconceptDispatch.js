/**
 * W컨셉 송장입력 (Phase2) 독립 실행본 — 로그인 후 가드된 dispatchInvoicesOnPage 위임.
 * 송장입력 로직(배달완료 재입력 차단 가드 포함)은 wconceptInvoice.js 단일 소스 사용. 계정1만. SMS 필요.
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
  const acc=ACCOUNTS[0];
  const ctx=await chromium.launchPersistentContext(path.join(os.homedir(),".paulvice-marketplace-agent",`wconcept_${acc.key}`),{headless:false,channel:"chrome",acceptDownloads:true,locale:"ko-KR",viewport:null,args:["--disable-blink-features=AutomationControlled","--start-maximized","--lang=ko-KR"],ignoreDefaultArgs:["--enable-automation"]});
  try{
    const page=ctx.pages()[0]||await ctx.newPage();
    await page.goto(READY,{waitUntil:"domcontentloaded",timeout:60000}).catch(()=>{});
    await sleep(3000);
    if(/Auth\/Login/i.test(page.url())){ const ok=await loginWconcept(ctx,page,acc,log); if(!ok)throw new Error("로그인 실패"); }
    const r=await dispatchInvoicesOnPage(page, log);
    log(`송장입력 결과: ${r.filled}건 입력${r.saved?" 저장":""}${r.skipped&&r.skipped.length?` / 배달완료 차단 ${r.skipped.length}건`:""}`);
  } finally { await ctx.close().catch(()=>{}); }
})().catch(e=>{console.error("ERR",e);process.exit(1);});
