/** W컨셉 광고 주간 리포트 — 계정별·캠페인별 집행/ROAS 를 텔레그램으로 보고.
 *  최근 7일 + 직전 7일 비교, 손익분기(ROAS 2.1) 대비 + 예산 소진/효율 액션 플래그.
 *  실행: node wconceptAdsReport.js [days=7]
 */
require("dotenv").config({ override: true });
const fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const DASH = path.resolve(__dirname, "..");
function le(p){try{for(const l of fs.readFileSync(p,"utf8").split("\n")){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);if(!m)continue;let v=m[2].trim().replace(/^["']|["']$/g,"");if(!(m[1] in process.env))process.env[m[1]]=v;}}catch{}}
le(path.join(DASH,".env.supabase")); le(path.join(DASH,".env.local")); le(path.join(__dirname,".env"));
const env=(n)=>process.env[n]||"";
const REPORT=(id)=>`https://wconcept-mgmt.rmp-api.moloco.com/rmp/mgmt/v1/platforms/WCONCEPT/ad-accounts/${id}/report`;
const { relayText } = require("./telegramRelay");

// 손익분기 ROAS = 1 / 공헌이익률. 에끌라 공헌이익 48% → BE ROAS ≈ 2.1
const BE_ROAS = 2.1;
const ACCOUNTS=[
  {key:"1",label:"계정1(에끌라 메인)",email:env("WCONCEPT_ADS_ACCOUNT_1_EMAIL"),pw:env("WCONCEPT_ADS_ACCOUNT_1_PW"),id:env("WCONCEPT_ADS_ACCOUNT_1_ID")},
  {key:"2",label:"계정2",email:env("WCONCEPT_ADS_ACCOUNT_2_EMAIL"),pw:env("WCONCEPT_ADS_ACCOUNT_2_PW"),id:env("WCONCEPT_ADS_ACCOUNT_2_ID")},
].filter(a=>a.email&&a.pw);
function kstDate(off=0){const d=new Date(Date.now()+9*3600*1000);d.setUTCDate(d.getUTCDate()+off);return d.toISOString().slice(0,10);}
const won=n=>Math.round(n).toLocaleString();
const M=v=>Math.round(Number(v||0)/1e6);

async function getAuth(acc){
  const profile=path.join(__dirname,`.moloco-ads-${acc.key}`);
  const ctx=await chromium.launchPersistentContext(profile,{channel:"chrome",headless:true,viewport:{width:1366,height:900}});
  try{
    const page=ctx.pages()[0]||(await ctx.newPage());
    await page.goto("https://wconcept.rmp-portal.moloco.com/sponsored-ads",{waitUntil:"networkidle",timeout:60000}).catch(()=>{});
    await page.waitForTimeout(1500);
    if(/signin/.test(page.url())){
      await page.fill("#email",acc.email);await page.fill("#current-password",acc.pw);
      await Promise.all([page.waitForLoadState("networkidle",{timeout:60000}).catch(()=>{}),page.click('button:has-text("로그인")')]);
      await page.waitForTimeout(5000);
    }
    if(/signin/.test(page.url()))throw new Error("로그인 실패");
    const urlId=(page.url().match(/\/a\/(\d+)/)||[])[1];
    const token=await page.evaluate(()=>{try{return JSON.parse(localStorage.getItem("RMP_AUTH_REACT.RMP_AUTH_TOKEN.WCONCEPT")).token;}catch{return null;}});
    if(!token)throw new Error("토큰 없음");
    return {token,id:acc.id||urlId};
  }finally{await ctx.close();}
}
async function rep(id,token,start,end,group){
  const r=await fetch(REPORT(id),{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({timezone:"Asia/Seoul",date_start:start,date_end:end,group_by:group,order_by:[]})});
  if(!r.ok)throw new Error(`report ${r.status}`);
  return (await r.json()).rows||[];
}
const sumSpendRev=rows=>rows.reduce((a,r)=>({s:a.s+M(r.money_spent),v:a.v+M(r.revenue)}),{s:0,v:0});

async function main(){
  const days=parseInt(process.argv[2]||"7",10);
  const end=kstDate(0), start=kstDate(-days), prevEnd=kstDate(-days-1), prevStart=kstDate(-days*2);
  const lines=[`📊 W컨셉 광고 주간 리포트 (${start}~${end}, 최근 ${days}일)`];
  for(const acc of ACCOUNTS){
    try{
      const {token,id}=await getAuth(acc);
      const cur=sumSpendRev(await rep(id,token,start,end,["CURRENCY"]));
      const prev=sumSpendRev(await rep(id,token,prevStart,prevEnd,["CURRENCY"]));
      const camps=(await rep(id,token,start,end,["CAMPAIGN"])).map(r=>({name:r.campaign_title||r.campaign_id,s:M(r.money_spent),v:M(r.revenue),conv:Number(r.purchase_count||0)})).filter(c=>c.s>0).sort((a,b)=>b.s-a.s);
      const roas=cur.s?(cur.v/cur.s):0;
      const proas=prev.s?(prev.v/prev.s):0;
      const perDay=cur.s/days;
      if(cur.s===0){lines.push(`\n■ ${acc.label}: 집행 ₩0 (정지/휴면)`);continue;}
      lines.push(`\n■ ${acc.label} (id ${id})`);
      lines.push(`  집행 ₩${won(cur.s)} (일 ${won(perDay)}) · 매출 ₩${won(cur.v)}`);
      lines.push(`  ROAS ${roas.toFixed(1)} (직전주 ${proas?proas.toFixed(1):"-"}) · 손익분기 ${BE_ROAS}`);
      for(const c of camps)lines.push(`   · ${c.name}: ₩${won(c.s)} → 매출 ₩${won(c.v)} (ROAS ${c.s?(c.v/c.s).toFixed(1):"-"}, 전환 ${c.conv})`);
      // 액션 플래그
      const flags=[];
      if(roas<BE_ROAS) flags.push("🔴 손익분기 미달 — 예산 줄이거나 캠페인 점검");
      else if(roas<4) flags.push("🟡 ROAS 4 미만 — 예산 소폭 감액 검토");
      if(proas&&roas<proas*0.7) flags.push("🟡 전주 대비 ROAS 급락");
      // 예산 소진 여유: 일집행이 목표(2만)보다 충분히 낮은데 ROAS 높으면 → 묶음캠페인 여력
      if(perDay<16000 && roas>=6) flags.push("🟢 예산 여유+고ROAS → '기타 시계 묶음' 캠페인 추가 여력");
      if(flags.length)lines.push("  "+flags.join("\n  "));
    }catch(e){lines.push(`\n■ ${acc.label}: 조회 실패 (${e.message})`);}
  }
  const msg=lines.join("\n");
  console.log(msg);
  await relayText(msg).catch(e=>console.error("텔레그램 실패",e.message));
}
main().catch(e=>{console.error("ERR",e.message);process.exit(1);});
