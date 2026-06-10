/**
 * 식스샵 국내(harriotwatches) 결제완료 export를 새로 받아 tmp 디렉터리에 떨어뜨린다.
 * (매출 적재 없이 출고용 export만 갱신 — buildPostOffice.sixshopRows()가 최신 '국내' xlsx를 읽음)
 *
 * 14:30 우체국 2차 접수 전에 식스샵 오후 신규주문을 반영하기 위한 단계.
 * 글로벌/ingest는 17시 sales sync(syncSixshop)가 담당하므로 여기선 생략.
 */
require("dotenv").config({ override: true });
const os = require("os");
const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");
const { loginSixshop, ensureStore, exportOrders } = require("./sixshopSync");

const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);

async function refreshSixshopOutbound() {
  if (!process.env.SIXSHOP_LOGIN_ID || !process.env.SIXSHOP_LOGIN_PASSWORD) {
    throw new Error("식스샵 계정 미설정");
  }
  const profileDir = path.join(os.homedir(), ".paulvice-marketplace-agent", "sixshop");
  fs.mkdirSync(profileDir, { recursive: true });
  const ctx = await chromium.launchPersistentContext(profileDir, {
    headless: false, channel: "chrome", acceptDownloads: true, locale: "ko-KR", viewport: null,
    args: ["--disable-blink-features=AutomationControlled", "--start-maximized", "--lang=ko-KR"],
    ignoreDefaultArgs: ["--enable-automation"],
  });
  ctx.on("page", (p) => p.on("dialog", (d) => d.accept().catch(() => {})));
  try {
    const page = ctx.pages()[0] || (await ctx.newPage());
    page.on("dialog", (d) => d.accept().catch(() => {}));
    if (!(await loginSixshop(page, log))) throw new Error("식스샵 로그인 실패");
    await ensureStore(page, "harriotwatches", log); // 국내 스토어
    const fp = await exportOrders(page, "국내", log);
    log(`식스샵 국내 export 갱신 완료: ${fp}`);
    return fp;
  } finally {
    await ctx.close().catch(() => {});
  }
}

module.exports = { refreshSixshopOutbound };

if (require.main === module) {
  refreshSixshopOutbound()
    .then(() => process.exit(0))
    .catch((e) => { console.error("ERR", e.message); process.exit(1); });
}
