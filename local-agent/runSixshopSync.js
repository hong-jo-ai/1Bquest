/**
 * 식스샵(국내+글로벌) 매출 동기화 진입점 (스케줄/수동/트리거). 완전 무인.
 * 실행: node runSixshopSync.js
 */
require("dotenv").config({ override: true });
const { syncSixshop } = require("./sixshopSync");

(async () => {
  const log = (m, t = "info") => console.log(`[${new Date().toISOString()}][${t}] ${m}`);
  log("식스샵 매출 동기화 시작 (국내 + 글로벌)");
  try {
    const r = await syncSixshop({}, log);
    log(`✅ 완료 — 국내 ${r.sixshop ?? "?"}건 / 글로벌 ${r.sixshop_global ?? "?"}건`);
  } catch (e) {
    log(`❌ 실패: ${e && e.message ? e.message : e}`, "error");
    process.exitCode = 1;
  }
})();
