/**
 * 카카오선물하기 우체국 송장등록 (매일 14시). 김송이 발주서(13~14시 도착) 기준.
 *  김송이 발주서 → 우체국 행 → 우체국 양식 엑셀 + 우체국 API 송장등록(registerRows) + 텔레그램/이메일.
 * 송장등록은 POSTPARCEL_TEST_YN 로 테스트/실접수 제어(기본 Y=테스트).
 */
const fs = require("fs"), path = require("path");
const DASH = "/Users/mac/sungjo_ai/paulwise-dashboard";
function loadEnv(p){ try { for(const line of fs.readFileSync(p,"utf8").split("\n")){const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);if(!m)continue;let v=m[2].trim().replace(/^["']|["']$/g,"");if(!(m[1] in process.env))process.env[m[1]]=v;} } catch {} }
require("dotenv").config({ override: true });
loadEnv(path.join(DASH, ".env.supabase")); loadEnv(path.join(DASH, ".env.local"));
// 집하 휴무일에는 접수하지 않는다 — 송장만 나가고 집배원이 안 와 출고 누락이 된다.
require("./parcelHolidays").checkOrExit("runKakaoGiftPostOffice(카카오선물 접수)");

const XLSX = require(path.join(DASH, "node_modules/xlsx"));
const { getKakaoGiftRows } = require("./kakaoGiftOutbound");
const { sendTelegram, sendEmail, HEADER, mergeByRecipient } = require("./buildPostOffice");
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);

(async () => {
  const today = new Date();
  const date = process.env.PO_DATE || `${today.getFullYear()}${String(today.getMonth()+1).padStart(2,"0")}${String(today.getDate()).padStart(2,"0")}`;

  let rows = [];
  try { rows = await getKakaoGiftRows({}, log); } catch(e){ log("발주서 수집 실패: "+e.message); }
  log(`발주서 ${rows.length}건`);

  // 이미 우체국 접수된 주문 제외 — 새 발주 메일이 없을 때 어제 발주서(newer_than:2d)가
  // 다시 잡혀 "N건" 오보가 나가던 문제 차단. 신규가 0이면 텔레그램/이메일 생략.
  if (rows.length) {
    try {
      const { createClient } = require(path.join(DASH, "node_modules/@supabase/supabase-js"));
      const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
      const { data } = await sb.from("pp_shipments").select("order_number")
        .eq("channel","카카오선물하기").eq("is_test",false).eq("status","submitted").not("regi_no","is",null);
      const done = new Set((data||[]).map(r=>String(r.order_number)));
      const before = rows.length;
      rows = rows.filter(r=>!done.has(String(r.order)));
      if (before !== rows.length) log(`이미 접수된 ${before-rows.length}건 제외(재탕 방지)`);
    } catch(e){ log("pp_shipments 조회 실패 — 재탕 필터 생략: "+e.message); }
  }
  log(`카카오선물하기 출고대기(신규) ${rows.length}건`);
  if (!rows.length) { log("신규 주문 없음 — 종료(텔레그램/이메일 생략)"); return; }

  // 합배송: 동일 수취인의 여러 주문/상품을 송장 1장(엑셀 1행)으로 표시. 접수도 register.js 가 수취인별로 묶음.
  const ex = mergeByRecipient(rows);
  if (ex.length !== rows.length) log(`합배송 병합: ${rows.length}행 → ${ex.length}건(동일 수취인 묶음)`);

  // 우체국 양식 엑셀
  const aoa=[HEADER, ...ex.map(r=>[r.name,r.mobile,r.tel,r.addr,r.zip,r.prod,r.color,r.qty,r.msg,r.order,r.seller])];
  const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(aoa),"sheet1");
  const out=`/tmp/우체국송장양식_카카오선물_${date}_1.xlsx`; XLSX.writeFile(wb,out);
  ex.forEach(r=>console.log(JSON.stringify([r.name,r.mobile,r.tel,r.addr,r.zip,r.prod,r.qty,r.msg,r.order,r.seller])));

  // 우체국 송장등록 (testYn 제어) — 원본(주문별) 행을 넘기면 register.js 가 수취인별로 묶어 접수
  let regMsg = "";
  try {
    const { registerRows } = require("./postParcel/register");
    const r = await registerRows(rows);
    regMsg = `\n📮 우체국 송장등록: 성공 ${r.ok} / 스킵 ${r.skipped} / 실패 ${r.failed} (test=${(process.env.POSTPARCEL_TEST_YN??"Y").toUpperCase()})`;
    log(`송장등록: ok ${r.ok}/skip ${r.skipped}/fail ${r.failed}`);
  } catch(e){ regMsg = `\n📮 우체국 송장등록 실패: ${e.message}`; log("송장등록 실패: "+e.message); }

  const summary = ex.length !== rows.length ? `카카오선물하기 ${ex.length}건(주문 ${rows.length}건 합배송)` : `카카오선물하기 ${rows.length}건`;
  const cap = `🎁 카카오선물하기 우체국 송장등록 (${date})\n${summary}${regMsg}`;
  try { await sendTelegram(out, cap); } catch(e){ log("텔레그램 실패: "+e.message); }
  try { await sendEmail(out, `카카오선물하기 우체국 송장등록 ${date}`, `카카오선물하기 발주서 기준 우체국 송장등록 결과입니다.\n${summary}${regMsg}`); } catch(e){ log("이메일 실패: "+e.message); }
  log("완료");
})().catch(e=>{ console.error("ERR", e); process.exit(1); });
