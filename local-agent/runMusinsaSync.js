/**
 * 무신사 매출 무인 동기화 (스케줄/크론 진입점).
 *
 * 로그인(이메일 인증) → 주문조회 검색 → 우클릭 '내보내기' 엑셀 다운로드 →
 * 배포 대시보드(/api/marketplace/sync-ingest)에 파싱+영속 저장.
 * 에이전트 서버(7777) 없이 단독 실행된다.
 *
 * 기간: MUSINSA_SYNC_START_DATE(YYYY-MM-DD) ~ 오늘. 미설정 시 최근 MUSINSA_SYNC_DAYS(기본90)일.
 * 다운로드 파일명이 항상 export.xls 라 매 실행이 해당 채널 데이터를 '교체'(중복 누적 없음).
 *
 * 실행: node runMusinsaSync.js
 */
require("dotenv").config({ override: true });
const { syncMarketplaceSales, closeMarketplaceBrowsers } = require("./marketplaceSync");

function ymd(d) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

(async () => {
  const now = new Date();
  const end = ymd(now);
  const days = Number(process.env.MUSINSA_SYNC_DAYS || 90);
  const start = process.env.MUSINSA_SYNC_START_DATE || ymd(new Date(now.getTime() - days * 86400000));

  const log = (m, t = "info") => console.log(`[${new Date().toISOString()}][${t}] ${m}`);
  log(`무신사 매출 동기화 시작: ${start} ~ ${end}`);

  try {
    const r = await syncMarketplaceSales(
      { channel: "musinsa", startDate: start, endDate: end, ingest: true },
      log
    );
    log(`✅ 완료 — 파일=${r.downloadedFile} 건수=${r.rowCount ?? "?"} 저장=${r.stored ? "OK" : "?"}`);
  } catch (e) {
    log(`❌ 실패: ${e && e.message ? e.message : e}`, "error");
    try { await require("./notifyFail").notifyFail("무신사 주문수집", e && e.message ? e.message : e); } catch (_) {}
    process.exitCode = 1;
  } finally {
    await closeMarketplaceBrowsers().catch(() => {});
  }
})();
