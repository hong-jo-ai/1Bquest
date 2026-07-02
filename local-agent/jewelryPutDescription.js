/** paulvice 주얼리 상세페이지 → 카페24 상품 description 반영(PUT).
 *  각 폴더 detail.html 을 해당 상품번호의 description + mobile_description 에 PUT.
 *  - PUT 전 현재 description/mobile_description 을 _backup_descriptions.json 에 백업(되돌리기용).
 *  - 이미 백업된 상품은 백업 덮어쓰지 않음(최초 원본 보존).
 *  사용: node jewelryPutDescription.js [--only 139,148] [--limit N] [--dry] [--pc-only]
 */
const fs = require("fs"), path = require("path");
const DASH = path.resolve(__dirname, "..");
function loadEnv(p){try{for(const l of fs.readFileSync(p,"utf8").split("\n")){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);if(!m)continue;let v=m[2].trim().replace(/^["']|["']$/g,"");if(!(m[1] in process.env))process.env[m[1]]=v;}}catch{}}
require("dotenv").config({override:true});
loadEnv(path.join(DASH,".env.supabase"));loadEnv(path.join(DASH,".env.local"));loadEnv(path.join(__dirname,".env"));
const{createClient}=require(path.join(DASH,"node_modules/@supabase/supabase-js"));
const MALL=process.env.CAFE24_MALL_ID,BASE=`https://${MALL}.cafe24api.com`;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function token(sb){const{data}=await sb.from("kv_store").select("data").eq("key","cafe24_refresh_token").maybeSingle();let t=data.data,now=Date.now();if(t.access_token&&t.expires_at&&t.expires_at-90000>now)return t.access_token;const r=await fetch(`${BASE}/api/v2/oauth/token`,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded",Authorization:"Basic "+Buffer.from(`${process.env.CAFE24_CLIENT_ID}:${process.env.CAFE24_CLIENT_SECRET}`).toString("base64")},body:`grant_type=refresh_token&refresh_token=${encodeURIComponent(t.refresh_token)}`});const j=await r.json();await sb.from("kv_store").upsert({key:"cafe24_refresh_token",data:{access_token:j.access_token,refresh_token:j.refresh_token,expires_at:now+110*60*1000},updated_at:new Date().toISOString()},{onConflict:"key"});return j.access_token;}

const args=process.argv.slice(2);
const getArg=(k,d)=>{const i=args.indexOf(k);return i>=0?args[i+1]:d;};
const ONLY=(getArg("--only","")||"").split(",").map(s=>s.trim()).filter(Boolean);
const LIMIT=parseInt(getArg("--limit","0"),10)||0;
const DRY=args.includes("--dry");
const PC_ONLY=args.includes("--pc-only");

const DIR=path.join(DASH,"downloads","jewelry-detail");
const BACKUP=path.join(DIR,"_backup_descriptions.json");

(async()=>{
  const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
  const tk=await token(sb);const H={Authorization:`Bearer ${tk}`,"Content-Type":"application/json"};

  let backups={};try{backups=JSON.parse(fs.readFileSync(BACKUP,"utf8"));}catch{}

  let folders=fs.readdirSync(DIR).filter(d=>!d.startsWith("_")&&fs.statSync(path.join(DIR,d)).isDirectory()).sort((a,b)=>parseInt(a)-parseInt(b));
  let items=[];
  for(const d of folders){
    const no=(d.match(/^(\d+)/)||[])[1];if(!no)continue;
    if(ONLY.length&&!ONLY.includes(no))continue;
    const hp=path.join(DIR,d,"detail.html");if(!fs.existsSync(hp)){console.warn(`- ${d}: detail.html 없음 → 스킵`);continue;}
    items.push({no,name:d,html:fs.readFileSync(hp,"utf8")});
  }
  if(LIMIT)items=items.slice(0,LIMIT);
  console.log(`▶ 대상 ${items.length}종 ${DRY?"(DRY-RUN, PUT 안 함)":""}${PC_ONLY?" [PC description만]":" [PC+모바일]"}`);

  let ok=0,fail=0;const fails=[];
  for(const it of items){
    try{
      // 현재값 백업(최초 1회만)
      if(!backups[it.no]){
        const cur=(await(await fetch(`${BASE}/api/v2/admin/products/${it.no}`,{headers:H})).json()).product||{};
        backups[it.no]={name:it.name,description:cur.description||"",mobile_description:cur.mobile_description||"",saved_at:new Date().toISOString()};
        fs.writeFileSync(BACKUP,JSON.stringify(backups,null,2));
      }
      if(DRY){console.log(`  (dry) ${it.no} ${it.name} — html ${it.html.length}자`);ok++;continue;}
      const request={description:it.html};
      if(!PC_ONLY)request.mobile_description=it.html;
      const r=await fetch(`${BASE}/api/v2/admin/products/${it.no}`,{method:"PUT",headers:H,body:JSON.stringify({shop_no:1,request})});
      if(!r.ok){const t=await r.text();throw new Error(`HTTP ${r.status}: ${t.slice(0,200)}`);}
      ok++;console.log(`✓ ${it.no} ${it.name}`);
      await sleep(250);
    }catch(e){fail++;fails.push(it.no);console.error(`✗ ${it.no} ${it.name}: ${String(e.message||e).slice(0,180)}`);}
  }
  console.log(`\n완료: 성공 ${ok} / 실패 ${fail} / 총 ${items.length}`);
  if(fails.length)console.log("실패: "+fails.join(", "));
  console.log(`백업: ${path.relative(DASH,BACKUP)} (되돌리려면 이 파일의 값으로 다시 PUT)`);
})().catch(e=>{console.error("치명적:",e);process.exit(1);});
