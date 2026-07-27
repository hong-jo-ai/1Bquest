/** W컨셉 Moloco 광고 — 계정별·캠페인별 현황 조회 (읽기 전용 probe).
 *  최근 N일(기본30) 각 계정: 총 집행 + 캠페인별 집행/노출/클릭/전환/매출(있으면) + ROAS.
 *  실행: node wconceptAdsProbe.js [days]
 */
require("dotenv").config({ override: true });
const fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const DASH = path.resolve(__dirname, "..");
function le(p){try{for(const l of fs.readFileSync(p,"utf8").split("\n")){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);if(!m)continue;let v=m[2].trim().replace(/^["']|["']$/g,"");if(!(m[1] in process.env))process.env[m[1]]=v;}}catch{}}
le(path.join(DASH,".env.supabase")); le(path.join(DASH,".env.local")); le(path.join(__dirname,".env"));
const env=(n)=>process.env[n]||"";
const REPORT=(id)=>`https://wconcept-mgmt.rmp-api.moloco.com/rmp/mgmt/v1/platforms/WCONCEPT/ad-accounts/${id}/report`;
const ACCOUNTS=[
  {key:"1",email:env("WCONCEPT_ADS_ACCOUNT_1_EMAIL"),pw:env("WCONCEPT_ADS_ACCOUNT_1_PW"),id:env("WCONCEPT_ADS_ACCOUNT_1_ID")},
  {key:"2",email:env("WCONCEPT_ADS_ACCOUNT_2_EMAIL"),pw:env("WCONCEPT_ADS_ACCOUNT_2_PW"),id:env("WCONCEPT_ADS_ACCOUNT_2_ID")},
].filter(a=>a.email&&a.pw);
function kstDate(off=0){const d=new Date(Date.now()+9*3600*1000);d.setUTCDate(d.getUTCDate()+off);return d.toISOString().slice(0,10);}
const won=n=>Math.round(n).toLocaleString();
const M=v=>Math.round(Number(v||0)/1e6); // micros→원

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
async function report(id,token,body){
  const r=await fetch(REPORT(id),{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify(body)});
  if(!r.ok)throw new Error(`report ${r.status}: ${(await r.text()).slice(0,160)}`);
  return (await r.json()).rows||[];
}

(async()=>{
  const days=parseInt(process.argv[2]||"30",10);
  const end=kstDate(0),start=kstDate(-days);
  console.log(`=== W컨셉 광고 계정별/캠페인별 (${start} ~ ${end}) ===\n`);
  for(const acc of ACCOUNTS){
    try{
      const {token,id}=await getAuth(acc);
      // 총합(DATE) + 캠페인별
      const tot=await report(id,token,{timezone:"Asia/Seoul",date_start:start,date_end:end,group_by:["CURRENCY"],order_by:[]});
      const camps=await report(id,token,{timezone:"Asia/Seoul",date_start:start,date_end:end,group_by:["CAMPAIGN"],order_by:[]});
      const totSpend=tot.reduce((s,r)=>s+M(r.money_spent),0);
      console.log(`\n■ 계정${acc.key} (${acc.email}, id=${id}) — 총 집행 ₩${won(totSpend)} / ${days}일 (일평균 ₩${won(totSpend/days)})`);
      if(camps[0])console.log("  [row 필드]",Object.keys(camps[0]).join(", "));
      // 캠페인 정렬·출력
      const rows=camps.map(r=>({
        name:r.campaign_title||r.campaign_name||r.campaign_id||r.title||"(이름?)",
        spend:M(r.money_spent),
        imp:Number(r.imp||r.impression||r.impressions||0),
        clk:Number(r.click||r.clicks||0),
        conv:Number(r.conversion||r.conversions||r.purchase||0),
        rev:M(r.revenue||r.attributed_revenue||r.conversion_value||r.sales||0),
      })).sort((a,b)=>b.spend-a.spend);
      for(const c of rows){
        const roas=c.spend&&c.rev?(c.rev/c.spend).toFixed(1):"-";
        console.log(`   · ${c.name} | 집행 ₩${won(c.spend)} | 노출 ${c.imp.toLocaleString()} | 클릭 ${c.clk} | 전환 ${c.conv} | 매출 ₩${won(c.rev)} | ROAS ${roas}`);
      }
      // 원시 첫 row 덤프(필드 확인용)
      if(camps[0])console.log("  [raw sample]",JSON.stringify(camps[0]).slice(0,400));
    }catch(e){console.log(`■ 계정${acc.key} 실패: ${e.message}`);}
  }
})().catch(e=>{console.error("ERR",e.message);process.exit(1);});
