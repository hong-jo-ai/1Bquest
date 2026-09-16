/**
 * 면세점(제드아이티씨) 상환·정산 입금 점검 — 입금일은 **매월 15일**.
 *
 * 왜 필요한가: 2026-09-08 합의로 2025년분 미수 14,795,835 를 분할 상환받는다(18회차, 2028-02 완납).
 * 그런데 점검 알림이 월말(dutyfree930) 하나뿐이라 **15일 입금일 점검이 비어 있었다** —
 * 2026-09-15 에 실제로 안 들어왔는데 시스템이 모르고, 사장님이 뱅킹 앱을 직접 봐야 했다.
 * (그날은 하루 늦은 9/16 13:44 에 들어왔다.)
 *
 * 이제 KB 통장 문자가 자동 적재되므로([[woori-card-sms-finance]]) 통장 데이터로 판정할 수 있다.
 *
 * ⚠️ 매일 돌되 **15일에만 알린다.** 하트비트는 스킵한 날도 매일 찍는다 —
 *    월 1회 잡을 워치독(maxHours 기반, 월간 개념 없음)에 올리면 매일 오탐이 나기 때문.
 *    알바 급여 리마인더가 쓰는 것과 같은 방식이다.
 * ⚠️ 텔레그램은 **relayText 만** 쓴다. 아이맥→api.telegram.org 직결은 자주 ETIMEDOUT 이라
 *    직결로 보내면 알림이 조용히 사라진다(2026-09-16 실측, sftpHealth 가 그래서 이틀 묵었다).
 *
 * 사용: node dutyfreeRepaymentCheck.js           (당일 규칙대로)
 *       node dutyfreeRepaymentCheck.js --force   (날짜 무시하고 지금 상태 출력·발송)
 *       node dutyfreeRepaymentCheck.js --dry     (발송 없이 콘솔만)
 */
const fs = require("fs");
const path = require("path");

const DASH = path.resolve(__dirname, "..");
function le(p) {
  try {
    for (const l of fs.readFileSync(p, "utf8").split("\n")) {
      const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      const v = m[2].trim().replace(/^["']|["']$/g, "");
      if (!(m[1] in process.env)) process.env[m[1]] = v;
    }
  } catch {}
}
le(path.join(DASH, "local-agent/.env"));
le(path.join(DASH, ".env.local"));
le(path.join(DASH, ".env.supabase"));

const { relayText } = require("./telegramRelay");
const { beat } = require("./heartbeat");

const DRY = process.argv.includes("--dry");
const FORCE = process.argv.includes("--force");

/** 합의된 상환 스케줄(2026-09-08 확정). 2027-04 까지 월 50만, 2027-05~2028-02 월 100만. */
function plannedAmount(ym) {
  if (ym < "2026-09") return 0;
  if (ym <= "2027-04") return 500000;
  if (ym <= "2028-02") return 1000000;
  return 0; // 완납 예정 이후
}

function kstParts() {
  const s = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }); // YYYY-MM-DD HH:mm:ss
  return { ymd: s.slice(0, 10), ym: s.slice(0, 7), day: Number(s.slice(8, 10)) };
}

async function deposits(ym) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("SUPABASE 환경변수 없음");
  const from = `${ym}-01`;
  const q =
    `${url}/rest/v1/finance_bank_tx?select=tx_date,counterparty,deposit` +
    `&bank=eq.KB&counterparty=ilike.*제드아이티*&deposit=gt.0&tx_date=gte.${from}&order=tx_date`;
  const r = await fetch(q, { headers: { apikey: key, Authorization: "Bearer " + key } });
  if (!r.ok) throw new Error(`통장 조회 실패 ${r.status}`);
  const rows = await r.json();
  return Array.isArray(rows) ? rows : [];
}

(async () => {
  const { ymd, ym, day } = kstParts();
  // 15일에 알리고, 그날 안 들어왔으면 18일에 한 번 더 본다. 그 외 날은 조용히 하트비트만.
  const isCheckDay = day === 15 || day === 18;
  if (!isCheckDay && !FORCE) {
    await beat("dutyfree-repayment-check", { skipped: true, ymd });
    return;
  }

  const want = plannedAmount(ym);
  let rows = [];
  let err = null;
  try { rows = await deposits(ym); } catch (e) { err = e.message; }

  if (err) {
    await relayText(`⚠️ 면세점 상환 입금 점검 실패 (${ymd})\n\n${err}\n\n통장에서 직접 확인이 필요합니다.`);
    await beat("dutyfree-repayment-check", { ok: false, error: err });
    return;
  }

  const total = rows.reduce((s, r) => s + Number(r.deposit || 0), 0);
  const hit = want > 0 && rows.some((r) => Number(r.deposit) === want);
  const lines = rows.map(
    (r) => `· ${String(r.tx_date).slice(5, 10)} ${Number(r.deposit).toLocaleString()}원`
  );

  // 18일인데 이미 상환분이 확인됐으면 두 번 알리지 않는다.
  if (day === 18 && hit && !FORCE) {
    await beat("dutyfree-repayment-check", { ok: true, ym, hit, total, quiet: true });
    return;
  }

  const head = hit
    ? `✅ 면세점 상환 입금 확인 (${ymd})`
    : `🔴 면세점 상환 입금 미확인 (${ymd})`;
  const body =
    `${head}\n\n` +
    `이번 달 예정 상환액: ${want ? want.toLocaleString() + "원" : "없음(스케줄 밖)"}\n` +
    `이번 달 제드아이티 입금: ${rows.length}건 / 합계 ${total.toLocaleString()}원\n` +
    (lines.length ? lines.join("\n") + "\n" : "입금 없음\n") +
    (hit
      ? `\n예정액과 일치하는 입금이 있습니다. 월 정산금은 별도로 확인하세요.`
      : `\n⚠️ 예정액(${want.toLocaleString()}원)과 일치하는 입금이 없습니다.\n` +
        `2회 불이행이면 잔액 전액 즉시청구 조건이 발동합니다. 재촉 여부를 판단해 주세요.\n` +
        `(이미 문자를 보내셨다면 중복 재촉하지 마세요.)`);

  console.log(body);
  if (!DRY) await relayText(body);
  await beat("dutyfree-repayment-check", { ok: true, ym, hit, total, count: rows.length });
})().catch(async (e) => {
  console.error("ERR", e && e.message);
  try { await relayText(`⚠️ 면세점 상환 입금 점검 오류: ${e && e.message}`); } catch {}
  process.exit(1);
});
