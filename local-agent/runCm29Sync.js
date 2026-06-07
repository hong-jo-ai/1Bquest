/**
 * 29CM 매출 동기화 (스케줄/수동/트리거 진입점).
 * 무신사와 동일 SSO(이메일 인증, plvekorea@gmail.com 자동읽기) → /list 전체 주문 조회 →
 * '엑셀 다운로드'→'받기' → 배포 대시보드 적재(channel=29cm). 완전 무인.
 * 기간: CM29_SYNC_START_DATE ~ 오늘 (29CM 최대 3개월). 미설정 시 최근 CM29_SYNC_DAYS(기본 60)일.
 */
require("dotenv").config({ override: true });
const { syncMarketplaceSales, closeMarketplaceBrowsers } = require("./marketplaceSync");
function ymd(d){ return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10); }
(async () => {
  const now = new Date();
  const end = ymd(now);
  const days = Number(process.env.CM29_SYNC_DAYS || 60);
  const start = process.env.CM29_SYNC_START_DATE || ymd(new Date(now.getTime() - days*86400000));
  const log = (m,t="info") => console.log(`[${new Date().toISOString()}][${t}] ${m}`);
  log(`29CM 매출 동기화 시작: ${start} ~ ${end}`);
  try {
    const r = await syncMarketplaceSales({ channel: "29cm", startDate: start, endDate: end, ingest: true }, log);
    log(`✅ 완료 — 파일=${r.downloadedFile} 건수=${r.rowCount ?? "?"} 저장=${r.stored ? "OK" : "?"}`);
  } catch (e) {
    log(`❌ 실패: ${e && e.message ? e.message : e}`, "error");
    process.exitCode = 1;
  } finally { await closeMarketplaceBrowsers().catch(() => {}); }
})();
