/**
 * 출고 보류 게이트 — 브랜드별로 끊을 수 있다.
 *
 * 보류파일(JSON):
 *   { "scope": "all" | "paulvice" | "harriot", "until": "YYYY-MM-DD" | null }
 *   - until 이 날짜면 그날까지 보류(지나면 자동 해제)
 *   - until 이 **null 이면 수동 해제까지** 계속 보류 (사장님이 "풀어" 할 때까지)
 * 하위호환: 파일에 날짜 문자열만 있으면 예전처럼 { scope:"all", until:그날짜 }.
 *
 * fail-safe: 파일 없음/파싱실패 시 **보류하지 않는다**(출고가 멈추는 쪽이 더 위험).
 *
 * 사용:
 *   require("./shippingHold").checkOrExit("dispatch17");              // 전체 스코프만 막음
 *   require("./shippingHold").checkOrExit("무신사 송장입력", "paulvice"); // 폴바이스 보류면 스킵
 *   require("./shippingHold").isHeldFor("harriot")                    // 채널 루프 안에서 분기
 *
 * 설정: node -e "console.log(require('./shippingHold').setHold({scope:'paulvice'}))"
 * 해제: node -e "console.log(require('./shippingHold').clearHold())"
 */
const fs = require("fs");
const HOLD_FILE = process.env.SHIPPING_HOLD_FILE || "/Users/mac/.paulvice-shipping-hold";

function todayKST() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }); // YYYY-MM-DD
}

/** 보류파일을 읽어 {scope, until} 로 정규화. 없으면 null. */
function readHold() {
  let raw;
  try { raw = fs.readFileSync(HOLD_FILE, "utf8").trim(); } catch { return null; }
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { scope: "all", until: raw }; // 구형식
  try {
    const j = JSON.parse(raw);
    const scope = ["all", "paulvice", "harriot"].includes(j.scope) ? j.scope : "all";
    const until = /^\d{4}-\d{2}-\d{2}$/.test(j.until || "") ? j.until : null;
    return { scope, until };
  } catch { return null; }  // 깨진 파일로 출고를 막지 않는다
}

/** 만료 여부까지 반영한 현재 보류 상태. 해제됐으면 null. */
function activeHold() {
  const h = readHold();
  if (!h) return null;
  if (h.until && todayKST() > h.until) return null; // 날짜 지나면 자동 해제
  return h;
}

/** 특정 브랜드가 보류 중인가. brand 생략 시 "전체 보류"만 본다. */
function isHeldFor(brand) {
  const h = activeHold();
  if (!h) return false;
  if (h.scope === "all") return true;
  return !!brand && h.scope === brand;
}

/** 하위호환 — 전체 보류 여부. */
function isHeld() { return isHeldFor(); }

function describe() {
  const h = activeHold();
  if (!h) return "보류 없음";
  const who = h.scope === "all" ? "전 채널" : h.scope === "paulvice" ? "폴바이스" : "해리엇";
  return `${who} 출고 보류 (${h.until ? `${h.until} 까지` : "수동 해제까지"})`;
}

function checkOrExit(label, brand) {
  if (isHeldFor(brand)) {
    console.log(`[shippingHold] ${label || "job"}: ${describe()} — 스킵`);
    process.exit(0);
  }
}

/** setHold() / setHold("2026-09-05") / setHold({scope:"paulvice"}) */
function setHold(arg) {
  let scope = "all", until = todayKST();
  if (typeof arg === "string") until = arg;
  else if (arg && typeof arg === "object") {
    if (arg.scope) scope = arg.scope;
    until = arg.until === undefined ? null : arg.until; // 객체로 주면 기본이 "수동 해제까지"
  }
  fs.writeFileSync(HOLD_FILE, JSON.stringify({ scope, until }));
  return describe();
}

function clearHold() {
  try { fs.unlinkSync(HOLD_FILE); } catch {}
  return describe();
}

module.exports = { isHeld, isHeldFor, checkOrExit, setHold, clearHold, describe, todayKST, HOLD_FILE };
