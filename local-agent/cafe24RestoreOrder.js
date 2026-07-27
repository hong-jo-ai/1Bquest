/**
 * 카페24 관리자 주문 취소복원(취소철회) — 브라우저 자동화.
 * 미입금 자동취소(C48) 주문을 되살릴 때 사용. 취소/클레임 Admin API가 앱 토큰에 없어(404) 브라우저로.
 * 로그인/탐색 패턴은 cafe24CancelOrder.js 와 동일(persistent 프로필 cafe24-admin).
 *
 * 실행:
 *   node cafe24RestoreOrder.js <주문번호>            ← 정찰(복원 버튼 후보 덤프+스샷, 클릭 안 함)
 *   node cafe24RestoreOrder.js <주문번호> --confirm  ← 실제 복원 클릭(+확인 다이얼로그 수락)
 */
require("dotenv").config({ override: true });
const os = require("os"), path = require("path"), fs = require("fs");
const { chromium } = require("playwright");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);

const BRAND = (() => { const i = process.argv.indexOf("--brand"); return (i >= 0 && process.argv[i + 1] === "harriot") ? "harriot" : "paulvice"; })();
const MALL = BRAND === "harriot" ? "harriotkorea" : (process.env.CAFE24_MALL_ID || "icaruse2000");
const ADMIN_ID = BRAND === "harriot" ? (process.env.HARRIOT_CAFE24_ADMIN_ID || process.env.CAFE24_ADMIN_ID) : process.env.CAFE24_ADMIN_ID;
const ADMIN_PW = BRAND === "harriot" ? (process.env.HARRIOT_CAFE24_ADMIN_PW || process.env.CAFE24_ADMIN_PW) : process.env.CAFE24_ADMIN_PW;
const ADMIN_HOME = `https://${MALL}.cafe24.com/admin/`;

function orderListUrl() {
  const d = (off) => new Date(Date.now() + 9 * 3600e3 - off * 86400e3).toISOString().slice(0, 10);
  const p = new URLSearchParams({
    rows: "100", btnDate: "9999", date_type: "order_date", shop_no_order: "1",
    start_date: d(21), end_date: d(0), start_time: "00:00", end_time: "23:59",
  });
  return `https://${MALL}.cafe24.com/admin/php/shop1/s/order_list.php?${p.toString()}`;
}
function isLoggedIn(url) {
  if (/eclogin\.cafe24\.com|\/Shop\/Login|member\/login|\/Login/i.test(url)) return false;
  return new RegExp(`${MALL}\\.cafe24\\.com\\/(disp\\/)?admin`, "i").test(url);
}
async function tryAutoLogin(page) {
  if (!ADMIN_ID || !ADMIN_PW) return false;
  try {
    const idEl = page.locator('input[name="loginId"], input#mall_id').first();
    const pwEl = page.locator('input[name="loginPasswd"], input#userpasswd').first();
    await idEl.waitFor({ state: "visible", timeout: 10000 });
    await idEl.fill(ADMIN_ID); await pwEl.fill(ADMIN_PW);
    const btn = page.getByRole("button", { name: "로그인", exact: true }).first();
    if (await btn.count()) await btn.click({ timeout: 5000 }).catch(() => {});
    else await pwEl.press("Enter").catch(() => {});
    log("자동 로그인 제출"); await sleep(7000); return true;
  } catch (e) { log("자동 로그인 실패: " + e.message); return false; }
}
async function ensureLoggedIn(page) {
  let tried = false;
  for (let i = 0; i < 60; i++) {
    if (isLoggedIn(page.url())) return true;
    if (/eclogin\.cafe24\.com|\/Shop\/Login|member\/login|\/Login/i.test(page.url())) {
      if (!tried) { tried = true; await tryAutoLogin(page); continue; }
    }
    await sleep(5000);
  }
  return false;
}

(async () => {
  const orderId = process.argv[2];
  const doConfirm = process.argv.includes("--confirm");
  if (!orderId) { log("사용법: node cafe24RestoreOrder.js <주문번호> [--confirm]"); process.exit(1); }

  const profileDir = path.join(os.homedir(), ".paulvice-marketplace-agent", BRAND === "harriot" ? "cafe24-admin-harriot" : "cafe24-admin");
  fs.mkdirSync(profileDir, { recursive: true });
  const ctx = await chromium.launchPersistentContext(profileDir, {
    headless: false, channel: "chrome", acceptDownloads: true, locale: "ko-KR", viewport: { width: 1600, height: 1000 },
    args: ["--disable-blink-features=AutomationControlled", "--start-maximized", "--lang=ko-KR"],
    ignoreDefaultArgs: ["--enable-automation"],
  });
  const dialogs = [];
  const handleDialog = (d) => {
    dialogs.push(d.message()); log("DIALOG: " + d.message().slice(0, 160));
    if (doConfirm) d.accept().catch(() => {}); else d.dismiss().catch(() => {});
  };
  ctx.on("page", (p) => p.on("dialog", handleDialog));
  try {
    const page = ctx.pages()[0] || (await ctx.newPage());
    page.on("dialog", handleDialog);
    await page.goto(ADMIN_HOME, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    await sleep(4000);
    if (!(await ensureLoggedIn(page))) throw new Error("로그인 실패");
    log("✅ 관리자 로그인");

    // 주문상세 직접 진입 (목록은 20행 페이지네이션이라 검색이 불안정)
    const detail = page;
    await detail.goto(`https://${MALL}.cafe24.com/admin/php/shop1/s_new/order_detail.php?order_id=${orderId}`, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    await sleep(5000);
    log("상세 URL: " + detail.url());
    const bodyText = await detail.evaluate(() => document.body.innerText.slice(0, 300)).catch(() => "");
    if (!bodyText.includes(orderId) && !detail.url().includes("order_detail")) {
      await detail.screenshot({ path: "/tmp/c24_restore_detail0.png", fullPage: true }).catch(() => {});
      log("⚠️ 상세 페이지 형태가 예상과 다름 — /tmp/c24_restore_detail0.png 확인");
    }

    // 취소 탭으로 전환 — 취소된 품목·복원 버튼은 "취소(N건)" 탭에 있음
    const cancelTab = detail.getByText(/취소\(\d+건\)/).first();
    if (await cancelTab.count().catch(() => 0)) {
      await cancelTab.click({ timeout: 6000 }).catch(() => {});
      await sleep(3000);
      log("취소 탭 전환");
    }

    // 품목 체크(om_no[]) — 복원 대상 선택
    const checked = await detail.evaluate(() => {
      let n = 0;
      document.querySelectorAll('input[name="om_no[]"]').forEach((c) => { if (!c.checked) { c.click(); n++; } });
      return n;
    }).catch(() => 0);
    log(`품목 체크: ${checked}건`);
    await sleep(800);

    // 취소처리 "상세 >" 버튼 → 취소 상세 팝업(철회 버튼이 여기 있음)
    const beforeP = ctx.pages().length;
    // 취소처리 상세 버튼(.eProductCancelDetail) — 클레임 팝업 오픈
    const target = detail.locator("a.eProductCancelDetail").first();
    if (await target.count().catch(() => 0)) {
      await target.click({ timeout: 6000 }).catch(() => {});
      await sleep(4000);
    }
    let work = detail;
    if (ctx.pages().length > beforeP) {
      work = ctx.pages()[ctx.pages().length - 1];
      await work.bringToFront().catch(() => {});
      work.on("dialog", handleDialog);
      await sleep(1500);
      log("팝업 URL: " + work.url());
    } else {
      log("팝업 안 뜸 — 같은 페이지에서 계속");
    }

    // 복원/철회 관련 컨트롤 덤프
    const cands = await work.evaluate(() => {
      const out = [];
      document.querySelectorAll("a, button, input[type=button], input[type=submit]").forEach((el) => {
        const t = (el.textContent || el.value || "").replace(/\s+/g, " ").trim();
        if (/복원|철회|되돌리|취소해제/.test(t)) out.push({ tag: el.tagName, id: el.id, name: el.name || "", text: t.slice(0, 40) });
      });
      return out;
    }).catch(() => []);
    log("복원 후보 컨트롤: " + JSON.stringify(cands));
    // 취소 행 원본 HTML 덤프 (상세 버튼의 onclick 파악용)
    const rowHtml = await work.evaluate(() => {
      const rows = [...document.querySelectorAll("tr")].filter((tr) => tr.innerText && tr.innerText.includes("입금전취소"));
      return rows.map((tr) => tr.innerHTML.replace(/\s+/g, " ").slice(-2000));
    }).catch(() => []);
    log("취소 행 HTML: " + JSON.stringify(rowHtml).slice(0, 2500));
    await work.screenshot({ path: "/tmp/c24_restore_detail.png", fullPage: true }).catch(() => {});
    log("스샷: /tmp/c24_restore_detail.png");

    if (!doConfirm) { log("정찰 종료(클릭 안 함). --confirm 으로 실행."); return; }
    if (!cands.length) throw new Error("복원 버튼을 찾지 못함 — 스샷 확인");

    // 카페24 취소철회 2단계: ① #cancelWithdraw(취소철회) → 품목 체크 → ② #eSubmitCancelWithdarw(철회완료)
    log("① 취소철회 클릭");
    await work.locator("#cancelWithdraw").first().click({ timeout: 8000 });
    await sleep(3000);
    await work.evaluate(() => {
      document.querySelectorAll('input[type="checkbox"]').forEach((c) => { if (!c.checked && !c.disabled) c.click(); });
    }).catch(() => {});
    // 구분(필수) 선택 + 사유 입력
    const selInfo = await work.evaluate(() => {
      const sel = [...document.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.text.includes("선택")));
      if (!sel) return null;
      const opts = [...sel.options].map((o) => o.text.trim());
      // 고객/입금 관련 옵션 우선, 없으면 첫 실옵션
      let idx = [...sel.options].findIndex((o) => /고객|입금|요청/.test(o.text));
      if (idx < 1) idx = 1;
      sel.selectedIndex = idx;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      const ta = document.querySelector("textarea");
      if (ta) { ta.value = "고객 입금 확인(입금자명 상이로 자동매칭 실패) — 주문 복원 처리"; ta.dispatchEvent(new Event("input", { bubbles: true })); }
      return { opts, picked: sel.options[idx].text };
    }).catch(() => null);
    log("구분 선택: " + JSON.stringify(selInfo));
    await sleep(1000);
    await work.screenshot({ path: "/tmp/c24_restore_step1.png", fullPage: true }).catch(() => {});
    log("② 철회완료 클릭");
    await work.locator("#eSubmitCancelWithdarw").first().click({ timeout: 8000 });
    await sleep(6000);
    await work.screenshot({ path: "/tmp/c24_restore_after.png", fullPage: true }).catch(() => {});
    log("완료 스샷: /tmp/c24_restore_after.png · 다이얼로그: " + dialogs.join(" / "));
  } catch (e) {
    log("오류: " + e.message);
    process.exitCode = 1;
  } finally {
    await ctx.close().catch(() => {});
  }
})();
