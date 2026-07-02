/**
 * 재고 차감 매칭 드라이런 — 채널 판매상품을 재고 SKU(카페24 product_code)에 매칭.
 *   ① channel_pricing:skumap:<채널>(채널코드→SKU) 우선
 *   ② 상품명(색상 포함) 정규화 매칭 폴백 (카페24 상품명 사전)
 * 실제 차감 없음. 채널별 매칭/미매칭 + 커버리지 출력.
 *   node inventoryMatchDryRun.js
 */
const fs = require("fs"), path = require("path");
const DASH = path.resolve(__dirname, "..");
function le(p){try{for(const l of fs.readFileSync(p,"utf8").split("\n")){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);if(!m)continue;let v=m[2].trim().replace(/^["']|["']$/g,"");if(!(m[1] in process.env))process.env[m[1]]=v;}}catch{}}
le(path.join(DASH,".env.supabase")); le(path.join(DASH,".env.local")); le(path.join(__dirname,".env"));
const sb = require(path.join(DASH,"node_modules/@supabase/supabase-js")).createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const MALL = process.env.CAFE24_MALL_ID, API = "https://"+MALL+".cafe24api.com", VER = "2026-03-01";

// 상품명 정규화: 브랜드접두어·공백·특수문자 제거, 색상/옵션은 유지(색상별 SKU 구분 위해)
function norm(s) {
  return String(s||"").normalize("NFC").toLowerCase()
    .replace(/^\s*(폴바이스|paulvice|벨피|바이린\s*x\s*폴바이스)\s*/i, "")
    .replace(/[\s\-_()\[\]/.,·]+/g, "")
    .replace(/워치|watch/g, "워치");
}
const CHANNELS = ["wconcept","musinsa","29cm","sixshop","sixshop_global"];
async function kv(k){ return (await sb.from("kv_store").select("data").eq("key",k).maybeSingle()).data; }
function tps(d){ if(!d) return []; if(d.topProducts) return d.topProducts; if(d.data&&d.data.topProducts) return d.data.topProducts; if(d.uploads) return d.uploads.flatMap(u=>(u.data&&u.data.topProducts)||[]); return []; }

(async () => {
  // 재고 SKU + 카페24 상품명 사전
  const inv = (await kv("paulvice_inventory_v1")).data;
  const invSkus = new Set(Object.keys(inv));
  const tok = (await kv("cafe24_refresh_token")).data.access_token;
  const nameToSku = new Map();  // 정규화상품명 → product_code (재고 있는 것만)
  const codeToName = new Map();
  for (let off=0,p=0; p<40; p++, off+=100) {
    const r = await fetch(`${API}/api/v2/admin/products?fields=product_code,product_name,eng_product_name&limit=100&offset=${off}`, { headers:{Authorization:"Bearer "+tok,"X-Cafe24-Api-Version":VER} });
    const arr = (await r.json()).products || [];
    for (const x of arr) { codeToName.set(x.product_code, x.product_name); if (invSkus.has(x.product_code)) { for(const nm of [x.product_name, x.eng_product_name]){ const n=norm(nm||""); if(n&&!nameToSku.has(n)) nameToSku.set(n, x.product_code); } } }
    if (arr.length < 100) break;
  }
  console.log(`재고 SKU ${invSkus.size}개 / 이름매칭 사전 ${nameToSku.size}개\n`);

  for (const ch of CHANNELS) {
    const up = await kv("channel_upload:"+ch);
    const raw = tps(up && up.data);
    if (!raw.length) { console.log(`[${ch}] 판매데이터 없음\n`); continue; }
    const smap = ((await kv("channel_pricing:skumap:"+ch))||{data:{}}).data || {};
    // 상품(sku 또는 name)별 sold 합산
    const agg = {};
    for (const p of raw) { const key = (p.sku&&p.sku!=="-") ? "sku:"+p.sku : "nm:"+norm(p.name); (agg[key]=agg[key]||{name:p.name,sku:p.sku,sold:0}).sold += (p.sold||0); }
    let mSku=0,mName=0,unm=0,soldM=0,soldU=0; const unmatched=[], matched=[];
    for (const it of Object.values(agg)) {
      let target=null, how="";
      if (it.sku && it.sku!=="-" && smap[it.sku] && invSkus.has(smap[it.sku])) { target=smap[it.sku]; how="사전"; mSku++; }
      else { const t=nameToSku.get(norm(it.name)); if (t) { target=t; how="이름"; mName++; } }
      if (target) { matched.push({...it,target,how}); soldM+=it.sold; }
      else { unmatched.push(it); soldU+=it.sold; unm++; }
    }
    console.log(`[${ch}] 상품 ${Object.keys(agg).length}종 | ✅매칭 ${mSku+mName}(사전 ${mSku}/이름 ${mName}) ❌미매칭 ${unm} | 판매수량 매칭 ${soldM}/미매칭 ${soldU}`);
    matched.slice(0,4).forEach(m=>console.log(`   ✅ ${m.name.slice(0,26)} ×${m.sold} → ${m.target}(${codeToName.get(m.target)||""}) [${m.how}]`));
    unmatched.slice(0,8).forEach(m=>console.log(`   ❌ ${m.name.slice(0,30)} ×${m.sold} (sku ${m.sku||"-"})`));
    console.log("");
  }
})().catch(e=>console.error("ERR:",e.message));
