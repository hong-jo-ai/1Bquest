/**
 * 월 손익 추정 — 대시보드 손익 화면(components/ProfitDashboard.tsx)과 같은 식을 DB에서 직접 계산.
 * 사용: node local-agent/monthlyPnl.js 2026-09-01 2026-09-27   (부분일인 오늘은 빼고 볼 것)
 * ⚠️ 이 숫자는 대시보드식 그대로라 아래가 빠져 있다 — 답할 땐 보정해서 말할 것(2026-09-28 실측):
 *   ①업로드 채널(29CM·조선몰·스마트스토어 등) 원가 0 ②cafe24_harriot 수수료 키 없음(0%) ③기원 파트너 몫
 *   ④페덱스 해외운임(카드 '기타'로 분류) ⑤영문몰은 영세율인데 부가세 10/110 일괄 차감
 * 카페24 토큰은 kv 캐시만 사용(로컬 refresh 금지).
 */
const path=require("path"),fs=require("fs");
const DASH=path.resolve(__dirname,"..");
function le(p){try{for(const l of fs.readFileSync(p,"utf8").split("\n")){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);if(!m)continue;let v=m[2].trim().replace(/^["']|["']$/g,"");if(!(m[1] in process.env))process.env[m[1]]=v;}}catch{}}
le(path.join(DASH,".env.supabase"));le(path.join(DASH,".env.local"));le(path.join(DASH,"local-agent/.env"));
const {createClient}=require(path.join(DASH,"node_modules/@supabase/supabase-js"));
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
const S=process.argv[2]||"2026-09-01", E=process.argv[3]||"2026-09-27";
const won=n=>Math.round(n).toLocaleString();
const kv=async k=>{const {data}=await db.from("kv_store").select("data").eq("key",k).maybeSingle();return data&&data.data;};
const inR=d=>d>=S&&d<=E;
const kst=s=>new Date(new Date(s).getTime()+9*3600e3).toISOString().slice(0,10);
async function all(q){let out=[],o=0;while(true){const {data,error}=await q().range(o,o+999);if(error)throw error;out=out.concat(data);if(data.length<1000)break;o+=1000;}return out;}
(async()=>{
  // 1) 매출 (대시보드 스냅샷)
  const rev={};
  for(const b of ["paulvice","harriot"]){const h=await kv("revenue_history:"+b);for(const [d,v] of Object.entries(h.days)){if(!inR(d))continue;for(const [c,a] of Object.entries(v.byChannel||{})){const k=b+"/"+c;rev[k]=(rev[k]||0)+a;}}}
  const fees=await kv("cost_settings:channel_fees"), ship=(await kv("cost_settings:shipping")).perOrder, fixed=await kv("cost_settings:fixed_costs");
  let totalRev=0,totalFee=0; console.log(`\n== 매출 ${S}~${E} (대시보드 매출 스냅샷)`);
  for(const [k,a] of Object.entries(rev).sort((x,y)=>y[1]-x[1])){const c=k.split("/")[1];const r=fees[c]??0;totalRev+=a;totalFee+=a*r/100;console.log("  ",k.padEnd(34),won(a).padStart(12),` 수수료 ${r}%`);}
  console.log("  합계",won(totalRev));
  // 2) 업로드 채널 주문수·COGS
  const {data:ups}=await db.from("kv_store").select("key,data").like("key","channel_upload:%");
  let upOrders=0,upCogs=0; const upDetail={};
  for(const u of ups){const dm=new Map(),cm=new Map();for(const up of (u.data.uploads||[])){for(const d of (up.data.dailyRevenue||[]))dm.set(d.date,d);for(const c of (up.data.dailyCogs||[]))cm.set(c.date,c);}
    let o=0,c=0,r=0;for(const [d,v] of dm)if(inR(d)){o+=(v.shipments??v.orders??0);r+=v.revenue||0;}for(const [d,v] of cm)if(inR(d))c+=v.cost||0;upOrders+=o;upCogs+=c;upDetail[u.key.replace("channel_upload:","")]={orders:o,cogs:c,rev:r};}
  // 3) 카페24 주문수·COGS (두 몰, 양 샵)
  let cafeOrders=0,cafeCogs=0,unmatched=new Set(); const cafeDetail={};
  for(const [brand,tk,mallEnv,ck] of [["paulvice","cafe24_refresh_token","CAFE24_MALL_ID","cost_settings:product_cogs"],["harriot","cafe24_refresh_token:harriot","HARRIOT_CAFE24_MALL_ID","cost_settings:product_cogs:harriot"]]){
    const t=await kv(tk); const mall=process.env[mallEnv]; const cogs=await kv(ck);
    if(!t||!t.access_token||Number(t.expires_at||0)<=Date.now()||!mall){console.log(`  ⚠️ ${brand} 카페24 토큰/몰ID 없음·만료 → 이 몰 주문수·원가 누락`);continue;}
    for(const shop of [1,2]){let off=0,n=0,c=0,units=0;
      while(true){const qs=new URLSearchParams({start_date:S,end_date:E,limit:"100",offset:String(off),embed:"items",shop_no:String(shop)});
        const r=await fetch(`https://${mall}.cafe24api.com/api/v2/admin/orders?${qs}`,{headers:{Authorization:`Bearer ${t.access_token}`}});if(!r.ok){console.log("  ⚠️",brand,shop,r.status,(await r.text()).slice(0,120));break;}
        const b=(await r.json()).orders||[];
        for(const o of b){let live=false;for(const it of (o.items||[])){if(it.canceled==="T"||/^C4/.test(it.order_status||""))continue;live=true;const q=Number(it.actual_quantity??it.quantity??1);units+=q;const u=cogs[it.product_code];if(u!==undefined)c+=u*q;else if(it.product_code)unmatched.add(brand+":"+it.product_code+" "+(it.product_name||"").slice(0,20));}if(live)n++;}
        if(b.length<100)break;off+=100;}
      cafeOrders+=n;cafeCogs+=c;cafeDetail[`${brand} shop${shop}`]={orders:n,units,cogs:c};}
  }
  // 4) 광고비
  const meta=await all(()=>db.from("mads_daily_metrics").select("date,spend").gte("date",S).lte("date",E));
  const metaSpend=meta.reduce((a,r)=>a+Number(r.spend||0),0);
  const wc=await kv("ad_spend:wconcept"); let wcSpend=0; const wd=(wc&&(wc.daily||wc.days||wc))||{};
  if(Array.isArray(wd))for(const r of wd){if(inR(r.date))wcSpend+=Number(r.spend||0);} else for(const [d,v] of Object.entries(wd)){if(inR(d))wcSpend+=Number(v.spend??v??0);}
  // 5) 재무 카테고리 비용
  const CATS=["임대료","인건비","통신비","소프트웨어","세금","수수료","택배비","식비","교통/연료","접대비","부자재","사무용품","비품/설비","복리후생","여비교통비","보험료","수선비","도서인쇄"];
  const OVER=new Set(["수수료","택배비","매입","매출","카드결제","송금"]);
  const sT=`${S}T00:00:00+09:00`,eT=`${E}T23:59:59+09:00`;
  const bank=await all(()=>db.from("finance_bank_tx").select("category,withdrawal,counterparty").gte("tx_date",sT).lte("tx_date",eT).gt("withdrawal",0));
  const card=await all(()=>db.from("finance_card_usage").select("category,amount,cancel_amount").gte("use_date",sT).lte("use_date",eT));
  const inv=await all(()=>db.from("finance_tax_invoices").select("category,total_amount,partner_name,partner_reg_no").eq("invoice_type","purchase").gte("write_date",S).lte("write_date",E));
  const per={},invBy={}; const add=(o,c,a)=>{if(a<=0)return;c=c||"기타";o[c]=(o[c]||0)+a;};
  for(const r of bank)add(per,r.category,Number(r.withdrawal)||0);
  for(const r of card)add(per,r.category,(Number(r.amount)||0)-(Number(r.cancel_amount)||0));
  let harriotInvAds=0;
  for(const r of inv){const a=Number(r.total_amount)||0;if(r.partner_reg_no==="116-86-02030"){harriotInvAds+=a;continue;}if(r.category==="광고비"&&/더블유컨셉|w.?컨셉|wconcept/i.test(r.partner_name||""))continue;add(invBy,r.category,a);}
  let autoFixed=0; const fx=[];
  for(const c of CATS){const a=(per[c]||0)+(OVER.has(c)?0:(invBy[c]||0));if(a>0){autoFixed+=a;fx.push([c,a]);}}
  const invAds=invBy["광고비"]||0; autoFixed+=invAds+harriotInvAds;
  const days=Math.round((new Date(E)-new Date(S))/864e5)+1;
  const manualFixed=fixed.reduce((a,c)=>a+c.monthly,0)/30*days;
  // 6) 손익
  const vat=totalRev*10/110, revEx=totalRev-vat;
  const orders=upOrders+cafeOrders, shipping=orders*ship, cogs=upCogs+cafeCogs;
  const gross=revEx-totalFee-shipping-cogs-metaSpend-wcSpend;
  const op=gross-manualFixed-autoFixed;
  console.log(`\n== 주문수·원가`); for(const [k,v] of Object.entries(cafeDetail))console.log("  카페24",k,v); for(const [k,v] of Object.entries(upDetail))if(v.orders||v.cogs)console.log("  업로드",k,v);
  if(unmatched.size)console.log("  ⚠️ 원가 미설정 SKU",unmatched.size,"개:",[...unmatched].slice(0,12).join(" | "));
  console.log(`\n== 고정·간접비(재무 자동)`); for(const [c,a] of fx.sort((x,y)=>y[1]-x[1]))console.log("  ",c.padEnd(10),won(a).padStart(12)); console.log("   광고비(세금계산서)",won(invAds),"| 해리엇 지정 광고",won(harriotInvAds),"| 수동 고정비",won(manualFixed));
  console.log("   (참고: 개인",won(per["개인"]||0),"· 매입 카드/통장",won(per["매입"]||0),"· 매입 계산서",won(invBy["매입"]||0),"· 송금",won(per["송금"]||0),"· 기타",won(per["기타"]||0),"— 손익 미차감)");
  console.log(`\n== 손익 ${S}~${E} (${days}일)`);
  for(const [k,v] of [["총매출(VAT 포함)",totalRev],["− 부가세",-vat],["순매출",revEx],["− 채널 수수료",-totalFee],[`− 택배비(${orders}건×${ship})`,-shipping],["− 매입원가(COGS)",-cogs],["− 메타 광고비",-metaSpend],["− W컨셉 광고비",-wcSpend],["매출총이익",gross],["− 고정·간접비",-(manualFixed+autoFixed)],["영업이익",op]])console.log("  ",k.padEnd(24),won(v).padStart(14));
  console.log("   영업이익률",(op/totalRev*100).toFixed(1)+"%");
})().catch(e=>{console.error("ERR",e.message);process.exit(1)});
