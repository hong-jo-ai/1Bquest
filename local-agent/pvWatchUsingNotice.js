/** 폴바이스 전 손목시계 상세에 '작동방지 탭' USING 안내를 뒤에 덧붙임(PC+모바일).
 *  - 기존 상세는 그대로 두고 말미에 안내 블록만 append(교체 아님).
 *  - 변경 전 원본 description/mobile_description 백업(되돌리기용, 최초 1회).
 *  - 마커(<!--pv-using-tab-->) 있으면 스킵(중복삽입 방지, 멱등).
 *  - 벽시계·해리엇 제외(용두 없음 / 타 브랜드). 프로덕션 SSOT 토큰 사용.
 *  사용: node pvWatchUsingNotice.js [--dry] [--only 195,196] [--pc-only]
 */
const fs=require("fs"), path=require("path");
const DASH=path.resolve(__dirname,"..");
function le(p){try{for(const l of fs.readFileSync(p,"utf8").split("\n")){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);if(!m)continue;let v=m[2].trim().replace(/^["']|["']$/g,"");if(!(m[1] in process.env))process.env[m[1]]=v;}}catch{}}
require("dotenv").config({override:true});
le(path.join(DASH,".env.supabase"));le(path.join(DASH,".env.local"));le(path.join(__dirname,".env"));
const {createClient}=require(path.join(DASH,"node_modules/@supabase/supabase-js"));
const MALL=process.env.CAFE24_MALL_ID,BASE=`https://${MALL}.cafe24api.com`;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const args=process.argv.slice(2);
const DRY=args.includes("--dry"), PC_ONLY=args.includes("--pc-only");
const oi=args.indexOf("--only");
const ONLY=(oi>=0?(args[oi+1]||""):"").split(",").map(s=>s.trim()).filter(Boolean);

const MARK="<!--pv-using-tab-->";
const NOTICE = MARK + `
<div style="max-width:860px;margin:0 auto;font-family:'Pretendard','Apple SD Gothic Neo','Malgun Gothic',sans-serif;">
  <div style="background:#f9f8f6;text-align:center;padding:56px 20px;margin:44px 0 0;">
    <p style="font-weight:600;font-size:11.5px;letter-spacing:.32em;color:#999;margin:0 0 12px;">USING</p>
    <h3 style="font-size:24px;color:#000;font-weight:600;letter-spacing:-.01em;margin:0 0 16px;word-break:keep-all;">받으신 뒤, 작동방지 탭 안내</h3>
    <p style="font-size:14.5px;line-height:1.9;margin:0;word-break:keep-all;color:#575757;">쿼츠 시계는 배터리 보호를 위해 용두(옆면 조작 버튼)에 투명 <b style="color:#000;">작동방지 탭</b>을 끼워 출고합니다. 주문량에 따라 배송 전 저희가 미리 제거해 보내드리기도 합니다.<br><br>· <b style="color:#000;">시계가 멈춰 있다면</b> — 용두를 살짝 당겨 탭을 제거하고, 시간을 맞춘 뒤 용두를 다시 밀어 넣어 주세요.<br>· <b style="color:#000;">탭이 없다면</b> — 검수 과정에서 제거 후 발송된 정상 제품이니 안심하고 사용하세요.</p>
  </div>
</div>`;

async function token(sb){const{data}=await sb.from("kv_store").select("data").eq("key","cafe24_refresh_token").maybeSingle();let t=data.data,now=Date.now();if(t.access_token&&t.expires_at&&t.expires_at-90000>now)return t.access_token;const r=await fetch(`${BASE}/api/v2/oauth/token`,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded",Authorization:"Basic "+Buffer.from(`${process.env.CAFE24_CLIENT_ID}:${process.env.CAFE24_CLIENT_SECRET}`).toString("base64")},body:`grant_type=refresh_token&refresh_token=${encodeURIComponent(t.refresh_token)}`});const j=await r.json();if(!j.access_token)throw new Error("토큰 refresh 실패: "+JSON.stringify(j).slice(0,120));await sb.from("kv_store").upsert({key:"cafe24_refresh_token",data:{access_token:j.access_token,refresh_token:j.refresh_token,expires_at:now+110*60*1000},updated_at:new Date().toISOString()},{onConflict:"key"});return j.access_token;}

// 손목시계만: '워치/시계' 포함 & 벽시계·해리엇·부속품 제외
const IS_WATCH = n => /워치|시계/.test(n) && !/벽시계|스트랩|밴드|팔찌|브레이슬릿|스탠드|와인더|배터리|박스|파우치|각인 서비스|해리엇/.test(n);

const DIR=path.join(DASH,"downloads","watch-using-notice");
const BACKUP=path.join(DIR,"_backup_descriptions.json");
fs.mkdirSync(DIR,{recursive:true});

(async()=>{
  const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
  const tk=await token(sb);const H={Authorization:`Bearer ${tk}`,"Content-Type":"application/json"};
  let watches=[], offset=0;
  for(;;){
    const r=await fetch(`${BASE}/api/v2/admin/products?shop_no=1&limit=100&offset=${offset}&fields=product_no,product_name`,{headers:H});
    const j=await r.json(); const list=j.products||[];
    for(const p of list){ if(IS_WATCH(p.product_name)) watches.push({no:String(p.product_no),name:p.product_name}); }
    if(list.length<100)break; offset+=100; await sleep(300);
  }
  if(ONLY.length) watches=watches.filter(w=>ONLY.includes(w.no));
  console.log(`▶ 폴바이스 손목시계 대상 ${watches.length}종 ${DRY?"(DRY — PUT 안 함)":""}`);

  let backups={};try{backups=JSON.parse(fs.readFileSync(BACKUP,"utf8"));}catch{}
  let ok=0,skip=0,fail=0;const fails=[];
  for(const w of watches){
    try{
      const cur=(await(await fetch(`${BASE}/api/v2/admin/products/${w.no}?shop_no=1&fields=description,mobile_description`,{headers:H})).json()).product||{};
      const desc=cur.description||"", mdesc=cur.mobile_description||"";
      if(desc.includes(MARK)||mdesc.includes(MARK)){ skip++; console.log(`  ↷ ${w.no} ${w.name} — 이미 안내 있음(스킵)`); continue; }
      if(!backups[w.no]){ backups[w.no]={name:w.name,description:desc,mobile_description:mdesc,saved_at:new Date().toISOString()}; fs.writeFileSync(BACKUP,JSON.stringify(backups,null,2)); }
      if(DRY){ console.log(`  (dry) ${w.no} ${w.name} — 현재 PC ${desc.length}자 / 모바일 ${mdesc.length}자 → 뒤에 안내 append`); ok++; continue; }
      const request={description:desc+NOTICE};
      if(!PC_ONLY) request.mobile_description=mdesc+NOTICE;
      const r=await fetch(`${BASE}/api/v2/admin/products/${w.no}`,{method:"PUT",headers:H,body:JSON.stringify({shop_no:1,request})});
      if(!r.ok){const t=await r.text();throw new Error(`HTTP ${r.status}: ${t.slice(0,180)}`);}
      ok++; console.log(`✓ ${w.no} ${w.name}`);
      await sleep(300);
    }catch(e){ fail++; fails.push(w.no); console.error(`✗ ${w.no} ${w.name}: ${String(e.message||e).slice(0,180)}`); }
  }
  console.log(`\n완료: 반영 ${ok} / 스킵 ${skip} / 실패 ${fail} / 총 ${watches.length}`);
  if(fails.length)console.log("실패: "+fails.join(", "));
  console.log(`백업: ${path.relative(DASH,BACKUP)} (되돌리려면 이 파일 값으로 재PUT)`);
})().catch(e=>{console.error("치명적:",e.message);process.exit(1);});
