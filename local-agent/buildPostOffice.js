/**
 * 우체국 발송 엑셀 통합 빌더 (출고 Phase 1).
 * 채널별 출고대기 주문 → 11컬럼 우체국 양식(상품별 1행) → 우체국송장양식_YYYYMMDD_1.xlsx
 *   - 카페24: Admin API (배송준비중) — 읽기 (폴바이스 + 해리엇 멀티몰)
 *   - 29CM: 출고관리 상세창(/detail) — 읽기 (cm29Outbound)
 *   - W컨셉/무신사: 추후 추가
 * 카페24/Supabase 자격증명은 대시보드 .env.supabase/.env.local 에서 로드.
 */
require("dotenv").config({ override: true }); // local-agent/.env (CM29_*, PAULWISE_MCP_TOKEN 등)
const fs = require("fs"), path = require("path");
const XLSX = require("xlsx");
const DASH = path.resolve(__dirname, "..");
function loadEnv(p){ try { for(const line of fs.readFileSync(p,"utf8").split("\n")){const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);if(!m)continue;let v=m[2].trim().replace(/^["']|["']$/g,"");if(!(m[1] in process.env))process.env[m[1]]=v;} } catch {} }
loadEnv(path.join(DASH, ".env.supabase")); loadEnv(path.join(DASH, ".env.local"));
const { createClient } = require(path.join(DASH, "node_modules/@supabase/supabase-js"));
const { getCm29OutboundRows } = require("./cm29Outbound");
const { getMusinsaGlobalRows } = require("./musinsaGlobalOutbound");
const { getMusinsaDomesticRows } = require("./musinsaDomesticOutbound");
const { closeMarketplaceBrowsers } = require("./marketplaceSync");

const HEADER = ["수취인명","수취인 이동통신","수취인 전화번호","수취인 주소","수취인 우편번호","상품명","색상","수량","배송메세지","주문번호","판매처"];
const clean = (v) => { const s = String(v??"").trim(); return s==="-" ? "" : s; };
const isMobile = (p) => /^01[016789]/.test(String(p||"").replace(/\D/g,""));
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
/**
 * 상품명이 예약판매/재입고대기를 표시하고 있으면 true — 집계에서 자동 제외한다.
 * 카페24 상품명에 "[8/19 재입고 예약]", "[예약판매]" 처럼 대괄호로 붙여 파는 관행을 이용.
 * 보류목록(pp_hold_orders)이 주문번호 단위라 신규 주문을 못 막는 구멍을 메운다.
 * 재입고돼서 실제 발송할 땐 상품명에서 표시를 떼거나 registerSingle 로 단건 접수하면 된다.
 */
function isPreorderProduct(prod){
  const s = String(prod || "");
  return /\[[^\]]*(예약|재입고|입고예정|출고예정)[^\]]*\]/.test(s);
}

// 카페24 각인(추가 입력 옵션) 추출: additional_option_value="라벨=값" → 값. 비면 "".
function engravingOf(it){
  let raw = clean(it.additional_option_value);
  if(!raw && Array.isArray(it.additional_option_values)){
    const a = it.additional_option_values.find(x=>x&&x.value);
    if(a) raw = (a.name?`${a.name}=`:"")+a.value;
  }
  if(!raw) return "";
  return raw.includes("=") ? raw.split("=").slice(1).join("=").trim() : raw.trim();
}

// ── 카페24 (API) — 멀티몰: 폴바이스(판매처="카페24") + 해리엇(판매처="해리엇") ──
// seller 가 곧 pp_shipments.channel (register.js channel=row.seller) — 몰별로 분리돼 dedup·송장입력이 안 섞인다.
const CAFE24_MALLS = [
  { seller:"카페24", mallId:()=>process.env.CAFE24_MALL_ID,         clientId:()=>process.env.CAFE24_CLIENT_ID,         secret:()=>process.env.CAFE24_CLIENT_SECRET,         kvKey:"cafe24_refresh_token" },
  { seller:"해리엇", mallId:()=>process.env.HARRIOT_CAFE24_MALL_ID, clientId:()=>process.env.HARRIOT_CAFE24_CLIENT_ID, secret:()=>process.env.HARRIOT_CAFE24_CLIENT_SECRET, kvKey:"cafe24_refresh_token:harriot" },
];
async function cafe24Token(m){
  const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
  const {data}=await sb.from("kv_store").select("data").eq("key",m.kvKey).maybeSingle();
  let t=data?.data; if(typeof t==="string")t={access_token:"",refresh_token:t,expires_at:0};
  if(!t||!t.refresh_token)throw new Error(`${m.seller} 카페24 토큰 없음(${m.kvKey})`);
  const now=Date.now(), base=`https://${m.mallId()}.cafe24api.com`;
  if(t.access_token&&t.expires_at&&t.expires_at-90000>now)return t.access_token;
  const res=await fetch(`${base}/api/v2/oauth/token`,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded",Authorization:"Basic "+Buffer.from(`${m.clientId()}:${m.secret()}`).toString("base64")},body:`grant_type=refresh_token&refresh_token=${encodeURIComponent(t.refresh_token)}`});
  const j=await res.json(); if(!j.access_token)throw new Error(`${m.seller} cafe24 refresh 실패`);
  await sb.from("kv_store").upsert({key:m.kvKey,data:{access_token:j.access_token,refresh_token:j.refresh_token,expires_at:now+110*60*1000},updated_at:new Date().toISOString()},{onConflict:"key"});
  return j.access_token;
}
function ymd(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
async function cafe24Rows(m){
  const base=`https://${m.mallId()}.cafe24api.com`;
  const token=await cafe24Token(m);
  const end=ymd(new Date()), start=ymd(new Date(Date.now()-45*86400000)); const all=[]; let off=0;
  while(true){const qs=new URLSearchParams({start_date:start,end_date:end,limit:"100",offset:String(off),embed:"items,receivers"});
    const res=await fetch(`${base}/api/v2/admin/orders?${qs}`,{headers:{Authorization:`Bearer ${token}`}});
    const d=await res.json(); const b=d.orders??[]; all.push(...b); if(b.length<100)break; off+=100;}
  const rows=[];
  for(const o of all){
    const r=(o.receivers??[])[0]; if(!r)continue;
    const ship=(o.items??[]).filter(it=>String(it.status_text||"")==="배송준비중");
    const mob=clean(r.cellphone||r.phone);
    for(const it of ship){
      const eng=engravingOf(it);
      const prod=clean(it.product_name)+(clean(it.option_value)?" "+clean(it.option_value):"")+(eng?` (각인:${eng})`:"");
      const a1=clean(r.address1), a2=clean(r.address2);
      rows.push({name:clean(r.name),mobile:isMobile(mob)?mob:"",tel:isMobile(mob)?"":mob,addr:(a1+" "+a2).trim(),addr1:a1,addr2:a2,zip:clean(r.zipcode),prod,color:"",qty:String(it.quantity||1),msg:clean(r.shipping_message),order:clean(o.order_id),seller:m.seller});
    }
  }
  return rows;
}

// 식스샵 국내 수집 제거(2026-07-15): 해리엇 국내몰은 카페24(harriotkorea)로 이전, 식스샵 글로벌은
// FedEx(우체국 흐름 밖)라 우체국 파이프라인의 식스샵 수집은 폐기. export 버튼 셀렉터 변경으로 매번 실패만 냄.

// ── W컨셉 (현재는 wconceptReadyExtract 캐시 JSON 사용; 추후 인라인 추출) ──
function wconceptRows(){
  const fp="/tmp/wconcept_po_rows.json";
  if(!fs.existsSync(fp)){ log("W컨셉 캐시(/tmp/wconcept_po_rows.json) 없음 — 건너뜀"); return []; }
  const raw=JSON.parse(fs.readFileSync(fp,"utf8"));
  // 주문번호+상품명 합산 — W컨셉은 같은 상품 다수량을 "수량1 여러 줄"로 내려줌.
  // 같은 (주문번호|상품명) 줄은 버리지 않고 수량을 더한다(엑셀 기준 진짜 다수량 반영).
  const byKey=new Map(); const out=[];
  for(const r of raw){
    const k=r.order+"|"+r.prod;
    const cur=byKey.get(k);
    if(cur){ cur.qty=String((parseInt(cur.qty,10)||1)+(parseInt(r.qty,10)||1)); continue; }
    const row={...r, qty:String(parseInt(r.qty,10)||1)};
    byKey.set(k,row); out.push(row);
  }
  return out;
}

// ── 합배송 병합 (수취인 단위) ──
// 같은 사람이 같은 주소로 여러 종류를 사면 송장 1장으로. 판매처+이름+연락처+우편번호+주소가 키.
// 판매처(seller)를 키에 포함 → 채널 간에는 절대 안 섞임(채널별 송장 역입력이 분리돼야 하므로).
// 표시/엑셀용: 상품 결합·수량 합산·주문번호 '+'결합. 실제 접수 묶음은 register.js groupByRecipient.
function recipientKey(r){
  const norm = (s) => String(s||"").replace(/\s+/g,"").trim();      // 이름·주소: 공백 제거
  const dig = (s) => String(s||"").replace(/\D/g,"");                // 연락처·우편번호: 숫자만(포맷차 흡수)
  return [r.seller, norm(r.name), dig(r.mobile)||dig(r.tel), dig(r.zip), norm(r.addr)].join("|");
}
function mergeByRecipient(rows){
  const map = new Map();
  for(const r of rows){
    const key = recipientKey(r);
    if(!map.has(key)) map.set(key, { ...r, _orders:[], _prods:[], _qty:0 });
    const g = map.get(key);
    if(r.order && !g._orders.includes(r.order)) g._orders.push(r.order);
    const p = String(r.prod||"").trim();
    if(p && !g._prods.includes(p)) g._prods.push(p);
    g._qty += Number(String(r.qty).replace(/\D/g,"")) || 1;
    if(!g.msg && r.msg) g.msg = r.msg;
  }
  return [...map.values()].map((g) => {
    let prod = g._prods.join(" / ");
    if(prod.length > 400) prod = prod.slice(0,397) + "..."; // goodsNm 최대 400byte
    const { _orders, _prods, _qty, ...rest } = g;
    return { ...rest, prod, qty:String(g._qty||1), order:g._orders.sort().join("+") };
  });
}

async function sendTelegram(filePath, caption){
  const token=process.env.TELEGRAM_BOT_TOKEN, chat=process.env.TELEGRAM_CHAT_ID;
  if(!token||!chat){ log("텔레그램 미설정 — 전송 생략"); return; }
  const buf=fs.readFileSync(filePath);
  // 멀티파트 업로드가 간헐적 ETIMEDOUT — 5회 재시도 + 45s 타임아웃
  for(let attempt=1; attempt<=5; attempt++){
    try{
      const form=new FormData();
      form.append("chat_id", chat);
      form.append("caption", caption);
      form.append("document", new Blob([buf]), path.basename(filePath));
      const res=await fetch(`https://api.telegram.org/bot${token}/sendDocument`,{method:"POST",body:form,signal:AbortSignal.timeout(45000)});
      if(res.ok){ log(`텔레그램 전송 성공(시도 ${attempt})`); return; }
      log(`텔레그램 전송 실패(${attempt}/5) HTTP ${res.status}`);
    }catch(e){ log(`텔레그램 전송 예외(${attempt}/5): ${e.cause&&e.cause.code||e.message}`); }
    await new Promise(r=>setTimeout(r,5000));
  }
  // 직결 실패(아이맥→텔레그램 ETIMEDOUT 잦음) → Vercel 릴레이 폴백. Vercel→텔레그램은 안정적.
  try{
    const base=(process.env.DASHBOARD_URL||"https://paulvice-dashboard.vercel.app").replace(/\/$/,"");
    const res=await fetch(`${base}/api/marketplace/telegram-relay`,{
      method:"POST",
      headers:{"Content-Type":"application/json","x-agent-token":process.env.PAULWISE_MCP_TOKEN||""},
      body:JSON.stringify({caption, filename:path.basename(filePath), fileBase64:buf.toString("base64")}),
      signal:AbortSignal.timeout(60000),
    });
    if(res.ok){ log("텔레그램 릴레이(Vercel) 성공"); return; }
    log(`텔레그램 릴레이 실패 HTTP ${res.status}: ${(await res.text().catch(()=>"")).slice(0,200)}`);
  }catch(e){ log(`텔레그램 릴레이 예외: ${e.cause&&e.cause.code||e.message}`); }
  log("텔레그램 전송 5회 + 릴레이 모두 실패");
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
// 이미 우체국 접수된 주문 키 집합 (재탕 방지). 채널 캐시/export 가 발송완료 건을 안 비워도
// pp_shipments(실접수·송장有) 기준으로 양식·접수에서 제외한다. seller|order 매칭.
async function alreadyRegisteredKeys(){
  try {
    const { createClient } = require(path.join(DASH,"node_modules/@supabase/supabase-js"));
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data } = await sb.from("pp_shipments").select("order_number,channel")
      .eq("is_test",false).eq("status","submitted").not("regi_no","is",null);
    return new Set((data||[]).map(r=>`${r.channel}|${r.order_number}`));
  } catch(e){ log("pp_shipments 조회 실패 — 재탕 필터 생략: "+e.message); return new Set(); }
}

async function collectOutboundRows(){
  let cafe=[], cm=[], wc=[], mg=[], md=[];
  // 카페24 멀티몰: 폴바이스 + 해리엇(미설정 몰은 건너뜀). 각 몰 실패해도 나머지 진행.
  for(const m of CAFE24_MALLS){
    if(!m.mallId()){ continue; }
    try { const r=await cafe24Rows(m); cafe.push(...r); log(`${m.seller} ${r.length}행`); }
    catch(e){ log(`${m.seller} 실패: `+e.message); }
  }
  try { cm=await getCm29OutboundRows({}, log); log(`29CM ${cm.length}행`); } catch(e){ log("29CM 실패: "+e.message); }
  try { wc=wconceptRows(); log(`W컨셉 ${wc.length}행(캐시)`); } catch(e){ log("W컨셉 실패: "+e.message); }
  // 무신사: 글로벌·일반 모두 국내 우체국 발송. 일반은 상품준비중 변경 후 배송출고처리 엑셀에서 주소 수집.
  try { mg=await getMusinsaGlobalRows({}, log); log(`무신사글로벌 ${mg.length}행`); } catch(e){ log("무신사글로벌 실패: "+e.message); }
  try { md=await getMusinsaDomesticRows({}, log); log(`무신사일반 ${md.length}행`); } catch(e){ log("무신사일반 실패: "+e.message); }
  await closeMarketplaceBrowsers().catch(()=>{});

  // 이미 접수된 건 제외 (캐시·export 가 발송완료분을 재탕하는 문제 차단)
  const all=[...cafe,...cm,...wc,...mg,...md];
  const done=await alreadyRegisteredKeys();
  const notDone=all.filter(r=>!done.has(`${r.seller}|${r.order}`));
  const skipped=all.length-notDone.length;
  if(skipped) log(`이미 우체국 접수된 ${skipped}행 제외(재탕 방지)`);
  // 발송 보류(품절·예약판매) 제외 — 송장만 취소하면 다음 크론이 재접수하므로 여기서 막는다.
  const held=await require("./postParcel/holdOrders").holdKeys();
  const notHeld=notDone.filter(r=>!held.has(`${r.seller}|${r.order}`));
  const heldCount=notDone.length-notHeld.length;
  if(heldCount) log(`발송보류 ${heldCount}행 제외(품절·예약판매 대기)`);
  // 상품명 자체가 예약판매인 건 자동 제외. 보류목록(pp_hold_orders)은 주문번호 단위 수동등록이라
  // 예약 상품에 새 주문이 들어오면 그대로 통과해버린다 (2026-08-04 이하늬·김진아 오출고 사고 —
  // 상품명에 "[8/19 재입고 예약]" 이 박혀 있는데도 접수되고 배송중까지 전환됨).
  const rows=notHeld.filter(r=>!isPreorderProduct(r.prod));
  const preCount=notHeld.length-rows.length;
  if(preCount) log(`예약판매 상품명 ${preCount}행 제외(상품명에 예약/재입고 표시)`);
  const cnt=(s)=>rows.filter(r=>r.seller===s).length;
  return { rows, heldCount, counts:{cafe:cnt("카페24"),har:cnt("해리엇"),cm:cnt("29CM"),wc:cnt("W컨셉"),mu:cnt("무신사")} };
}

module.exports = { collectOutboundRows, sendTelegram, sendEmail, HEADER, recipientKey, mergeByRecipient };

// CLI: 엑셀 빌드 + 텔레그램/이메일 발송 (기존 동작)
async function main(){
  const today = new Date();
  const date = process.env.PO_DATE || `${today.getFullYear()}${String(today.getMonth()+1).padStart(2,"0")}${String(today.getDate()).padStart(2,"0")}`;
  const { rows, counts, heldCount } = await collectOutboundRows();
  // 합배송: 동일 수취인의 여러 주문/상품을 송장 1장(엑셀 1행)으로. 접수도 register.js 가 수취인별로 묶음.
  const ex = mergeByRecipient(rows);
  const aoa=[HEADER, ...ex.map(r=>[r.name,r.mobile,r.tel,r.addr,r.zip,r.prod,r.color,r.qty,r.msg,r.order,r.seller])];
  const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(aoa),"sheet1");
  const out=`/tmp/우체국송장양식_${date}_1.xlsx`; XLSX.writeFile(wb,out);
  const merged = rows.length - ex.length;
  const summary=`총 ${ex.length}건 / ${rows.length}행${merged>0?` (합배송 ${merged}행 묶음)`:""} (카페24 ${counts.cafe}, 해리엇 ${counts.har}, 29CM ${counts.cm}, W컨셉 ${counts.wc}, 무신사 ${counts.mu})${heldCount?`\n⏸ 발송보류 ${heldCount}행 제외 (품절·예약판매 대기)`:""}`;
  log(`생성: ${out} — ${summary}`);
  console.log("\n" + JSON.stringify(HEADER));
  ex.forEach(r=>console.log(JSON.stringify([r.name,r.mobile,r.tel,r.addr,r.zip,r.prod,r.qty,r.msg,r.order,r.seller])));
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
