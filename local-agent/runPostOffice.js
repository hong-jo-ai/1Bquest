/**
 * 우체국 발송 실행 (월~금 12:30 1차 + 14:30 2차, launchd com.paulvice.postoffice-outbound[-1430]).
 *
 * 캐시만 읽지 않고 매 실행마다 전 채널을 라이브로 수집한 뒤 접수한다:
 *   1) W컨셉 2계정 로그인 → 주문확인 + Ready 추출 → /tmp/wconcept_po_rows.json 갱신 (wconceptOutbound.js)
 *   2) buildPostOffice.js — 전 채널(카카오선물 제외) 집계 → pp_shipments dedup → 우체국 접수 + 텔레그램/이메일
 * (식스샵 국내 수집은 2026-07-15 폐기: 해리엇 국내=카페24 이전, 식스샵 글로벌=FedEx)
 *
 * 카페24(API)·29CM(브라우저)는 buildPostOffice가 매번 live로 읽으므로 별도 갱신 불필요.
 * 각 단계는 자식 프로세스로 격리 — 갱신 실패해도 등록(3단계)은 항상 시도한다(부분 실패 허용).
 * 멱등: buildPostOffice가 이미 접수된 건(pp_shipments)을 걸러 재접수하지 않으므로
 *       12:30 접수분은 14:30에 재접수되지 않고 그 사이 신규만 접수된다.
 * W컨셉 SMS는 chat.db 자동추출(wconceptSmsCode) → 권한 없으면 텔레그램 'wc 코드' 폴백.
 */
const { execFileSync } = require("child_process");
const path = require("path");

const NODE = process.execPath;
const CWD = __dirname;
const log = (m) => console.log(`[${new Date().toISOString()}] [po] ${m}`);

function run(script, label, env = {}) {
  log(`▶ ${label} 시작 (${script})`);
  try {
    execFileSync(NODE, [path.join(CWD, script)], {
      cwd: CWD,
      stdio: "inherit",
      env: { ...process.env, ...env },
      timeout: 12 * 60 * 1000, // 단계별 12분 상한
    });
    log(`✔ ${label} 완료`);
    return true;
  } catch (e) {
    log(`✗ ${label} 실패(계속 진행): ${e.message.slice(0, 120)}`);
    return false;
  }
}

(async function main() {
  log("=== 우체국 실행 시작 ===");
  const fails = [];
  // 1) W컨셉 2계정 로그인 → 주문확인 + Ready 캐시 갱신 (SMS는 chat.db 자동추출). 실패해도 직전 캐시로 진행
  if (!run("wconceptOutbound.js", "W컨셉 라이브 수집")) fails.push("W컨셉 라이브 수집");
  // 2) 집계 + 우체국 접수 + 텔레그램/이메일 (항상 시도)
  const ok = run("buildPostOffice.js", "우체국 접수/발송");
  if (!ok) fails.push("★우체국 접수/발송(등록) — 배송 누락 위험");
  log(`=== 우체국 실행 종료 (등록 ${ok ? "성공" : "실패"}) ===`);
  if (ok) await require("./heartbeat").beat("postoffice-outbound");
  // 실패 단계가 있으면 텔레그램 경고 (조용한 배송 누락 방지)
  if (fails.length) {
    try { await require("./notifyFail").notifyFail("우체국 발송 파이프라인", `실패 단계: ${fails.join(" / ")}`); } catch (_) {}
  }
  process.exit(ok ? 0 : 1);
})();
