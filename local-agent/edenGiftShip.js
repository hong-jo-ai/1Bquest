/**
 * 에덴마을 보육원 생일선물 택배 — 월요일 아침 자동 송장발급 + 텔레그램 알림 (일회성).
 *
 * 사장님이 후원하는 보육원에 매월 아이들 생일선물 발송. 이번 건은 2026-06-15(월) 발송.
 * launchd com.paulvice.eden-gift 가 월요일 아침 1회 실행 → 실송장 발급 → 텔레그램 통보 →
 * **성공 시 자기 자신(plist+launchd)을 정리**해 재실행 방지(진짜 일회성).
 *
 * 멱등: registerSingle 이 order=EDEN-20260615 로 재접수 차단(중복발급 안 됨).
 */
const fs = require("fs"), path = require("path"), os = require("os");
require("dotenv").config({ path: path.join(__dirname, ".env"), override: true });
const { registerSingle } = require("./postParcel/register");

const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);

const ORDER = {
  order: "EDEN-20260615",
  name: "송수아",
  addr: "서울 구로구 헌왕로 47 에덴마을",
  zip: "08241",
  tel: "02-2611-1057",        // 보육원 일반전화 (수신자 연락처)
  prod: "생일선물",
  qty: "1",
  seller: "후원",              // 채널 라벨
  msg: "에덴마을 보육원 아이들 생일선물",
};

async function tg(msg) {
  await require("./telegramRelay").relayText(msg);
}

// 발급 성공 후 자기 launchd 잡 + plist 제거 (진짜 일회성)
function selfCleanup() {
  try {
    const { execSync } = require("child_process");
    const uid = process.getuid();
    const plist = path.join(os.homedir(), "Library/LaunchAgents/com.paulvice.eden-gift.plist");
    try { execSync(`launchctl bootout gui/${uid} "${plist}"`, { stdio: "ignore" }); } catch {}
    try { fs.unlinkSync(plist); } catch {}
    log("일회성 잡 정리 완료(com.paulvice.eden-gift 제거)");
  } catch (e) { log(`잡 정리 실패(무시): ${e && e.message}`); }
}

(async () => {
  try {
    const r = await registerSingle(ORDER, { reqType: "1", source: "후원" });
    const line = `🎁 에덴마을 보육원 생일선물 택배 접수 완료!\n\n받는 분: 송수아 선생님\n주소: ${ORDER.addr} (${ORDER.zip})\n송장번호: ${r.regiNo}${r.regipoNm ? ` (${r.regipoNm})` : ""}${r.skipped ? " (기존 송장)" : ""}\n\n송장 인쇄해서 선물 발송하시면 됩니다.`;
    log(`✅ 송장 ${r.regiNo}${r.skipped ? " (기존)" : ""}`);
    await tg(line);
    selfCleanup();
  } catch (e) {
    log(`송장발급 실패: ${e && e.message}`);
    await tg(`⚠️ 에덴마을 보육원 생일선물 송장발급 실패: ${(e && e.message || "").slice(0, 160)}\n수동으로 접수해주세요. (월요일 발송 예정)`);
    // 실패 시 잡은 남겨둠(다음날 재시도) — 단 월요일만 발송이라 사장님이 수동처리 가능
    process.exit(1);
  }
})();
