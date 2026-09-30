/**
 * W컨셉 계정별 **상시 Chrome 창**(keep-alive) — 29CM·무신사와 같은 방식.
 *
 * 왜: W컨셉 스크립트만 실행마다 `launchPersistentContext` 로 크롬을 새로 띄웠는데, launchd 실행에서
 * 엑셀 다운로드 순간 **크롬 메인 프로세스가 SIGSEGV 로 죽었다**(9/11~9/30 크래시 리포트 수십 건,
 * 실패 시각과 초 단위 일치). 켜 둔 창에 CDP 로 붙는 29CM·무신사는 같은 시각에도 멀쩡했다.
 * 부수 효과: 창이 살아 있으면 로그인 세션도 살아 있어 **매 실행 SMS 2차 인증이 사라진다**(계정 잠금 위험↓).
 *
 * 계정이 2개라 창도 2개다 — 프로필 `wconcept_1`/`wconcept_2`, CDP 포트 9341/9342.
 * (9335 는 CS 용 공용 프로필 `wconcept` 창이 쓰고, 9336 은 네이버 창이다.)
 *
 * 사용:
 *   const wc = await openWconcept(acc, log);   // { ctx, page, release }
 *   ... wc.page 로 작업 (ctx.pages()[0] 쓰지 말 것 — 다른 실행의 탭일 수 있다)
 *   await wc.release();                         // 이번 실행이 연 탭만 닫고 CDP 연결만 끊는다. 창은 남는다.
 * 🔴 이 프로필로 `launchPersistentContext` 나 `cleanupProfileLock` 을 부르면 상시 창이 죽는다. 새 스크립트도 이걸 쓸 것.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { chromium } = require("playwright");

const PORTS = { "1": 9341, "2": 9342 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profileDirOf = (key) => path.join(os.homedir(), ".paulvice-marketplace-agent", `wconcept_${key}`);
const portOf = (key) => Number(process.env[`WCONCEPT_${key}_CDP_PORT`] || PORTS[key]);
const cdpConnect = (port) => chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => null);

function chromeExecutable() {
  const mac = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  return process.env.MARKETPLACE_CHROME_PATH || (fs.existsSync(mac) ? mac : chromium.executablePath());
}

async function openWconcept(acc, log = console.log) {
  const port = portOf(acc.key);
  const profileDir = profileDirOf(acc.key);
  let browser = await cdpConnect(port);
  if (browser) {
    log(`W컨셉 ${acc.key}번 상시 Chrome 창에 연결 (CDP ${port})`);
  } else {
    fs.mkdirSync(profileDir, { recursive: true });
    // 디버그 포트 없이 이 프로필을 잡고 있는 옛 방식 크롬·유령 락만 치운다(상시 창이 없을 때만 여기 온다).
    require("./marketplaceSync").cleanupProfileLock(profileDir, log);
    const child = spawn(chromeExecutable(), [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-blink-features=AutomationControlled",
      "--lang=ko-KR",
      "--start-maximized",
      "about:blank",
    ], { detached: true, stdio: "ignore" });
    child.unref();
    log(`W컨셉 ${acc.key}번 상시 Chrome 창 기동 (CDP ${port}) — 스크립트가 끝나도 닫지 않습니다`);
    for (let i = 0; i < 60 && !browser; i++) { await sleep(500); browser = await cdpConnect(port); }
    if (!browser) throw new Error(`W컨셉 ${acc.key}번 Chrome CDP(${port}) 연결 실패`);
  }
  const ctx = browser.contexts()[0] || (await browser.newContext());
  // 이번 실행이 여는 탭(인증 팝업 포함)을 모아 두었다가 release 때 그것만 닫는다 —
  // 같은 창을 동시에 쓰는 다른 실행의 탭은 건드리지 않는다.
  const mine = new Set();
  const track = (p) => mine.add(p);
  ctx.on("page", track);
  // 죽은 탭(detached)을 피하려고 **항상 새 탭**에서 시작한다(무신사 9/22 사고와 같은 이유).
  const page = await ctx.newPage();
  mine.add(page);
  await page.setExtraHTTPHeaders({ "Accept-Language": "ko-KR,ko;q=0.9" }).catch(() => {});

  async function release() {
    try {
      ctx.off("page", track);
      const others = ctx.pages().filter((p) => !mine.has(p) && !p.isClosed());
      // 마지막 탭까지 닫으면 창이 사라진다 — 빈 탭 하나는 남긴다.
      if (!others.length) await ctx.newPage().catch(() => {});
      for (const p of mine) {
        await Promise.race([p.close().catch(() => {}), sleep(5000)]);
      }
    } catch { /* 정리 실패는 무시 — 창만 살아 있으면 된다 */ }
    // connectOverCDP 의 browser.close() 는 **연결 해제**다. 크롬 창은 그대로 남는다.
    await browser.close().catch(() => {});
  }

  return { ctx, page, browser, release };
}

module.exports = { openWconcept, PORTS, profileDirOf };
