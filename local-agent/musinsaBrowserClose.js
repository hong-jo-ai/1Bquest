/**
 * 무신사 상시 Chrome 창 수동 종료.
 * 평소엔 창을 열어둔 채로 두는 게 정상(로그인 유지). 세션이 꼬였거나 창을 정리하고 싶을 때만 실행.
 *   node musinsaBrowserClose.js
 * 다음 실행 때 창이 새로 뜨고 2차 인증을 다시 거친다.
 */
require("dotenv").config({ override: true });
const { shutdownKeepAliveBrowser } = require("./marketplaceSync");
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
shutdownKeepAliveBrowser(process.argv[2] || "musinsa", log)
  .then((ok) => process.exit(ok ? 0 : 1))
  .catch((e) => { console.error(e.message); process.exit(1); });
