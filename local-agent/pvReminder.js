/** 일회성 텔레그램 리마인더. 인자: <label>. 메시지=pv_reminders.json[label]. 발송 후 자기 launchd 정리. */
const fs=require("fs");const {execSync}=require("child_process");const DASH="/Users/mac/sungjo_ai/paulwise-dashboard";
function le(p){try{for(const l of fs.readFileSync(p,"utf8").split("\n")){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);if(!m)continue;let v=m[2].trim().replace(/^["']|["']$/g,"");if(!(m[1] in process.env))process.env[m[1]]=v;}}catch{}}
le(DASH+"/local-agent/.env");le(DASH+"/.env.local");
const label=process.argv[2];
const msgs=JSON.parse(fs.readFileSync(DASH+"/local-agent/pv_reminders.json","utf8"));
const msg=msgs[label]||("리마인더: "+label);
(async()=>{
  const t=process.env.TELEGRAM_BOT_TOKEN,c=process.env.TELEGRAM_CHAT_ID;
  await fetch(`https://api.telegram.org/bot${t}/sendMessage`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chat_id:c,text:msg,parse_mode:"HTML"})});
  try{ execSync(`launchctl bootout gui/$(id -u)/com.paulvice.reminder-${label} 2>/dev/null; rm -f ~/Library/LaunchAgents/com.paulvice.reminder-${label}.plist`,{shell:"/bin/zsh"}); }catch{}
  console.log("발송·정리:",label);
})().catch(e=>{console.error("ERR",e.message.slice(0,120));process.exit(1);});
