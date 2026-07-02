/** 채널 미매칭 항목 → 카페24 SKU 후보 제안서.
 *  채널 판매항목을 현행 매칭(이름+옵션+사전+별칭)으로 돌려 미매칭만 추출,
 *  각 항목에 카페24 재고상품 퍼지 이름매칭 후보(top)를 붙여 검토표/JSON 생성.
 *  읽기 전용. 출력: downloads/inventory-map-proposal.json + 콘솔표.
 *    node inventoryMapProposal.js
 */
const fs=require("fs"),path=require("path");const DASH=path.resolve(__dirname,"..");
function le(p){try{for(const l of fs.readFileSync(p,"utf8").split("\n")){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);if(!m)continue;let v=m[2].trim().replace(/^["']|["']$/g,"");if(!(m[1] in process.env))process.env[m[1]]=v;}}catch{}}
le(path.join(DASH,".env.supabase"));le(path.join(DASH,".env.local"));le(path.join(__dirname,".env"));
const sb=require(path.join(DASH,"node_modules/@supabase/supabase-js")).createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
const MALL=process.env.CAFE24_MALL_ID,API="https://"+MALL+".cafe24api.com",VER="2026-03-01";

function norm(s){return String(s||"").normalize("NFC").toLowerCase().replace(/^\s*(폴바이스|paulvice|벨피|바이린\s*x\s*폴바이스)\s*/i,"").replace(/[\s\-_()\[\]/.,·]+/g,"");}
// 퍼지용 토큰화 (2글자 이상 한글/영문/숫자 토막 + 바이그램)
function toks(s){const base=String(s||"").normalize("NFC").toLowerCase().replace(/[^가-힣a-z0-9]+/g," ").trim();const words=base.split(/\s+/).filter(w=>w.length>=2);const grams=[];const j=base.replace(/\s+/g,"");for(let i=0;i<j.length-1;i++)grams.push(j.slice(i,i+2));return new Set([...words,...grams]);}
function jac(a,b){let inter=0;for(const x of a)if(b.has(x))inter++;return inter/(a.size+b.size-inter||1);}

const CHANNELS=["wconcept","musinsa","29cm","sixshop","sixshop_global","kakao_gift","groupbuy","lotte_dutyfree","shinsegae_dutyfree"];

// 현행 매칭 로직(서버 matchChannelItemToSku 복제) — alias + optmap 포함
function matchItemToSku(it,nameMap,cmap,alias,omap){
  const name=it.name||"",opt=(it.option||"").trim();
  const fin=t=>t?(alias[t]||t):null;
  if(it.sku&&omap&&omap[it.sku]){const om=omap[it.sku];return fin(om[opt]??om[norm(opt)]??null);}
  if(opt){const sw=name.replace(/[^\s,]+(?:&|＆|\/|,)[^\s,]+/g,opt);for(const c of [sw,`${name} ${opt}`]){const t=nameMap[norm(c)];if(t)return fin(t);}}
  if(name){const t=nameMap[norm(name)];if(t)return fin(t);}
  if(it.sku&&it.sku!=="-"&&cmap[it.sku])return fin(cmap[it.sku]);
  return null;
}

(async()=>{
  const kv=async k=>(await sb.from("kv_store").select("data").eq("key",k).maybeSingle()).data;
  const inv=(await kv("paulvice_inventory_v1")).data;const invSkus=new Set(Object.keys(inv));
  const alias=((await kv("inventory_sku_alias"))||{}).data||{};
  const tok=(await kv("cafe24_refresh_token")).data.access_token;
  // 카페24 전상품 (이름매칭 nameMap=전상품, 후보=재고추적분만)
  const all=[];
  for(let off=0,p=0;p<40;p++,off+=100){const r=await fetch(`${API}/api/v2/admin/products?fields=product_code,product_name,eng_product_name&limit=100&offset=${off}`,{headers:{Authorization:"Bearer "+tok,"X-Cafe24-Api-Version":VER}});const arr=(await r.json()).products||[];all.push(...arr);if(arr.length<100)break;}
  const nameMap={};for(const x of all)for(const nm of [x.product_name,x.eng_product_name]){const n=norm(nm||"");if(n&&!(n in nameMap))nameMap[n]=x.product_code;}
  const cands=all.filter(x=>invSkus.has(x.product_code)).map(x=>({code:x.product_code,name:x.product_name,t:toks(x.product_name+" "+(x.eng_product_name||""))}));
  const codeName=Object.fromEntries(all.map(x=>[x.product_code,x.product_name]));

  // 채널 사전 + 옵션맵 로드
  const smap={},omapAll={};for(const ch of CHANNELS){const d=await kv("channel_pricing:skumap:"+ch);smap[ch]=(d&&(d.data||d))||{};const o=await kv("channel_pricing:optmap:"+ch);omapAll[ch]=(o&&(o.data||o))||{};}

  const proposal={};let totalUnmatchedUnits=0;
  for(const ch of CHANNELS){
    const d=await kv("channel_upload:"+ch);if(!d)continue;const r=d.data||d;
    const ups=Array.isArray(r.uploads)?r.uploads:(r.data?[{data:r.data}]:[]);
    const agg=new Map(); // key sku|name|option → {sku,name,option,sold}
    for(const u of ups){const items=(u.data&&u.data.salesByOption&&u.data.salesByOption.length)?u.data.salesByOption:((u.data&&u.data.topProducts)||[]);
      for(const it of items){if(!it.sold)continue;const k=(it.sku||"")+"|"+(it.name||"")+"|"+(it.option||"");const e=agg.get(k)||{sku:it.sku||"",name:it.name||"",option:it.option||"",sold:0};e.sold+=it.sold;agg.set(k,e);}}
    const rows=[];
    for(const it of agg.values()){
      const cur=matchItemToSku(it,nameMap,smap[ch]||{},alias,omapAll[ch]||{});
      if(cur){rows.push({...it,status:"matched",to:cur,toName:codeName[cur]});continue;}
      // 미매칭 → 후보 제안
      totalUnmatchedUnits+=it.sold;
      const q=toks(it.name);let best=null,bs=0;
      if(q.size){for(const c of cands){const s=jac(q,c.t);if(s>bs){bs=s;best=c;}}}
      rows.push({...it,status:"UNMATCHED",suggest:best?best.code:null,suggestName:best?best.name:null,score:Number(bs.toFixed(2)),
        proposedDictKey:it.sku&&it.sku!=="-"?it.sku:null});
    }
    rows.sort((a,b)=>(a.status===b.status?b.sold-a.sold:a.status==="UNMATCHED"?-1:1));
    proposal[ch]=rows;
  }
  fs.writeFileSync(path.join(DASH,"downloads","inventory-map-proposal.json"),JSON.stringify(proposal,null,2));

  // 콘솔 요약표
  for(const ch of CHANNELS){const rows=proposal[ch];if(!rows||!rows.length)continue;
    const un=rows.filter(r=>r.status==="UNMATCHED");const unUnits=un.reduce((s,r)=>s+r.sold,0);
    console.log(`\n[${ch}] 미매칭 ${un.length}종 / ${unUnits}개`);
    for(const r of un){
      const sug=r.suggest?`→제안 ${r.suggest}(${r.suggestName}) score ${r.score}`:"→후보없음(이름빈약/코드만)";
      const dk=r.proposedDictKey?` [사전키 ${r.proposedDictKey}]`:" [사전키없음:이름only]";
      console.log(`   ❌ "${r.name}"${r.option?` opt=${r.option}`:""} ×${r.sold}${dk}  ${sug}`);
    }
  }
  console.log(`\n총 미매칭 수량: ${totalUnmatchedUnits}개`);
  console.log("제안서 저장: downloads/inventory-map-proposal.json");
})().catch(e=>{console.error(e);process.exit(1);});
