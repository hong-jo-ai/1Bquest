/**
 * 택배 집하 휴무일 게이트.
 *
 * 집배원이 방문하지 않는 날에 우체국 접수를 걸면 송장만 발급되고 물건은 안 나간다.
 * (송장은 살아있는데 집하가 없어 "접수 정상"으로 보이는 조용한 실패 — 출고 누락으로 이어짐)
 * 접수 계열 스크립트 최상단에서 checkOrExit() 로 그날 실행을 막는다.
 *
 * 주말은 launchd 스케줄(Weekday 1~5)에서 이미 빠지므로 여기엔 **평일 휴무만** 적는다.
 *
 * 사용(스크립트 최상단, dotenv/require 직후):
 *   require("./parcelHolidays").checkOrExit("runPostOffice(우체국 접수)");
 */

// 평일인데 택배 집하가 없는 날 (KST, YYYY-MM-DD).
// 법정공휴일과 대체로 겹치지만 택배사 자체 휴무도 있으므로 별도 관리한다.
const NO_PICKUP = new Set([
  "2026-08-17", // 광복절 대체공휴일 — 8/15(토)·16(일) 주말 포함 3일 집하 없음 (2026-08-04 확인)
  "2026-09-24", // 추석 연휴
  "2026-09-25",
  "2026-09-28", // 추석 대체공휴일
  "2026-10-05", // 개천절 대체공휴일
  "2026-10-09", // 한글날
  "2026-12-25", // 성탄절
]);

function todayKST() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }); // YYYY-MM-DD
}

/** 해당 날짜에 택배 집하가 없는지. dateStr 생략 시 오늘(KST). */
function isNoPickupDay(dateStr = todayKST()) {
  return NO_PICKUP.has(dateStr);
}

/**
 * 집하 휴무일이면 로그 남기고 즉시 정상종료(exit 0).
 * fail-safe 아님 — 목록에 없으면 그냥 통과하므로 누락 시 평소대로 접수된다.
 */
function checkOrExit(label = "접수") {
  const today = todayKST();
  if (!isNoPickupDay(today)) return;
  console.log(`[${new Date().toISOString()}] ${label} 스킵 — ${today} 택배 집하 휴무일`);
  process.exit(0);
}

module.exports = { isNoPickupDay, checkOrExit, todayKST, NO_PICKUP };
