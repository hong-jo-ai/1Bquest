/**
 * W컨셉 매출 동기화 (스케줄/수동 진입점).
 *
 * 2계정 순차 로그인(SMS 인증 — 텔레그램으로 'wc 코드' 전달 필요) → 각 엑셀 다운로드 →
 * 행 단위 합산 → 배포 대시보드 적재(channel=wconcept).
 *
 * 기간: WCONCEPT_SYNC_START_DATE(YYYY-MM-DD) ~ 오늘. 미설정 시 최근 WCONCEPT_SYNC_DAYS(기본90)일.
 * 실행: node runWconceptSync.js   (실행 중 텔레그램으로 인증번호 2개 전달해야 완료됨)
 */
require("dotenv").config({ override: true });
const { syncWconcept } = require("./wconceptSync");

function ymd(d) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

(async () => {
  const now = new Date();
  const end = ymd(now);
  const days = Number(process.env.WCONCEPT_SYNC_DAYS || 90);
  const start = process.env.WCONCEPT_SYNC_START_DATE || ymd(new Date(now.getTime() - days * 86400000));

  const log = (m, t = "info") => console.log(`[${new Date().toISOString()}][${t}] ${m}`);
  log(`W컨셉 매출 동기화 시작: ${start} ~ ${end} (계정 2개, SMS 인증번호 2개 텔레그램 전달 필요)`);

  try {
    const r = await syncWconcept({ startDate: start, endDate: end }, log);
    log(`✅ 완료 — 합산 ${r.combinedRows}행, 적재 ${r.rowCount ?? "?"}건 저장=${r.stored ? "OK" : "?"}`);
  } catch (e) {
    log(`❌ 실패: ${e && e.message ? e.message : e}`, "error");
    process.exitCode = 1;
  }
})();
