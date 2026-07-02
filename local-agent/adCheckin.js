/**
 * 광고 체크인 (일회성 launchd 예약 실행) — 2026-06-30 사장님 승인건.
 *   node adCheckin.js cut-summer     : 에끌라 여름세트 0627, 6/27~ 누적 0전환이면 PAUSED(컷) + 텔레그램 보고
 *   node adCheckin.js recheck-winner : 에끌라 오벌 골드(승자) + 신규 2종 일별 ROAS 요약 텔레그램 보고(증액 판단용)
 * 실행 후 자기 launchd 일회성 job 제거(연 1회 재발화 방지).
 */
const fs = require("fs"), path = require("path");
const DASH = "/Users/mac/sungjo_ai/paulwise-dashboard";
function loadEnv(p){ try { for (const l of fs.readFileSync(p,"utf8").split("\n")){ const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if(!m)continue; let v=m[2].trim().replace(/^["']|["']$/g,""); if(!(m[1] in process.env)) process.env[m[1]]=v; } } catch {} }
loadEnv(path.join(DASH,".env.local")); loadEnv(path.join(DASH,".env.supabase")); loadEnv(path.join(DASH,"local-agent/.env"));
const { createClient } = require(path.join(DASH,"node_modules/@supabase/supabase-js"));
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const relay = require("./telegramRelay").relayText;
const META_BASE = "https://graph.facebook.com/v22.0";
const krw = (n)=>Math.round(Number(n)).toLocaleString();

const SUMMER  = "120248242971380615"; // PLVE 에끌라 여름세트 0627 (폴바이스)
const WINNER  = "120246031757520615"; // 에끌라 오벌 골드 + 브라운밴드 (폴바이스, CBO)
const SUNGSAN = "120248172483580615"; // [해리엇] 성산 장바구니 0626
const KIWON   = "120248172678810615"; // [해리엇] 기원 KI:WON 0626

async function metaToken(){
  if (process.env.META_SYSTEM_TOKEN) return process.env.META_SYSTEM_TOKEN;
  const { data } = await db.from("kv_store").select("data").eq("key","meta_access_token").maybeSingle();
  const d = data && data.data;
  return (typeof d === "string" ? d : (d && d.access_token)) || null;
}
async function pauseAdset(adsetId){
  const tk = await metaToken(); if(!tk) throw new Error("meta_access_token 없음");
  const body = new URLSearchParams({ access_token: tk, status: "PAUSED" });
  const r = await fetch(`${META_BASE}/${adsetId}`, { method:"POST", headers:{"Content-Type":"application/x-www-form-urlencoded"}, body });
  const j = await r.json().catch(()=>({}));
  if (!r.ok) throw new Error(`pause 실패 [${r.status}]: ${JSON.stringify(j).slice(0,200)}`);
  return j;
}
async function metrics(adsetId, since){
  const { data } = await db.from("mads_daily_metrics").select("date,spend,revenue,conversions")
    .eq("meta_adset_id", adsetId).gte("date", since).order("date",{ascending:true});
  return data || [];
}
async function sumLine(id, since="2026-06-27"){
  const m = await metrics(id, since);
  const s=m.reduce((a,b)=>a+Number(b.spend),0), r=m.reduce((a,b)=>a+Number(b.revenue),0), c=m.reduce((a,b)=>a+b.conversions,0);
  return `지출 ${krw(s)}/매출 ${krw(r)}/ROAS ${s>0?(r/s).toFixed(2):"-"}x/전환 ${c}`;
}

async function cutSummer(){
  const m = await metrics(SUMMER, "2026-06-27");
  const conv=m.reduce((s,d)=>s+d.conversions,0), rev=m.reduce((s,d)=>s+Number(d.revenue),0), sp=m.reduce((s,d)=>s+Number(d.spend),0);
  if (conv === 0 && rev === 0){
    let res;
    try { await pauseAdset(SUMMER); res = "✅ 일시중지(PAUSED) 완료"; }
    catch(e){ res = `⚠️ 자동 중지 실패(${e.message}) — 관리자에서 수동 OFF 필요`; }
    await relay(`🔴 [광고 자동컷] PLVE 에끌라 여름세트 0627\n6/27~ 지출 ${krw(sp)}원 · 매출 0 · 전환 0\n→ 사장님 사전승인대로 ${res}`);
  } else {
    await relay(`🟢 [광고 유지] 에끌라 여름세트 — 전환 ${conv}건/매출 ${krw(rev)}원 발생 → 컷 안 함(유지). 누적 지출 ${krw(sp)}원`);
  }
}

async function recheckWinner(){
  const w = await metrics(WINNER, "2026-06-26");
  const lines=[]; let tS=0,tR=0;
  for (const d of w){ const roas=d.spend>0?d.revenue/d.spend:0; lines.push(`${d.date}: 지출 ${krw(d.spend)} / 매출 ${krw(d.revenue)} / ROAS ${roas.toFixed(2)}x / 전환 ${d.conversions}`); tS+=Number(d.spend); tR+=Number(d.revenue); }
  const overall = tS>0?(tR/tS).toFixed(2):"-";
  const ss=await sumLine(SUNGSAN), kw=await sumLine(KIWON);
  await relay(`📊 [7/3 광고 재점검] 에끌라 오벌 골드(폴바이스 승자)\n${lines.join("\n")}\n합계 ROAS ${overall}x (손익분기 1.49)\n\n신규 — 해리엇 성산: ${ss}\n신규 — 해리엇 기원: ${kw}\n\n→ 증액 판단 필요. ROAS가 2.5x↑로 안정됐고 일예산 거의 소진이면 단계적 증액(1.5~2배) 검토. 클로드에게 "에끌라 증액 검토"라고 하면 분석+(승인 후)실행.`);
}

const mode = process.argv[2];
(async()=>{
  let code = 0;
  try {
    if (mode === "cut-summer") await cutSummer();
    else if (mode === "recheck-winner") await recheckWinner();
    else { console.log("unknown mode:", mode); code = 1; }
    console.log("done:", mode);
  } catch(e){ console.error("ERR", e); try { await relay(`⚠️ 광고 체크인 오류(${mode}): ${e.message}`); } catch {} code = 1; }
  // 일회성 launchd job 자기제거(연 1회 재발화 방지)
  try {
    const { execSync } = require("child_process");
    const label = mode === "cut-summer" ? "com.paulvice.ad-cut-summer" : "com.paulvice.ad-recheck-winner";
    execSync(`launchctl bootout gui/$(id -u)/${label} 2>/dev/null; rm -f "${process.env.HOME}/Library/LaunchAgents/${label}.plist"`, { stdio:"ignore" });
  } catch {}
  process.exit(code);
})();
