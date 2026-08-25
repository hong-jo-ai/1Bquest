/**
 * 알바 급여 리마인더 — 매월 말일 (2026-08-25 신규).
 *
 * 박자영님 급여는 익월 1일 지급이라 리마인더는 말일에 와야 한다.
 * 정적 문구 대신 kv `alba_attendance_records` 에서 그달 근무시간을 읽어 금액까지 계산한다.
 * (시급 10,320원 — 2026-06/07 지급액 30h=309,600 · 32h=330,240 으로 역산 검증)
 *
 * launchd 는 "말일"을 표현할 수 없어 27~31일 매일 뜨고, 실제 말일에만 발송한다.
 *
 * 사용: node albaPayrollReminder.js [--force]   (--force 는 말일 검사 건너뜀)
 */
const path = require("path");
require("dotenv").config({ override: true });
require("dotenv").config({ path: path.join(__dirname, "..", ".env.local"), override: false });
require("dotenv").config({ path: path.join(__dirname, "..", ".env.supabase"), override: false });
const { createClient } = require(path.join(__dirname, "..", "node_modules/@supabase/supabase-js"));
const { sendTelegram, notifyFail } = require("./notifyFail");

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const HOURLY = 10320;
const FORCE = process.argv.includes("--force");
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);

/** KST 기준 오늘이 이번 달 말일인가. */
function kstToday() {
  return new Date(Date.now() + 9 * 3600 * 1000);
}
function isLastDayOfMonth(d) {
  const next = new Date(d.getTime() + 24 * 3600 * 1000);
  return next.getUTCMonth() !== d.getUTCMonth();
}

(async () => {
  const now = kstToday();
  const ym = now.toISOString().slice(0, 7);
  if (!FORCE && !isLastDayOfMonth(now)) {
    log(`말일 아님(${now.toISOString().slice(0, 10)}) — 스킵`);
    await require("./heartbeat").beat("alba-payroll-reminder", { skipped: true });
    return;
  }

  const { data } = await sb.from("kv_store").select("data").eq("key", "alba_attendance_records").maybeSingle();
  const rec = data?.data || {};
  let hours = 0, days = 0;
  for (const [d, v] of Object.entries(rec)) {
    if (!d.startsWith(ym) || !v.worked) continue;
    hours += v.hours || 0;
    days++;
  }
  const amount = Math.round(hours * HOURLY);

  const body = days
    ? `근무 ${days}일 · ${hours}시간\n시급 ${HOURLY.toLocaleString()}원 × ${hours}h = <b>${amount.toLocaleString()}원</b>`
    : `⚠️ ${ym} 출근기록이 없습니다. 금액을 직접 확인하세요.`;

  await sendTelegram(
    `💰 <b>알바 급여 지급일</b> (${ym} 마감)\n` +
    `박자영님 · 하나은행\n\n${body}\n\n` +
    `내일(1일) 지급 예정입니다. 금액 확인 후 이체하세요.`
  );
  log(`발송 — ${ym}: ${days}일 ${hours}h ${amount.toLocaleString()}원`);
  await require("./heartbeat").beat("alba-payroll-reminder", { ym, days, hours, amount });
})().catch(async (e) => {
  console.error("ERR", e);
  try { await notifyFail("알바 급여 리마인더", e.message || String(e)); } catch (_) {}
  process.exit(1);
});
