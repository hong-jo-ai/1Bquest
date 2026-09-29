/**
 * 카페24 관리자 환불완료처리 — cafe24CancelOrder.js 의 다음 단계.
 * 취소접수만 하면 주문이 "취소처리중[환불전]"으로 남고 카드 결제는 취소되지 않는다.
 *
 * 흐름(2026-09-11 수동 검증 경로): 주문상세 → 환불 탭의 '처리 >' 링크
 *   → order_cash_refund_handling.php?manage_id=<환불번호> → '환불완료처리' → 다이얼로그 수락(PG 취소 동반).
 *
 * 실행:
 *   node cafe24RefundComplete.js <주문번호> [--brand harriot]            ← 정찰(환불처리 페이지까지, 버튼 안 누름)
 *   node cafe24RefundComplete.js <주문번호> [--brand harriot] --confirm  ← 실제 환불완료처리
 * 검증은 주문 API 로 canceled:T · 품목 C34 를 따로 확인한다.
 */
require("dotenv").config({ override: true });
const os = require("os"), path = require("path"), fs = require("fs");
const { chromium } = require("playwright");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);

const BRAND = (() => { const i = process.argv.indexOf("--brand"); return (i >= 0 && process.argv[i + 1] === "harriot") ? "harriot" : "paulvice"; })();
const MALL = BRAND === "harriot" ? (process.env.HARRIOT_CAFE24_MALL_ID || "harriotkorea") : (process.env.CAFE24_MALL_ID || "icaruse2000");
const ADMIN_ID = BRAND === "harriot" ? (process.env.HARRIOT_CAFE24_ADMIN_ID || process.env.CAFE24_ADMIN_ID) : process.env.CAFE24_ADMIN_ID;
const ADMIN_PW = BRAND === "harriot" ? (process.env.HARRIOT_CAFE24_ADMIN_PW || process.env.CAFE24_ADMIN_PW) : process.env.CAFE24_ADMIN_PW;
const BASE = `https://${MALL}.cafe24.com`;

function isLoggedIn(url) {
  if (/eclogin\.cafe24\.com|\/Shop\/Login|member\/login|\/Login/i.test(url)) return false;
  return new RegExp(`${MALL}\\.cafe24\\.com\\/(disp\\/)?admin`, "i").test(url);
}

async function ensureLoggedIn(page) {
  let tried = false;
  for (let i = 0; i < 60; i++) {
    if (isLoggedIn(page.url())) return true;
    if (!tried && /eclogin\.cafe24\.com|\/Login/i.test(page.url()) && ADMIN_ID && ADMIN_PW) {
      tried = true;
      try {
        const idEl = page.locator('input[name="loginId"], input#mall_id').first();
        const pwEl = page.locator('input[name="loginPasswd"], input#userpasswd').first();
        await idEl.waitFor({ state: "visible", timeout: 10000 });
        await idEl.fill(ADMIN_ID); await pwEl.fill(ADMIN_PW); await pwEl.press("Enter");
        await sleep(7000); continue;
      } catch (e) { log("자동 로그인 실패: " + e.message); }
    }
    await sleep(5000);
  }
  return false;
}

(async () => {
  const orderId = process.argv[2];
  const doConfirm = process.argv.includes("--confirm");
  if (!/^\d{8}-\d{7}$/.test(orderId || "")) { log("사용법: node cafe24RefundComplete.js <주문번호> [--brand harriot] [--confirm]"); process.exit(1); }

  const profileDir = path.join(os.homedir(), ".paulvice-marketplace-agent", BRAND === "harriot" ? "cafe24-admin-harriot" : "cafe24-admin");
  const ctx = await chromium.launchPersistentContext(profileDir, {
    headless: false, channel: "chrome", locale: "ko-KR", viewport: { width: 1600, height: 1000 },
    args: ["--disable-blink-features=AutomationControlled", "--lang=ko-KR"], ignoreDefaultArgs: ["--enable-automation"],
  });
  const dialogs = [];
  const onDialog = (d) => { dialogs.push(d.message()); log("DIALOG: " + d.message().slice(0, 160)); (doConfirm ? d.accept() : d.dismiss()).catch(() => {}); };
  ctx.on("page", (p) => p.on("dialog", onDialog));
  let code = 1;
  try {
    const page = ctx.pages()[0] || (await ctx.newPage());
    page.on("dialog", onDialog);
    await page.goto(BASE + "/admin/", { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    await sleep(4000);
    if (!(await ensureLoggedIn(page))) throw new Error("로그인 실패");

    await page.goto(`${BASE}/admin/php/shop1/s_new/order_detail.php?order_id=${orderId}`, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    await sleep(5000);
    // '처리 >' 링크는 주문/CS 의 '환불(N건)' 탭 안에 있다 — 탭을 먼저 연다.
    const tab = page.getByText(/^환불\(\d+건\)$/).first();
    if (await tab.count()) { await tab.click({ timeout: 10000 }).catch(() => {}); await sleep(3000); }
    // 모든 프레임에서 manage_id 를 가진 href/onclick 을 찾는다.
    const ids = new Set();
    for (const f of page.frames()) {
      const found = await f.evaluate(() => {
        const out = [];
        document.querySelectorAll("a, button").forEach((el) => {
          const s = (el.getAttribute("href") || "") + " " + (el.getAttribute("onclick") || "");
          const m = s.match(/order_cash_refund_handling\.php\?[^'" ]*manage_id=([A-Za-z0-9-]+)/) || s.match(/manage_id=([A-Za-z0-9-]+)/);
          if (m) out.push(m[1]);
        });
        const html = document.documentElement.innerHTML;
        for (const m of html.matchAll(/order_cash_refund_handling\.php\?[^'" ]*manage_id=([A-Za-z0-9-]+)/g)) out.push(m[1]);
        return out;
      }).catch(() => []);
      found.forEach((x) => ids.add(x));
    }
    // href 가 없으면 '처리 >' 버튼(JS)을 눌러 열리는 창/주소에서 manage_id 를 얻는다.
    if (ids.size === 0) {
      const proc = page.getByText(/^처리\s*>?$/).first();
      if (await proc.count()) {
        const popupP = ctx.waitForEvent("page", { timeout: 15000 }).catch(() => null);
        await proc.click({ timeout: 10000 }).catch(() => {});
        const popup = await popupP;
        await sleep(4000);
        for (const p of [popup, page].filter(Boolean)) {
          const m = p.url().match(/manage_id=([A-Za-z0-9-]+)/);
          if (m) ids.add(m[1]);
        }
        if (popup) await popup.close().catch(() => {});
      }
    }
    log(`환불번호 후보: ${[...ids].join(", ") || "(없음)"}`);
    if (ids.size !== 1) { await page.screenshot({ path: `/tmp/cafe24_refund_${orderId}_detail.png`, fullPage: true }); throw new Error(`환불번호가 1개가 아님(${ids.size}) — 스샷 확인`); }
    const manageId = [...ids][0];

    await page.goto(`${BASE}/admin/php/shop1/s_new/order_cash_refund_handling.php?manage_id=${manageId}`, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    await sleep(4000);
    const bodyText = await page.locator("body").innerText().catch(() => "");
    if (!bodyText.includes(orderId)) log("⚠️ 환불처리 페이지에 주문번호가 안 보임 — 스샷 확인");
    const btn = page.getByText("환불완료처리", { exact: true }).first();
    if (!(await btn.count())) { await page.screenshot({ path: `/tmp/cafe24_refund_${orderId}.png`, fullPage: true }); throw new Error("'환불완료처리' 버튼 없음"); }
    if (!doConfirm) { await page.screenshot({ path: `/tmp/cafe24_refund_${orderId}.png`, fullPage: true }); log(`정찰 완료(manage_id=${manageId}) — --confirm 으로 실행`); code = 0; return; }
    await btn.click({ timeout: 10000 });
    await sleep(8000);
    await page.screenshot({ path: `/tmp/cafe24_refund_${orderId}_after.png`, fullPage: true });
    log(`✅ 환불완료처리 제출(manage_id=${manageId}). 다이얼로그: ${dialogs.join(" | ")}`);
    code = 0;
  } catch (e) {
    log("❌ " + e.message);
  } finally {
    await ctx.close().catch(() => {});
    process.exit(code);
  }
})();
