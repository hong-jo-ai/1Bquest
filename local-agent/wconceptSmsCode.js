/**
 * macOS Messages(chat.db)에서 W컨셉 SMS 인증번호(6자리)를 추출한다.
 *
 * 텔레그램 릴레이(wconceptSync.js의 'wc 코드' 수동 전달)를 대체하기 위한 자동 추출기.
 * iMac에서 Messages 앱이 SMS를 수신하고 있어야 하며, 실행 프로세스에
 * '전체 디스크 접근 권한'이 있어야 chat.db를 읽을 수 있다.
 *
 * 조건:
 *  - text에 (W컨셉 | 더블유컨셉 | wconcept[대소문자무시]) AND '인증' 포함
 *  - 최근 windowSec초(기본 60초) 이내 메시지
 *  - 가장 최근 1건에서 \b\d{6}\b 로 6자리 추출, 없으면 null
 */
const { DatabaseSync } = require("node:sqlite");
const os = require("os");
const path = require("path");

const CHAT_DB = path.join(os.homedir(), "Library/Messages/chat.db");
const APPLE_EPOCH_OFFSET = 978307200; // 2001-01-01 → unix epoch(초)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 최근 windowSec초 이내 W컨셉 인증 SMS 1건에서 6자리 코드 추출 (없으면 null)
// sinceMs(epoch ms)를 주면 그 시각 이후 도착한 메시지만 인정 — 이전 계정의 코드를 잘못 집는 것 방지.
function readWconceptCode(windowSec = 60, sinceMs = 0) {
  let db;
  try {
    db = new DatabaseSync(CHAT_DB, { readOnly: true });
  } catch (e) {
    // chat.db 열기 실패 = 보통 '전체 디스크 접근 권한(FDA)' 없음. '코드 없음'과 구분되게 1회 경고.
    console.error(`[wconceptSmsCode] chat.db 열기 실패(전체 디스크 접근 권한 확인): ${e && e.message}`);
    return null;
  }
  try {
    // chat.db date = Apple epoch(2001-01-01) 기준 나노초. 값이 2^53을 넘으므로 BigInt로 계산.
    const cutoffUnixMs = Math.max(Date.now() - windowSec * 1000, sinceMs);
    const minDateNs = BigInt(Math.round(cutoffUnixMs - APPLE_EPOCH_OFFSET * 1000)) * 1_000_000n;
    const row = db.prepare(`
      SELECT text FROM message
      WHERE date >= ?
        AND text IS NOT NULL
        AND ( text LIKE '%W컨셉%'
              OR text LIKE '%더블유컨셉%'
              OR lower(text) LIKE '%wconcept%' )
        AND text LIKE '%인증%'
      ORDER BY date DESC
      LIMIT 1
    `).get(minDateNs);
    if (!row || !row.text) return null;
    const m = row.text.match(/\b\d{6}\b/);
    return m ? m[0] : null;
  } catch {
    return null;
  } finally {
    try { db.close(); } catch { /* noop */ }
  }
}

// 코드가 나타날 때까지 폴링: intervalMs 간격으로 최대 timeoutMs 동안 재시도. 성공 시 6자리 반환, 실패 시 null.
async function waitForWconceptCode({ windowSec = 60, intervalMs = 2000, timeoutMs = 30000, sinceMs = 0 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const code = readWconceptCode(windowSec, sinceMs);
    if (code) return code;
    if (Date.now() >= deadline) return null;
    await sleep(intervalMs);
  }
}

module.exports = { readWconceptCode, waitForWconceptCode };

// 단독 실행 시: node wconceptSmsCode.js
if (require.main === module) {
  waitForWconceptCode().then((code) => {
    console.log(code ?? "(코드 없음)");
    process.exit(code ? 0 : 1);
  });
}
