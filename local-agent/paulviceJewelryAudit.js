/** paulvice.co.kr(카페24) 주얼리(cat44) 상세페이지 감사 — 읽기 전용.
 *  각 상품의 description/mobile_description HTML에서 이미지 수·텍스트 길이를 집계해
 *  상세페이지가 미흡한 상품을 가려낸다. 결과: JSON + 콘솔 요약. */
const fs=require("fs"),path=require("path");
const DASH=path.resolve(__dirname,"..");
function loadEnv(p){try{for(const l of fs.readFileSync(p,"utf8").split("\n")){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);if(!m)continue;let v=m[2].trim().replace(/^["']|["']$/g,"");if(!(m[1] in process.env))process.env[m[1]]=v;}}catch{}}
require("dotenv").config({override:true});
loadEnv(path.join(DASH,".env.supabase"));loadEnv(path.join(DASH,".env.local"));
const{createClient}=require(path.join(DASH,"node_modules/@supabase/supabase-js"));
const MALL=process.env.CAFE24_MALL_ID,BASE=`https://${MALL}.cafe24api.com`;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function token(sb){const{data}=await sb.from("kv_store").select("data").eq("key","cafe24_refresh_token").maybeSingle();let t=data.data,now=Date.now();if(t.access_token&&t.expires_at&&t.expires_at-90000>now)return t.access_token;const r=await fetch(`${BASE}/api/v2/oauth/token`,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded",Authorization:"Basic "+Buffer.from(`${process.env.CAFE24_CLIENT_ID}:${process.env.CAFE24_CLIENT_SECRET}`).toString("base64")},body:`grant_type=refresh_token&refresh_token=${encodeURIComponent(t.refresh_token)}`});const j=await r.json();if(!j.access_token)throw new Error("token refresh 실패: "+JSON.stringify(j));await sb.from("kv_store").upsert({key:"cafe24_refresh_token",data:{access_token:j.access_token,refresh_token:j.refresh_token,expires_at:now+110*60*1000},updated_at:new Date().toISOString()},{onConflict:"key"});return j.access_token;}
const imgs=html=>{const out=[];if(!html)return out;const re=/<img[^>]+src=["']?([^"' >]+)/gi;let m;while((m=re.exec(html)))out.push(m[1]);return out;};
const textLen=html=>html?html.replace(/<[^>]+>/g," ").replace(/&nbsp;/g," ").replace(/\s+/g," ").trim().length:0;
(async()=>{
  const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
  const tk=await token(sb);
  const H={Authorization:`Bearer ${tk}`};
  // 1) 주얼리(cat44) 상품번호 수집
  let nos=[],off=0;
  while(true){
    const r=await fetch(`${BASE}/api/v2/admin/products?category=44&limit=100&offset=${off}`,{headers:H});
    const j=await r.json();const ps=j.products||[];
    nos.push(...ps.map(p=>({no:p.product_no,code:p.product_code,name:p.product_name,price:p.price,display:p.display,selling:p.selling})));
    if(ps.length<100)break;off+=100;
  }
  console.log(`주얼리(cat44) 상품 ${nos.length}개\n`);
  // 2) 각 상세 fetch
  const rows=[];
  for(const p of nos){
    const r=await fetch(`${BASE}/api/v2/admin/products/${p.no}`,{headers:H});
    const j=await r.json();const d=j.product||{};
    const di=imgs(d.description),mi=imgs(d.mobile_description);
    rows.push({...p,desc_imgs:di.length,desc_len:textLen(d.description),mob_imgs:mi.length,mob_len:textLen(d.mobile_description),list_image:d.list_image,desc_img_urls:di,mob_img_urls:mi});
    await sleep(120);
  }
  // 3) 미흡 판정: PC 상세 이미지 ≤2 또는 설명길이 <80
  rows.forEach(r=>r.weak = r.desc_imgs<=2 || r.desc_len<80);
  rows.sort((a,b)=>a.desc_imgs-b.desc_imgs||a.desc_len-b.desc_len);
  const outDir=path.join(DASH,"downloads","jewelry-audit");fs.mkdirSync(outDir,{recursive:true});
  fs.writeFileSync(path.join(outDir,"audit.json"),JSON.stringify(rows,null,2));
  console.log("상품번호\tPC이미지\t설명길이\t모바일이미지\t판매\t노출\t미흡\t상품명");
  rows.forEach(r=>console.log(`${r.no}\t${r.desc_imgs}\t${r.desc_len}\t${r.mob_imgs}\t${r.selling}\t${r.display}\t${r.weak?"⚠️":""}\t${r.name}`));
  console.log(`\n미흡 후보: ${rows.filter(r=>r.weak).length}/${rows.length}개`);
  console.log(`결과 저장: ${path.join(outDir,"audit.json")}`);
})().catch(e=>{console.error("ERR",e.message);process.exit(1);});
