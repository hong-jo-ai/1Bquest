/**
 * 카카오선물 송장 회신 (매일 자동, 멱등). 김송이(song@fjord.kr) 발주서 메일 →
 * .xlsx 운송장번호 컬럼 채움(pp_shipments 송장, 주문번호 매칭) → plvekorea에서 그 메일에 답장(첨부).
 * 멱등: kv kakao_invoice_replied(messageId) 같으면 스킵. 송장 미발급이면 발송 안 함.
 */
const fs=require("fs"), path=require("path");
const DASH="/Users/mac/sungjo_ai/paulwise-dashboard";
function le(p){try{for(const l of fs.readFileSync(p,"utf8").split("\n")){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);if(!m)continue;let v=m[2].trim().replace(/^["']|["']$/g,"");if(!(m[1] in process.env))process.env[m[1]]=v;}}catch{}}
require("dotenv").config({ override: true });
le(DASH+"/.env.supabase"); le(DASH+"/.env.local");
const XLSX=require(DASH+"/node_modules/xlsx");
const { createClient }=require(DASH+"/node_modules/@supabase/supabase-js");
const GMAIL="https://gmail.googleapis.com/gmail/v1/users/me";
const SENDER="song@fjord.kr", TO="song@fjord.kr";
const BODY="안녕하세요. 폴바이스입니다.\n오늘 발송 완료했습니다.\n송장번호는 첨부한 엑셀파일을 참고해주세요.\n\n감사합니다.";
const log=(m)=>console.log(`[${new Date().toISOString()}] ${m}`);
function findXlsx(pl,out=[]){ if(!pl)return out; if((pl.filename||"").toLowerCase().endsWith(".xlsx")&&pl.body?.attachmentId) out.push({filename:pl.filename,attachmentId:pl.body.attachmentId}); for(const p of (pl.parts||[])) findXlsx(p,out); return out; }
const hdr=(pl,n)=>{const h=(pl.headers||[]).find(x=>x.name.toLowerCase()===n.toLowerCase());return h?h.value:"";};

(async()=>{
  const cid=process.env.GOOGLE_CLIENT_ID, secret=process.env.GOOGLE_CLIENT_SECRET;
  if(!cid||!secret){ log("GOOGLE_CLIENT_SECRET 없음 — 중단"); return; }
  const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
  const {data:tk}=await sb.from("kv_store").select("data").eq("key","kakao_gift_gmail_token").maybeSingle();
  const refresh=typeof tk.data==="string"?tk.data:tk.data.refresh_token;
  const tr=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:cid,client_secret:secret,refresh_token:refresh,grant_type:"refresh_token"})});
  const tj=await tr.json(); if(!tj.access_token){ log("토큰 실패"); return; }
  const token=tj.access_token;
  const gget=async(p)=>{const r=await fetch(GMAIL+p,{headers:{Authorization:`Bearer ${token}`}});return r.json();};

  const q=encodeURIComponent(`from:${SENDER} subject:발주서 has:attachment newer_than:2d`);
  const list=await gget(`/messages?q=${q}&maxResults=3`);
  const m0=(list.messages||[])[0]; if(!m0){ log("발주서 메일 없음 — 종료"); return; }
  const flag=await sb.from("kv_store").select("data").eq("key","kakao_invoice_replied").maybeSingle();
  if(flag.data?.data?.messageId===m0.id){ log("이미 답장한 발주서 — 스킵 ("+m0.id+")"); return; }
  const msg=await gget(`/messages/${m0.id}?format=full`);
  const subject=hdr(msg.payload,"Subject"), origMsgId=hdr(msg.payload,"Message-ID"), threadId=msg.threadId;
  const reSubject=/^re:/i.test(subject)?subject:("Re: "+subject);

  // 송장맵 + 첨부 다운로드 후 운송장 채움
  const {data:ships}=await sb.from("pp_shipments").select("order_number,regi_no").eq("channel","카카오선물하기").eq("req_type","1").eq("is_test",false).eq("status","submitted").not("regi_no","is",null);
  const trackMap=new Map((ships||[]).map(s=>[String(s.order_number),s.regi_no]));
  const atts=findXlsx(msg.payload); if(!atts.length){ log("xlsx 첨부 없음 — 종료"); return; }
  const att=await gget(`/messages/${m0.id}/attachments/${atts[0].attachmentId}`);
  const buf=Buffer.from(att.data.replace(/-/g,"+").replace(/_/g,"/"),"base64");
  const wb=XLSX.read(buf,{type:"buffer"}); const ws=wb.Sheets[wb.SheetNames[0]];
  const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:""});
  const h=rows[0].map(c=>String(c).replace(/\s+/g,"").trim());
  const colOrder=h.findIndex(c=>c.includes("주문번호")), colTrack=h.findIndex(c=>c.includes("운송장"));
  let filled=0;
  for(let i=1;i<rows.length;i++){ const ord=String(rows[i][colOrder]||"").trim(); if(!ord)continue; const t=trackMap.get(ord); if(t){ rows[i][colTrack]=t; filled++; } }
  if(!filled){ log("운송장 채울 건 없음(송장 미발급?) — 발송 안 함"); return; }
  const owb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(owb,XLSX.utils.aoa_to_sheet(rows),wb.SheetNames[0]);
  for(let si=1;si<wb.SheetNames.length;si++) XLSX.utils.book_append_sheet(owb,wb.Sheets[wb.SheetNames[si]],wb.SheetNames[si]);
  const FILE="/tmp/"+atts[0].filename; XLSX.writeFile(owb,FILE);
  log(`운송장 ${filled}건 채움 → ${FILE}`);

  // 답장 발송
  const fstar=`UTF-8''${encodeURIComponent(atts[0].filename)}`;
  const b64=fs.readFileSync(FILE).toString("base64");
  const subjEnc=`=?UTF-8?B?${Buffer.from(reSubject,"utf8").toString("base64")}?=`;
  const bnd="kg_"+Date.now().toString(36);
  const head=[`To: ${TO}`,`Subject: ${subjEnc}`,"MIME-Version: 1.0"];
  if(origMsgId){ head.push(`In-Reply-To: ${origMsgId}`,`References: ${origMsgId}`); }
  const mime=[...head,`Content-Type: multipart/mixed; boundary="${bnd}"`,"",`--${bnd}`,'Content-Type: text/plain; charset="UTF-8"',"Content-Transfer-Encoding: base64","",Buffer.from(BODY,"utf8").toString("base64"),`--${bnd}`,`Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet; name*=${fstar}`,`Content-Disposition: attachment; filename*=${fstar}`,"Content-Transfer-Encoding: base64","",b64,`--${bnd}--`,""].join("\r\n");
  const raw=Buffer.from(mime,"utf8").toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
  const res=await fetch(`${GMAIL}/messages/send`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({raw,threadId})});
  const rj=await res.json().catch(()=>({}));
  if(res.ok){ log(`✅ 카카오 회신 발송 (${filled}건, msgId ${rj.id})`); await sb.from("kv_store").upsert({key:"kakao_invoice_replied",data:{messageId:m0.id,sentId:rj.id,at:new Date().toISOString()},updated_at:new Date().toISOString()},{onConflict:"key"}); }
  else log(`❌ 발송 실패 ${res.status}: ${JSON.stringify(rj).slice(0,200)}`);
})().catch(e=>{console.error("ERR",e.message);process.exit(1);});
