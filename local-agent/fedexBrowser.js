/**
 * 페덱스 Billing Online 전용 **상시 Chrome 창**(CDP 9351) — W컨셉·무신사와 같은 방식(wconceptBrowser.js).
 * 창을 켜 두면 로그인 세션이 남아 매번 로그인하지 않아도 된다. 스크립트는 붙었다 떨어지기만 하고 창은 닫지 않는다.
 * 🔴 이 프로필에 launchPersistentContext 를 쓰지 말 것 — 상시 창이 죽는다.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { chromium } = require("playwright");

const PORT = Number(process.env.FEDEX_CDP_PORT || 9351);
const PROFILE = path.join(os.homedir(), ".paulvice-marketplace-agent", "fedex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cdpConnect = () => chromium.connectOverCDP(`http://127.0.0.1:${PORT}`).catch(() => null);

async function openFedex(log = console.log) {
  let browser = await cdpConnect();
  if (browser) log(`페덱스 상시 Chrome 창에 연결 (CDP ${PORT})`);
  else {
    fs.mkdirSync(PROFILE, { recursive: true });
    const mac = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    const child = spawn(fs.existsSync(mac) ? mac : chromium.executablePath(), [
      `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, "--no-first-run", "--no-default-browser-check",
      "--disable-blink-features=AutomationControlled", "--lang=ko-KR", "--window-size=1280,900", "about:blank",
    ], { detached: true, stdio: "ignore" });
    child.unref();
    log(`페덱스 상시 Chrome 창 기동 (CDP ${PORT}) — 스크립트가 끝나도 닫지 않습니다`);
    for (let i = 0; i < 60 && !browser; i++) { await sleep(500); browser = await cdpConnect(); }
    if (!browser) throw new Error(`페덱스 Chrome CDP(${PORT}) 연결 실패`);
  }
  const ctx = browser.contexts()[0] || (await browser.newContext());
  const mine = new Set();
  ctx.on("page", (p) => mine.add(p));
  const page = await ctx.newPage(); // 죽은 탭을 피하려고 항상 새 탭
  mine.add(page);
  const release = async () => { for (const p of mine) await p.close().catch(() => {}); await browser.close().catch(() => {}); };
  return { ctx, page, release };
}
module.exports = { openFedex, PORT };
