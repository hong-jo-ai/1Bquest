/**
 * 카카오선물하기 출고 — plvekorea@gmail.com 에서 김송이(song@fjord.kr) '발주서' .xlsx 첨부 →
 * 주소/우편번호 포함 전체 파싱 → 우체국 행(seller="카카오선물하기"). 송장 없는 건만(출고대기).
 * Gmail 토큰: kv_store 'kakao_gift_gmail_token'(refresh) + GOOGLE_CLIENT_ID/SECRET 갱신.
 */
const fs = require("fs"), path = require("path");
const DASH = "/Users/mac/sungjo_ai/paulwise-dashboard";
function loadEnv(p){ try { for(const line of fs.readFileSync(p,"utf8").split("\n")){const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);if(!m)continue;let v=m[2].trim().replace(/^["']|["']$/g,"");if(!(m[1] in process.env))process.env[m[1]]=v;} } catch {} }
require("dotenv").config({ override: true });
loadEnv(path.join(DASH, ".env.supabase")); loadEnv(path.join(DASH, ".env.local"));
const XLSX = require(path.join(DASH, "node_modules/xlsx"));
const { createClient } = require(path.join(DASH, "node_modules/@supabase/supabase-js"));

const SENDER = "song@fjord.kr";
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const clean = (v) => { const s = String(v??"").trim(); return s==="-"?"":s; };
const isMobile = (p) => /^01[016789]/.test(String(p||"").replace(/\D/g,""));

async function gmailToken(){
  const cid=process.env.GOOGLE_CLIENT_ID, secret=process.env.GOOGLE_CLIENT_SECRET;
  if(!cid||!secret) throw new Error("GOOGLE_CLIENT_ID/SECRET 미설정 (local-agent/.env 에 GOOGLE_CLIENT_SECRET 추가 필요)");
  const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
  const {data}=await sb.from("kv_store").select("data").eq("key","kakao_gift_gmail_token").maybeSingle();
  const refresh=typeof data?.data==="string"?data.data:(data?.data&&data.data.refresh_token);
  if(!refresh) throw new Error("kakao_gift_gmail_token 없음 — plvekorea Gmail 미연결");
  const r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:cid,client_secret:secret,refresh_token:refresh,grant_type:"refresh_token"})});
  const j=await r.json(); if(!j.access_token) throw new Error("plvekorea 토큰 갱신 실패: "+JSON.stringify(j).slice(0,120));
  return j.access_token;
}
async function gget(token, p){ const r=await fetch(GMAIL+p,{headers:{Authorization:`Bearer ${token}`}}); if(!r.ok)throw new Error(`Gmail ${p} ${r.status} ${await r.text()}`.slice(0,200)); return r.json(); }

function findXlsxParts(payload, out=[]){
  if(!payload) return out;
  const fn=payload.filename||"";
  if(fn.toLowerCase().endsWith(".xlsx") && payload.body && payload.body.attachmentId) out.push({filename:fn, attachmentId:payload.body.attachmentId});
  for(const part of (payload.parts||[])) findXlsxParts(part, out);
  return out;
}

// 발주서 .xlsx 버퍼 → 우체국 행 (헤더명 매칭, 주소/우편번호 포함)
function parseRows(buffer){
  const wb=XLSX.read(buffer,{type:"buffer"});
  const ws=wb.Sheets[wb.SheetNames[0]];
  const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:""});
  if(rows.length<2) return [];
  const h=rows[0].map(c=>String(c).replace(/\s+/g,"").trim());
  const find=(...keys)=>{ for(const k of keys){const i=h.findIndex(x=>x.includes(k));if(i>=0)return i;} return -1; };
  const C={name:find("수취인명","수령인","받는"),mobile:find("이동통신","휴대"),tel:find("전화"),addr:find("주소","배송지"),zip:find("우편"),prod:find("상품명"),color:find("색상","옵션"),qty:find("수량"),msg:find("배송메세지","배송메시지","요청"),order:find("주문번호"),track:find("운송장","송장")};
  const out=[];
  for(let i=1;i<rows.length;i++){
    const row=rows[i]; if(!row||row.every(c=>!String(c).trim()))continue;
    const order=C.order>=0?clean(row[C.order]):""; const prod=C.prod>=0?clean(row[C.prod]):"";
    if(!order||!prod)continue; // 합계/빈 행 스킵
    if(C.track>=0 && clean(row[C.track])) continue; // 이미 운송장 있음 = 출고됨, 제외
    const mob=C.mobile>=0?clean(row[C.mobile]):"";
    const tel=C.tel>=0?clean(row[C.tel]):"";
    // 색상 칸(=옵션/각인)은 길면 우체국 goodsColor 40byte 초과 → 상품명에 합치고 색상은 비움(다른 채널과 동일)
    const opt=C.color>=0?clean(row[C.color]):"";
    out.push({
      name:C.name>=0?clean(row[C.name]):"",
      mobile:isMobile(mob)?mob:(isMobile(tel)?tel:""),
      tel:isMobile(mob)?tel:(isMobile(tel)?mob:(tel||mob)),
      addr:C.addr>=0?clean(row[C.addr]):"",
      zip:C.zip>=0?clean(row[C.zip]):"",
      prod: prod+(opt?" "+opt:""), color:"",
      qty:C.qty>=0?(clean(row[C.qty])||"1"):"1",
      msg:C.msg>=0?clean(row[C.msg]):"",
      order, seller:"카카오선물하기",
    });
  }
  return out;
}

async function getKakaoGiftRows(_opts, log=console.log){
  const token=await gmailToken();
  const q=encodeURIComponent(`from:${SENDER} subject:발주서 has:attachment newer_than:2d`);
  const list=await gget(token, `/messages?q=${q}&maxResults=10`);
  const msgs=list.messages||[];
  if(!msgs.length){ log("김송이 발주서 메일 없음(newer_than:2d)"); return []; }
  // 가장 최근 메일부터, 첨부 .xlsx 파싱 (최신 1통)
  let rows=[];
  for(const meta of msgs){
    const msg=await gget(token, `/messages/${meta.id}?format=full`);
    const parts=findXlsxParts(msg.payload);
    if(!parts.length) continue;
    for(const p of parts){
      const att=await gget(token, `/messages/${meta.id}/attachments/${p.attachmentId}`);
      if(!att.data) continue;
      const buf=Buffer.from(att.data.replace(/-/g,"+").replace(/_/g,"/"),"base64");
      const r=parseRows(buf);
      log(`발주서 '${p.filename}' → ${r.length}건`);
      rows.push(...r);
    }
    if(rows.length) break; // 최신 메일 처리 후 종료
  }
  // 주문번호+상품 dedup
  const seen=new Set(); const out=[];
  for(const r of rows){ const k=r.order+"|"+r.prod; if(seen.has(k))continue; seen.add(k); out.push(r); }
  return out;
}

module.exports = { getKakaoGiftRows, parseRows };

if (require.main === module){
  const log=(m)=>console.log(`[${new Date().toISOString()}] ${m}`);
  getKakaoGiftRows({}, log).then(rows=>{
    console.log("\n=== 카카오선물하기 우체국 행 ===");
    rows.forEach(r=>console.log(JSON.stringify([r.name,r.mobile,r.tel,r.addr,r.zip,r.prod,r.qty,r.msg,r.order,r.seller])));
    console.log("총 "+rows.length+"건");
  }).catch(e=>{ console.error("ERR", e.message); process.exit(1); });
}
