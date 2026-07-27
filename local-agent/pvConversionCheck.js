/** 폴바이스 전환 회복 점검 — 웰컴팝업 OFF(2026-07-08) 전/후 주문 비교 → 텔레그램. 실행 후 자기 launchd 정리. */
const fs=require("fs");const {execSync}=require("child_process");const DASH="/Users/mac/sungjo_ai/paulwise-dashboard";
function le(p){try{for(const l of fs.readFileSync(p,"utf8").split("\n")){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);if(!m)continue;let v=m[2].trim().replace(/^["']|["']$/g,"");if(!(m[1] in process.env))process.env[m[1]]=v;}}catch{}}
le(DASH+"/.env.supabase");le(DASH+"/.env.local");le(DASH+"/local-agent/.env");
const {createClient}=require(DASH+"/node_modules/@supabase/supabase-js");
async function tg(text){
  const t=process.env.TELEGRAM_BOT_TOKEN, c=process.env.TELEGRAM_CHAT_ID;
  await fetch(`https://api.telegram.org/bot${t}/sendMessage`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chat_id:c,text,parse_mode:"HTML"})});
}
(async()=>{
  const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
  const {data}=await sb.from("kv_store").select("data").eq("key","cafe24_refresh_token").maybeSingle();
  let tok=data.data; if(typeof tok==="string"){try{tok=JSON.parse(tok);}catch{}}
  const hdr={Authorization:`Bearer ${tok.access_token}`,"X-Cafe24-Api-Version":"2026-03-01"};
  const H="https://icaruse2000.cafe24api.com/api/v2/admin";
  const cnt=async d=>{const j=await (await fetch(`${H}/orders/count?start_date=${d}T00:00:00+09:00&end_date=${d}T23:59:59+09:00`,{headers:hdr})).json();return j.count||0;};
  const dstr=off=>{const d=new Date();d.setDate(d.getDate()+off);return d.toISOString().slice(0,10);};
  // 팝업전 baseline: 6/25~6/30, 팝업중: 7/1~7/7, 팝업OFF후: 7/8~어제
  const preDates=["2026-06-25","2026-06-26","2026-06-27","2026-06-28","2026-06-29","2026-06-30"];
  const popupDates=["2026-07-01","2026-07-02","2026-07-03","2026-07-04","2026-07-05","2026-07-06","2026-07-07"];
  const postDates=[]; for(let i=1;i<=6;i++){const d=dstr(-i); if(d>="2026-07-08")postDates.push(d);}
  const avg=async ds=>{let s=0;for(const d of ds)s+=await cnt(d);return {sum:s,avg:(s/ds.length)};};
  const pre=await avg(preDates), pop=await avg(popupDates), post=postDates.length?await avg(postDates):{sum:0,avg:0};
  const lines=[];
  lines.push("📊 <b>폴바이스 전환 회복 점검</b> (웰컴팝업 OFF 후)");
  lines.push("");
  lines.push(`• 팝업 전 (6/25~30): 평균 <b>${pre.avg.toFixed(1)}</b>건/일`);
  lines.push(`• 팝업 중 (7/1~7): 평균 <b>${pop.avg.toFixed(1)}</b>건/일 ⬇️`);
  lines.push(`• 팝업 OFF 후 (${postDates[postDates.length-1]||"?"}~어제): 평균 <b>${post.avg.toFixed(1)}</b>건/일`);
  lines.push("");
  let verdict;
  if(post.avg>=pre.avg*0.85) verdict="✅ <b>회복</b> — 팝업 전 수준 근접. 팝업이 원인 맞았음.";
  else if(post.avg>pop.avg*1.3) verdict="🟡 <b>부분 회복</b> — 팝업중보다 개선. 며칠 더 지켜보기.";
  else verdict="🔴 <b>회복 미미</b> — 팝업 외 다른 원인 가능(가격/광고품질/체크아웃). 추가 진단 필요.";
  lines.push(verdict);
  lines.push("");
  lines.push("일별: "+postDates.map(async d=>d).join(", "));
  await tg(lines.join("\n"));
  // 자기 launchd 정리 (일회성)
  try{ execSync("launchctl bootout gui/$(id -u)/com.paulvice.conversion-check 2>/dev/null; rm -f ~/Library/LaunchAgents/com.paulvice.conversion-check.plist",{shell:"/bin/zsh"}); }catch{}
  console.log("점검 완료·텔레그램 발송·launchd 정리");
})().catch(e=>{console.error("ERR",e.message.slice(0,200));process.exit(1);});
