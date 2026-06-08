/**
 * 우체국 발송 엑셀 통합 빌더 (출고 Phase 1).
 * 채널별 출고대기 주문 → 11컬럼 우체국 양식(상품별 1행) → 우체국송장양식_YYYYMMDD_1.xlsx
 *   - 카페24: Admin API (배송준비중) — 읽기
 *   - 식스샵 국내: 최신 export (결제완료) — 읽기
 *   - 29CM: 출고관리 상세창(/detail) — 읽기 (cm29Outbound)
 *   - W컨셉/무신사: 추후 추가
 * 카페24/Supabase 자격증명은 대시보드 .env.supabase/.env.local 에서 로드.
 */
require("dotenv").config({ override: true }); // local-agent/.env (CM29_*, PAULWISE_MCP_TOKEN 등)
const fs = require("fs"), path = require("path");
const XLSX = require("xlsx");
const DASH = "/Users/mac/sungjo_ai/paulwise-dashboard";
function loadEnv(p){ try { for(const line of fs.readFileSync(p,"utf8").split("\n")){const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);if(!m)continue;let v=m[2].trim().replace(/^["']|["']$/g,"");if(!(m[1] in process.env))process.env[m[1]]=v;} } catch {} }
loadEnv(path.join(DASH, ".env.supabase")); loadEnv(path.join(DASH, ".env.local"));
const { createClient } = require(path.join(DASH, "node_modules/@supabase/supabase-js"));
const { getCm29OutboundRows } = require("./cm29Outbound");
const { closeMarketplaceBrowsers } = require("./marketplaceSync");

const HEADER = ["수취인명","수취인 이동통신","수취인 전화번호","수취인 주소","수취인 우편번호","상품명","색상","수량","배송메세지","주문번호","판매처"];
const clean = (v) => { const s = String(v??"").trim(); return s==="-" ? "" : s; };
const isMobile = (p) => /^01[016789]/.test(String(p||"").replace(/\D/g,""));
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);

// ── 카페24 (API) ──
const MALL=()=>process.env.CAFE24_MALL_ID, BASE=()=>`https://${MALL()}.cafe24api.com`;
async function cafe24Token(){
  const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
  const {data}=await sb.from("kv_store").select("data").eq("key","cafe24_refresh_token").maybeSingle();
  let t=data?.data; if(typeof t==="string")t={access_token:"",refresh_token:t,expires_at:0};
  const now=Date.now();
  if(t.access_token&&t.expires_at&&t.expires_at-90000>now)return t.access_token;
  const res=await fetch(`${BASE()}/api/v2/oauth/token`,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded",Authorization:"Basic "+Buffer.from(`${process.env.CAFE24_CLIENT_ID}:${process.env.CAFE24_CLIENT_SECRET}`).toString("base64")},body:`grant_type=refresh_token&refresh_token=${encodeURIComponent(t.refresh_token)}`});
  const j=await res.json(); if(!j.access_token)throw new Error("cafe24 refresh 실패");
  await sb.from("kv_store").upsert({key:"cafe24_refresh_token",data:{access_token:j.access_token,refresh_token:j.refresh_token,expires_at:now+110*60*1000},updated_at:new Date().toISOString()},{onConflict:"key"});
  return j.access_token;
}
function ymd(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
async function cafe24Rows(){
  const token=await cafe24Token();
  const end=ymd(new Date()), start=ymd(new Date(Date.now()-45*86400000)); const all=[]; let off=0;
  while(true){const qs=new URLSearchParams({start_date:start,end_date:end,limit:"100",offset:String(off),embed:"items,receivers"});
    const res=await fetch(`${BASE()}/api/v2/admin/orders?${qs}`,{headers:{Authorization:`Bearer ${token}`}});
    const d=await res.json(); const b=d.orders??[]; all.push(...b); if(b.length<100)break; off+=100;}
  const rows=[];
  for(const o of all){
    const r=(o.receivers??[])[0]; if(!r)continue;
    const ship=(o.items??[]).filter(it=>String(it.status_text||"")==="배송준비중");
    const mob=clean(r.cellphone||r.phone);
    for(const it of ship){
      const prod=clean(it.product_name)+(clean(it.option_value)?" "+clean(it.option_value):"");
      const a1=clean(r.address1), a2=clean(r.address2);
      rows.push({name:clean(r.name),mobile:isMobile(mob)?mob:"",tel:isMobile(mob)?"":mob,addr:(a1+" "+a2).trim(),addr1:a1,addr2:a2,zip:clean(r.zipcode),prod,color:"",qty:String(it.quantity||1),msg:clean(r.shipping_message),order:clean(o.order_id),seller:"카페24"});
    }
  }
  return rows;
}

// ── 식스샵 국내 (최신 export, 결제완료) ──
function sixshopRows(){
  const dir=path.join(require("os").tmpdir(),"paulvice-marketplace-downloads");
  const cands=fs.existsSync(dir)?fs.readdirSync(dir).filter(x=>x.includes("국내")&&/\.xlsx$/.test(x)).map(x=>({x,m:fs.statSync(path.join(dir,x)).mtimeMs})).sort((a,b)=>b.m-a.m):[];
  if(!cands.length){ log("식스샵 export 없음 — 건너뜀"); return []; }
  const data=XLSX.utils.sheet_to_json(XLSX.readFile(path.join(dir,cands[0].x)).Sheets[XLSX.readFile(path.join(dir,cands[0].x)).SheetNames[0]],{header:1,defval:""});
  const C={name:0,phone:1,zip:2,addr:3,req:14,order:6,status:8,pname:47,qty:49,opt:50};
  const rows=[];
  for(let i=1;i<data.length;i++){
    if(!/결제\s?완료/.test(String(data[i][C.status]||"")))continue;
    const opt=clean(data[i][C.opt]); const mob=clean(data[i][C.phone]);
    rows.push({name:clean(data[i][C.name]),mobile:isMobile(mob)?mob:"",tel:isMobile(mob)?"":mob,addr:clean(data[i][C.addr]),zip:clean(data[i][C.zip]),prod:clean(data[i][C.pname])+(opt?" "+opt:""),color:"",qty:clean(data[i][C.qty])||"1",msg:clean(data[i][C.req]),order:clean(data[i][C.order]),seller:"식스샵"});
  }
  return rows;
}

// ── W컨셉 (현재는 wconceptReadyExtract 캐시 JSON 사용; 추후 인라인 추출) ──
function wconceptRows(){
  const fp="/tmp/wconcept_po_rows.json";
  if(!fs.existsSync(fp)){ log("W컨셉 캐시(/tmp/wconcept_po_rows.json) 없음 — 건너뜀"); return []; }
  const raw=JSON.parse(fs.readFileSync(fp,"utf8"));
  // 주문번호+상품명 dedup (75칸 병합행 중복 제거)
  const seen=new Set(); const out=[];
  for(const r of raw){ const k=r.order+"|"+r.prod; if(seen.has(k))continue; seen.add(k); out.push(r); }
  return out;
}

async function sendTelegram(filePath, caption){
  const token=process.env.TELEGRAM_BOT_TOKEN, chat=process.env.TELEGRAM_CHAT_ID;
  if(!token||!chat){ log("텔레그램 미설정 — 전송 생략"); return; }
  const buf=fs.readFileSync(filePath);
  for(let attempt=1; attempt<=3; attempt++){
    try{
      const form=new FormData();
      form.append("chat_id", chat);
      form.append("caption", caption);
      form.append("document", new Blob([buf]), path.basename(filePath));
      const res=await fetch(`https://api.telegram.org/bot${token}/sendDocument`,{method:"POST",body:form});
      if(res.ok){ log("텔레그램 전송 성공"); return; }
      log(`텔레그램 전송 실패(${attempt}/3) HTTP ${res.status}`);
    }catch(e){ log(`텔레그램 전송 예외(${attempt}/3): ${e.message}`); }
    await new Promise(r=>setTimeout(r,3000));
  }
}

// plvekorea@gmail.com 으로 우체국 파일 첨부 메일 발송 (cs_accounts gmail 계정 + GOOGLE 클라이언트로 갱신)
async function sendEmail(filePath, subject, body){
  const cid=process.env.GOOGLE_CLIENT_ID, secret=process.env.GOOGLE_CLIENT_SECRET;
  if(!cid||!secret){ log("GOOGLE_CLIENT_ID/SECRET 미설정 — 이메일 생략 (local-agent/.env 에 GOOGLE_CLIENT_SECRET 추가 필요)"); return; }
  const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
  const {data}=await sb.from("cs_accounts").select("credentials,display_name").eq("channel","gmail").in("status",["active","error"]).limit(1);
  const refresh=data&&data[0]&&data[0].credentials&&data[0].credentials.refresh_token;
  if(!refresh){ log("발송용 gmail 계정(cs_accounts) 없음 — 이메일 생략"); return; }
  const tr=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:cid,client_secret:secret,refresh_token:refresh,grant_type:"refresh_token"})});
  const tj=await tr.json(); if(!tj.access_token){ log("구글 토큰 갱신 실패: "+JSON.stringify(tj).slice(0,120)); return; }
  const TO="plvekorea@gmail.com";
  const fname=path.basename(filePath);
  const fstar=`UTF-8''${encodeURIComponent(fname)}`;
  const b64=fs.readFileSync(filePath).toString("base64");
  const subjEnc=`=?UTF-8?B?${Buffer.from(subject,"utf8").toString("base64")}?=`;
  const bnd="po_boundary_"+Date.now().toString(36);
  const mime=[
    `To: ${TO}`,`Subject: ${subjEnc}`,"MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${bnd}"`,"",
    `--${bnd}`,'Content-Type: text/plain; charset="UTF-8"',"Content-Transfer-Encoding: base64","",Buffer.from(body,"utf8").toString("base64"),
    `--${bnd}`,`Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet; name*=${fstar}`,`Content-Disposition: attachment; filename*=${fstar}`,"Content-Transfer-Encoding: base64","",b64,
    `--${bnd}--`,""
  ].join("\r\n");
  const raw=Buffer.from(mime,"utf8").toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
  const res=await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send",{method:"POST",headers:{Authorization:`Bearer ${tj.access_token}`,"Content-Type":"application/json"},body:JSON.stringify({raw})});
  log("이메일 발송(plvekorea) "+(res.ok?"성공":("실패 "+(await res.text()).slice(0,150))));
}

// 채널별 출고대기 주문 집계 → 정규화 행 배열. (우체국 API 접수/엑셀 빌더 공용)
async function collectOutboundRows(){
  let cafe=[], six=[], cm=[], wc=[];
  try { cafe=await cafe24Rows(); log(`카페24 ${cafe.length}행`); } catch(e){ log("카페24 실패: "+e.message); }
  try { six=sixshopRows(); log(`식스샵 ${six.length}행`); } catch(e){ log("식스샵 실패: "+e.message); }
  try { cm=await getCm29OutboundRows({}, log); log(`29CM ${cm.length}행`); } catch(e){ log("29CM 실패: "+e.message); }
  try { wc=wconceptRows(); log(`W컨셉 ${wc.length}행(캐시)`); } catch(e){ log("W컨셉 실패: "+e.message); }
  await closeMarketplaceBrowsers().catch(()=>{});
  return { rows:[...cafe,...six,...cm,...wc], counts:{cafe:cafe.length,six:six.length,cm:cm.length,wc:wc.length} };
}

module.exports = { collectOutboundRows };

// CLI: 엑셀 빌드 + 텔레그램/이메일 발송 (기존 동작)
async function main(){
  const today = new Date();
  const date = process.env.PO_DATE || `${today.getFullYear()}${String(today.getMonth()+1).padStart(2,"0")}${String(today.getDate()).padStart(2,"0")}`;
  const { rows, counts } = await collectOutboundRows();
  const aoa=[HEADER, ...rows.map(r=>[r.name,r.mobile,r.tel,r.addr,r.zip,r.prod,r.color,r.qty,r.msg,r.order,r.seller])];
  const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(aoa),"sheet1");
  const out=`/tmp/우체국송장양식_${date}_1.xlsx`; XLSX.writeFile(wb,out);
  const summary=`총 ${rows.length}행 (카페24 ${counts.cafe}, 식스샵 ${counts.six}, 29CM ${counts.cm}, W컨셉 ${counts.wc})`;
  log(`생성: ${out} — ${summary}`);
  console.log("\n" + JSON.stringify(HEADER));
  rows.forEach(r=>console.log(JSON.stringify([r.name,r.mobile,r.tel,r.addr,r.zip,r.prod,r.qty,r.msg,r.order,r.seller])));
  // 우체국 자동접수 (POSTPARCEL_AUTO_REGISTER=Y). 집계한 rows 재사용(재집계 없음).
  // testYn 은 POSTPARCEL_TEST_YN 로 제어 — 실운영 전까지 Y 권장.
  let autoMsg = "";
  if ((process.env.POSTPARCEL_AUTO_REGISTER||"").toUpperCase()==="Y") {
    try {
      const { registerRows } = require("./postParcel/register");
      const r = await registerRows(rows);
      autoMsg = `\n📮 우체국 자동접수: 성공 ${r.ok} / 스킵 ${r.skipped} / 실패 ${r.failed} (test=${(process.env.POSTPARCEL_TEST_YN??"Y").toUpperCase()})`;
      log(`우체국 자동접수: ok ${r.ok}/skip ${r.skipped}/fail ${r.failed}`);
    } catch(e){ autoMsg = `\n📮 우체국 자동접수 실패: ${e.message}`; log("우체국 자동접수 실패: "+e.message); }
  }

  const cap=`📦 우체국 발송 양식 (${date})\n${summary}${autoMsg}`;
  try { await sendTelegram(out, cap); } catch(e){ log("텔레그램 전송 실패: "+e.message); }
  try { await sendEmail(out, `우체국 발송 양식 ${date}`, `우체국 발송 양식입니다.\n${summary}${autoMsg}\n\n첨부파일을 우체국에 업로드하세요.`); } catch(e){ log("이메일 발송 실패: "+e.message); }
}

if (require.main === module) {
  main().catch(e=>{ console.error("ERR", e); process.exit(1); });
}
