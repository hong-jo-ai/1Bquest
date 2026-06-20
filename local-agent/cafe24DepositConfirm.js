/**
 * 카페24 관리자 무통장 입금확인 — 브라우저 자동화(API 입금확인이 422로 막혀서 대안).
 *
 * persistent Chrome 프로필(.paulvice-marketplace-agent/cafe24-admin). 운영자 자동로그인
 * (CAFE24_ADMIN_ID/PW, eclogin.cafe24.com/Shop/, 2FA 없음). 입금전 관리는 **클래식 admin**
 * payment_list.php(payed[]=1) — 주문 행 체크 → '입금확인'(#ePaymentOkBtn) → 확인 다이얼로그.
 *
 * 실행:
 *   node cafe24DepositConfirm.js <주문번호>            ← probe(행/버튼 확인만, 클릭 안 함)
 *   node cafe24DepositConfirm.js <주문번호> --confirm  ← 실제 입금확인 클릭
 */
require("dotenv").config({ override: true });
const os = require("os"), path = require("path"), fs = require("fs");
const { chromium } = require("playwright");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);

const MALL = process.env.CAFE24_MALL_ID || "icaruse2000";
const ADMIN_HOME = `https://${MALL}.cafe24.com/admin/`;
// 입금전 관리(클래식). payed[]=1 = 입금전. 날짜는 주문일 기준 넓게(최근 14일).
function prepaidUrl() {
  const d = (off) => new Date(Date.now() + 9 * 3600e3 - off * 86400e3).toISOString().slice(0, 10);
  const p = new URLSearchParams({
    rows: "100", btnDate: "9999", date_type: "order_date", "payed[]": "1", payed_sql_version: "1",
    memberType: "1", shop_no_order: "1", incoming: "T",
    start_date: d(14), end_date: d(0), start_time: "00:00", end_time: "23:59",
  });
  return `https://${MALL}.cafe24.com/admin/php/shop1/s/payment_list.php?${p.toString()}`;
}

function isLoggedIn(url) {
  if (/eclogin\.cafe24\.com|\/Shop\/Login|member\/login|\/Login/i.test(url)) return false;
  return new RegExp(`${MALL}\\.cafe24\\.com\\/(disp\\/)?admin`, "i").test(url);
}

async function tryAutoLogin(page) {
  const id = process.env.CAFE24_ADMIN_ID, pw = process.env.CAFE24_ADMIN_PW;
  if (!id || !pw) return false;
  try {
    const idEl = page.locator('input[name="loginId"], input#mall_id').first();
    const pwEl = page.locator('input[name="loginPasswd"], input#userpasswd').first();
    await idEl.waitFor({ state: "visible", timeout: 10000 });
    await idEl.fill(id); await pwEl.fill(pw);
    const btn = page.getByRole("button", { name: "로그인", exact: true }).first();
    if (await btn.count()) await btn.click({ timeout: 5000 }).catch(() => {});
    else await pwEl.press("Enter").catch(() => {});
    log("자동 로그인 제출");
    await sleep(7000);
    return true;
  } catch (e) { log("자동 로그인 실패: " + e.message); return false; }
}

async function ensureLoggedIn(page) {
  let autoTried = false;
  for (let i = 0; i < 60; i++) { // 최대 5분
    if (isLoggedIn(page.url())) return true;
    if (/eclogin\.cafe24\.com|\/Shop\/Login|member\/login|\/Login/i.test(page.url())) {
      if (!autoTried) { autoTried = true; await tryAutoLogin(page); continue; }
      if (i <= 1) log("⏳ 로그인 대기(자동 실패 시 창에서 직접 로그인). 최대 5분.");
    }
    await sleep(5000);
  }
  return false;
}

(async () => {
  const orderId = process.argv[2];
  const doConfirm = process.argv.includes("--confirm");
  if (!orderId) { log("사용법: node cafe24DepositConfirm.js <주문번호> [--confirm]"); process.exit(1); }

  const profileDir = path.join(os.homedir(), ".paulvice-marketplace-agent", "cafe24-admin");
  fs.mkdirSync(profileDir, { recursive: true });
  const ctx = await chromium.launchPersistentContext(profileDir, {
    headless: false, channel: "chrome", acceptDownloads: true, locale: "ko-KR", viewport: { width: 1600, height: 1000 },
    args: ["--disable-blink-features=AutomationControlled", "--start-maximized", "--lang=ko-KR"],
    ignoreDefaultArgs: ["--enable-automation"],
  });
  const dialogs = [];
  try {
    const page = ctx.pages()[0] || (await ctx.newPage());
    page.on("dialog", (d) => { dialogs.push(d.message()); log("DIALOG: " + d.message().slice(0, 100)); d.accept().catch(() => {}); });

    await page.goto(ADMIN_HOME, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    await sleep(4000);
    if (!(await ensureLoggedIn(page))) throw new Error("로그인 실패");
    log("✅ 관리자 로그인 확인");

    // 입금전 관리(클래식 payment_list.php) 진입
    await page.goto(prepaidUrl(), { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    await sleep(5000);

    // 주문 행 + 체크박스 확인
    const row = page.locator("tr", { hasText: orderId }).first();
    const rowCount = await row.count().catch(() => 0);
    if (!rowCount) {
      await page.screenshot({ path: "/tmp/cafe24_prepaid.png", fullPage: true }).catch(() => {});
      throw new Error(`입금전 목록에서 주문 ${orderId} 못 찾음(이미 확정됐거나 기간외). 스샷: /tmp/cafe24_prepaid.png`);
    }
    const cb = row.locator('input[type=checkbox]').first();
    log(`주문 ${orderId} 행 발견 (체크박스 ${await cb.count()}개)`);

    if (!doConfirm) {
      log("probe 모드 — 클릭 안 함. --confirm 으로 실제 입금확인.");
      await page.screenshot({ path: "/tmp/cafe24_prepaid.png", fullPage: true }).catch(() => {});
      return;
    }

    // --confirm: 행 체크 → 입금확인
    await cb.check({ timeout: 5000 }).catch(async () => { await cb.click({ timeout: 5000 }).catch(() => {}); });
    log("행 체크 완료 → 입금확인 클릭");
    await page.locator("#ePaymentOkBtn").first().click({ timeout: 8000 })
      .catch(async () => { await page.getByRole("button", { name: "입금확인", exact: true }).first().click({ timeout: 6000 }).catch(() => {}); });
    await sleep(6000); // 확인 다이얼로그 자동수락 + 처리 대기

    // 검증: 목록 새로고침 → 주문이 입금전에서 사라졌는지
    await page.goto(prepaidUrl(), { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    await sleep(4000);
    const still = await page.locator("tr", { hasText: orderId }).count().catch(() => 0);
    await page.screenshot({ path: "/tmp/cafe24_after.png", fullPage: true }).catch(() => {});
    if (still) { log(`⚠️ 주문이 아직 입금전 목록에 있음 — 확인 실패 가능. 다이얼로그: ${dialogs.join(" | ")}`); process.exitCode = 2; }
    else log(`✅ 입금확인 완료 — ${orderId} 입금전 목록에서 사라짐. 다이얼로그: ${dialogs.join(" | ")}`);
  } finally {
    await sleep(1500);
    await ctx.close().catch(() => {});
  }
})().catch((e) => { console.error("ERR", e); process.exit(1); });
