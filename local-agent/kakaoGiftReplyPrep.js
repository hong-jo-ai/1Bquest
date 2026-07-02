/** 카카오선물 송장회신 준비 — 김송이 발주서 메일+엑셀 받아 운송장번호 채워 저장 + 메일메타/발송권한 확인. 발송 X(승인 대기). */
const fs=require("fs"), path=require("path");
const DASH="/Users/mac/sungjo_ai/paulwise-dashboard";
function le(p){try{for(const l of fs.readFileSync(p,"utf8").split("\n")){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);if(!m)continue;let v=m[2].trim().replace(/^["']|["']$/g,"");if(!(m[1] in process.env))process.env[m[1]]=v;}}catch{}}
require("dotenv").config({ override: true });
le(DASH+"/.env.supabase"); le(DASH+"/.env.local");
const XLSX=require(DASH+"/node_modules/xlsx");
const { createClient }=require(DASH+"/node_modules/@supabase/supabase-js");
const SENDER="song@fjord.kr";
const GMAIL="https://gmail.googleapis.com/gmail/v1/users/me";

async function tokenAndScope(){
  const cid=process.env.GOOGLE_CLIENT_ID, secret=process.env.GOOGLE_CLIENT_SECRET;
  const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
  const {data}=await sb.from("kv_store").select("data").eq("key","kakao_gift_gmail_token").maybeSingle();
  const refresh=typeof data.data==="string"?data.data:data.data.refresh_token;
  const r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:cid,client_secret:secret,refresh_token:refresh,grant_type:"refresh_token"})});
  const j=await r.json();
  return { token:j.access_token, scope:j.scope||"" };
}
async function gget(token,p){ const r=await fetch(GMAIL+p,{headers:{Authorization:`Bearer ${token}`}}); return r.json(); }
function findXlsx(payload,out=[]){ if(!payload)return out; if((payload.filename||"").toLowerCase().endsWith(".xlsx")&&payload.body?.attachmentId) out.push({filename:payload.filename,attachmentId:payload.body.attachmentId}); for(const p of (payload.parts||[])) findXlsx(p,out); return out; }
function hdr(payload,name){ const h=(payload.headers||[]).find(x=>x.name.toLowerCase()===name.toLowerCase()); return h?h.value:""; }

(async()=>{
  const { token, scope }=await tokenAndScope();
  console.log("plvekorea 토큰 scope:", scope);
  console.log("send 가능?", /gmail\.send|gmail\.compose|mail\.google\.com|gmail\.modify/.test(scope)?"가능성 있음(modify/send)":"❌ 불가(읽기전용)");

  // 발주서 메일
  const q=encodeURIComponent(`from:${SENDER} subject:발주서 has:attachment newer_than:2d`);
  const list=await gget(token,`/messages?q=${q}&maxResults=5`);
  const msgs=list.messages||[];
  if(!msgs.length){ console.log("발주서 메일 없음"); return; }
  const msg=await gget(token,`/messages/${msgs[0].id}?format=full`);
  const subject=hdr(msg.payload,"Subject"), from=hdr(msg.payload,"From"), to=hdr(msg.payload,"To"), msgId=hdr(msg.payload,"Message-ID");
  console.log("\n원본 메일:");
  console.log("  From:", from);
  console.log("  To:", to);
  console.log("  Subject:", subject);
  console.log("  gmail messageId:", msgs[0].id, "threadId:", msg.threadId);
  console.log("  Message-ID(헤더):", msgId);

  // 첨부 다운로드 + 운송장 채우기
  const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
  const {data:ships}=await sb.from("pp_shipments").select("order_number,regi_no,recipient_name").eq("channel","카카오선물하기").eq("req_type","1").eq("is_test",false).not("regi_no","is",null);
  const trackMap=new Map((ships||[]).map(s=>[String(s.order_number),s.regi_no]));
  console.log("\n카카오선물 송장:", [...trackMap.entries()].map(([o,t])=>o+"→"+t).join(", "));

  const atts=findXlsx(msg.payload);
  if(!atts.length){ console.log("xlsx 첨부 없음"); return; }
  const att=await gget(token,`/messages/${msgs[0].id}/attachments/${atts[0].attachmentId}`);
  const buf=Buffer.from(att.data.replace(/-/g,"+").replace(/_/g,"/"),"base64");
  const wb=XLSX.read(buf,{type:"buffer"});
  const ws=wb.Sheets[wb.SheetNames[0]];
  const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:""});
  const h=rows[0].map(c=>String(c).replace(/\s+/g,"").trim());
  const colOrder=h.findIndex(c=>c.includes("주문번호"));
  const colTrack=h.findIndex(c=>c.includes("운송장"));
  console.log("\n발주서 헤더:", JSON.stringify(rows[0]));
  console.log("주문번호 col:", colOrder, "운송장 col:", colTrack);
  let filled=0;
  for(let i=1;i<rows.length;i++){
    const ord=String(rows[i][colOrder]||"").trim(); if(!ord)continue;
    const t=trackMap.get(ord);
    if(t){ rows[i][colTrack]=t; filled++; console.log("  채움:", ord, rows[i][0], "→", t); }
    else console.log("  매칭없음:", ord, rows[i][0]);
  }
  // 저장 (원본 파일명 유지)
  const out=XLSX.utils.aoa_to_sheet(rows);
  const owb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(owb,out,wb.SheetNames[0]);
  // 시트2(면세점 등) 있으면 보존
  for(let si=1;si<wb.SheetNames.length;si++){ XLSX.utils.book_append_sheet(owb,wb.Sheets[wb.SheetNames[si]],wb.SheetNames[si]); }
  const fp="/tmp/"+atts[0].filename;
  XLSX.writeFile(owb,fp);
  console.log(`\n운송장 ${filled}건 채움 → 저장: ${fp}`);
})().catch(e=>{console.error("ERR",e.message);process.exit(1);});
