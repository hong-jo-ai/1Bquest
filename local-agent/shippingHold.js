/**
 * 하루짜리 출고 보류 게이트.
 * 보류파일에 "오늘(KST) 날짜"가 적혀 있으면 해당 스크립트를 즉시 스킵(exit 0).
 * 날짜가 바뀌면 자동 무효화 → 다음날 정상 실행(재활성화 불필요).
 * fail-safe: 파일 없음/읽기오류/파싱실패 시 보류하지 않고 정상 진행.
 *
 * 사용(스크립트 최상단, dotenv/require 직후):
 *   require("./shippingHold").checkOrExit("dispatch17");
 * 보류 설정: node -e "console.log(require('./shippingHold').setHold())"
 * 보류 해제: rm /Users/mac/.paulvice-shipping-hold  (또는 날짜가 바뀌면 자동 해제)
 */
const fs = require("fs");
const HOLD_FILE = process.env.SHIPPING_HOLD_FILE || "/Users/mac/.paulvice-shipping-hold";

function todayKST() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }); // YYYY-MM-DD
}
function isHeld() {
  try {
    // 파일에 적힌 날짜"까지" 보류 (YYYY-MM-DD 문자열비교). 지나면 자동 해제.
    const until = fs.readFileSync(HOLD_FILE, "utf8").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) return false;
    return todayKST() <= until;
  } catch { return false; }
}
function checkOrExit(label) {
  if (isHeld()) {
    console.log(`[shippingHold] ${label || "job"}: 오늘(${todayKST()}) 출고 보류 설정됨 — 스킵`);
    process.exit(0);
  }
}
function setHold(date) {
  const d = date || todayKST();
  fs.writeFileSync(HOLD_FILE, d);
  return d;
}
module.exports = { isHeld, checkOrExit, setHold, todayKST, HOLD_FILE };
