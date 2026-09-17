/**
 * 상시 워커(launchd KeepAlive)가 옛 코드로 계속 도는 것을 막는다.
 *
 * Node 는 한 번 불러온 코드를 다시 읽지 않는다. 그래서 워커 코드를 고쳐도 프로세스를 재시작하기
 * 전까지는 옛 코드가 그대로 돈다. 2026-09-17 실제 사고: CS 액션 워커가 9/11 에 뜬 뒤 재시작이
 * 없었고, 9/15 에 추가한 스마트스토어 상품 Q&A 답변을 모른 채 "inquiryNo 없음"으로 실패했다.
 * 사장님이 인박스에서 쓴 답변이 두 번 다 조용히 안 나갔다.
 *
 * 사용: 루프 맨 위(작업을 잡기 전)에서 exitIfCodeChanged() 를 부른다.
 * 이 워커 폴더(local-agent)에서 불러온 파일 중 하나라도 수정 시각이 바뀌면 종료하고,
 * KeepAlive 가 새 코드로 다시 띄운다. 작업 도중에는 부르지 말 것 — 처리 중인 건이 끊긴다.
 */
const fs = require("fs");
const path = require("path");

function makeCodeReloadCheck(log) {
  const dir = __dirname;
  const seen = new Map(); // 파일 → 처음 본 mtimeMs

  function findChanged() {
    let changed = null;
    for (const f of Object.keys(require.cache)) {
      if (!f.startsWith(dir + path.sep) || f.includes(`${path.sep}node_modules${path.sep}`)) continue;
      let mtime;
      try { mtime = fs.statSync(f).mtimeMs; } catch { continue; }
      const prev = seen.get(f);
      // 나중에 require 된 모듈은 처음 보는 순간을 기준으로 삼는다 — 그 시점엔 최신 코드를 읽었으므로.
      if (prev === undefined) seen.set(f, mtime);
      else if (mtime !== prev && !changed) changed = f;
    }
    return changed;
  }

  findChanged(); // 시작 시점 기준값

  return function exitIfCodeChanged() {
    const f = findChanged();
    if (!f) return;
    log && log(`코드 변경 감지(${path.relative(dir, f)}) → 새 코드로 다시 뜨기 위해 종료합니다(KeepAlive 재기동)`);
    process.exit(75);
  };
}

module.exports = { makeCodeReloadCheck };
