/**
 * 식스샵(sixshop) 국내 + 글로벌 매출 동기화. 완전 무인(2차 인증 없음).
 *
 * 같은 로그인(info@harriotwatches.com)에서 스토어 전환:
 *  - 국내(harriotwatches) → channel=sixshop
 *  - 글로벌(harriot_global, USD) → channel=sixshop_global (sync-ingest가 USD→원화 환산)
 * 주문 export: '전체 목록 내려받기' 모달 → '결제 금액'(orderPrice, 주문총액) 컬럼 제거(이중계산 방지,
 * 파서가 '상품별 결제 금액'=orderProductPrice 사용) → '내려받기'. 상품별 상세 유지.
 */
const os = require("os");
const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function env(n) { return process.env[n] || ""; }
function base() { return (env("DASHBOARD_URL") || "https://paulvice-dashboard.vercel.app").replace(/\/$/, ""); }
const LOGIN = () => env("SIXSHOP_LOGIN_URL") || "https://www.sixshop.com/member/login";
const ORDERS = () => env("SIXSHOP_ORDERS_URL") || "https://www.sixshop.com/dashboard/shop-orders?status=storage";

async function loginSixshop(page, log) {
  await page.goto(LOGIN(), { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(3000);
  if (await page.locator("#loginEmail").count()) {
    await page.fill("#loginEmail", env("SIXSHOP_LOGIN_ID"));
    await page.fill("#loginPassword", env("SIXSHOP_LOGIN_PASSWORD"));
    await page.locator("button.login_submit").first().click({ timeout: 8000 }).catch(() => {});
    await sleep(6000);
    log("식스샵 로그인 제출");
  }
  await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
  return !/member\/login/.test(page.url());
}

// 계정 메뉴 한 번만 클릭해서 연다 (여러 번 클릭하면 토글되어 닫힘)
async function openAccountMenu(page) {
  await page.locator(".js-memberInfoR, .member-info-row").first().click({ timeout: 5000 }).catch(() => {});
  await sleep(2500);
  return page.getByText("로그아웃", { exact: false }).first().isVisible().catch(() => false);
}

// 지정 스토어로 보장 전환 (이미 해당 스토어면 스킵). 프로필이 마지막 스토어를 기억하므로 매번 명시.
async function ensureStore(page, storeSlug, log) {
  await page.goto("https://www.sixshop.com/dashboard/shop-home", { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(3500);
  if (!(await openAccountMenu(page))) {
    await page.screenshot({ path: "/tmp/sixshop_switchfail.png" }).catch(() => {});
    throw new Error(`식스샵 계정 메뉴 열기 실패 (${storeSlug})`);
  }
  const target = page.locator(`.connected-site-info-list:has-text("${storeSlug}")`).first();
  if (await target.isVisible().catch(() => false)) {
    await target.click({ timeout: 8000 });
    await sleep(6000);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    log(`식스샵 스토어 전환 → ${storeSlug}`);
  } else {
    await page.keyboard.press("Escape").catch(() => {});
    log(`식스샵 이미 ${storeSlug} 스토어 (전환 불필요)`);
  }
}

async function exportOrders(page, label, log) {
  await page.goto(ORDERS(), { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(5000);
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.locator("#orderExportBtn").first().click({ timeout: 10000 });
  await sleep(2500);
  // '결제 금액'(주문총액) 컬럼 제거 → 파서가 '상품별 결제 금액' 사용 (이미 제거됐으면 무시)
  await page.locator('.content-list[data-field-name="orderPrice"] .ico-delete').first().click({ timeout: 4000 }).catch(() => {});
  await sleep(800);
  const dir = path.join(os.tmpdir(), "paulvice-marketplace-downloads");
  fs.mkdirSync(dir, { recursive: true });
  const [dl] = await Promise.all([
    page.waitForEvent("download", { timeout: 120000 }),
    page.locator('button.btn-purple:has-text("내려받기")').first().click({ timeout: 6000 })
      .catch(async () => { await page.getByRole("button", { name: "내려받기" }).last().click({ timeout: 6000 }); }),
  ]);
  const fp = path.join(dir, `${Date.now()}-${label}-${dl.suggestedFilename()}`);
  await dl.saveAs(fp);
  log(`식스샵 ${label} 엑셀 다운로드: ${fp}`);
  return fp;
}

async function ingest(filePath, channel, log) {
  const buffer = fs.readFileSync(filePath);
  const form = new FormData();
  // 채널별 고정 파일명 → 매 실행 교체(중복 누적 없음)
  form.append("file", new Blob([buffer]), `${channel}.xlsx`);
  const res = await fetch(`${base()}/api/marketplace/sync-ingest?channel=${encodeURIComponent(channel)}`, {
    method: "POST", headers: { "x-agent-token": env("PAULWISE_MCP_TOKEN") }, body: form,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) throw new Error(json.error || `적재 실패 (HTTP ${res.status})`);
  log(`${channel} 적재 완료: ${json.rowCount}건 (${json.period?.start}~${json.period?.end})`);
  return json;
}

async function syncSixshop(_opts, log) {
  if (!env("SIXSHOP_LOGIN_ID") || !env("SIXSHOP_LOGIN_PASSWORD")) throw new Error("식스샵 계정 미설정");
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

    // 1) 국내 (harriotwatches) → sixshop  (프로필이 마지막 스토어를 기억하므로 명시적 전환)
    await ensureStore(page, "harriotwatches", log);
    const f1 = await exportOrders(page, "국내", log);
    const r1 = await ingest(f1, "sixshop", log);

    // 2) 글로벌 (harriot_global, USD) → sixshop_global
    await ensureStore(page, env("SIXSHOP_GLOBAL_STORE") || "harriot_global", log);
    const f2 = await exportOrders(page, "글로벌", log);
    const r2 = await ingest(f2, "sixshop_global", log);

    return { success: true, sixshop: r1.rowCount, sixshop_global: r2.rowCount };
  } finally {
    await ctx.close().catch(() => {});
  }
}

module.exports = { syncSixshop, loginSixshop, ensureStore, exportOrders };
