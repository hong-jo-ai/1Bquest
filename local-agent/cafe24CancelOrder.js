/**
 * 카페24 관리자 주문취소 — 브라우저 자동화(취소/환불 Admin API가 우리 앱 토큰에 없어서 404 → 대안).
 *
 * cafe24DepositConfirm.js 와 동일한 로그인(persistent 프로필 .paulvice-marketplace-agent/cafe24-admin,
 * CAFE24_ADMIN_ID/PW, eclogin, 2FA 없음).
 *
 * 흐름(검증됨): 주문상세 → 품목 체크(om_no[]) → '주문취소'(#eOrderCancel) → 취소처리 페이지
 *   (order_cancel_list.php) → 구분 select[name=cs_type]=사유, #reason 사유텍스트, 환불방법=신용카드 결제취소
 *   → '취소접수'(#eCancelAccept) → 확인 다이얼로그.
 *
 * 취소사유 코드(cs_type): A=고객변심 B=배송지연 J=배송오류 C=배송불가지역 L=수출/통관불가
 *   D=포장불량 E=상품불만족 F=상품정보상이 K=상품불량 G=서비스불만족 H=품절 I=기타
 *
 * 실행:
 *   node cafe24CancelOrder.js <주문번호>                       ← 정찰(취소처리 페이지까지 열고 스샷, 접수 안 함)
 *   node cafe24CancelOrder.js <주문번호> --confirm [--reason A] ← 실제 취소접수(기본 사유 A=고객변심)
 */
require("dotenv").config({ override: true });
const os = require("os"), path = require("path"), fs = require("fs");
const { chromium } = require("playwright");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);

// 멀티몰: --brand harriot 면 해리엇(harriotkorea), 기본 폴바이스(icaruse2000)
const BRAND = (() => { const i = process.argv.indexOf("--brand"); return (i >= 0 && process.argv[i + 1] === "harriot") ? "harriot" : "paulvice"; })();
const MALL = BRAND === "harriot" ? (process.env.HARRIOT_CAFE24_MALL_ID || "harriotkorea") : (process.env.CAFE24_MALL_ID || "icaruse2000");
const ADMIN_ID = BRAND === "harriot" ? (process.env.HARRIOT_CAFE24_ADMIN_ID || process.env.CAFE24_ADMIN_ID) : process.env.CAFE24_ADMIN_ID;
const ADMIN_PW = BRAND === "harriot" ? (process.env.HARRIOT_CAFE24_ADMIN_PW || process.env.CAFE24_ADMIN_PW) : process.env.CAFE24_ADMIN_PW;
const ADMIN_HOME = `https://${MALL}.cafe24.com/admin/`;
const REASON_LABEL = { A: "고객변심", B: "배송지연", J: "배송오류", C: "배송불가지역", L: "수출/통관불가", D: "포장불량", E: "상품불만족", F: "상품정보상이", K: "상품불량", G: "서비스불만족", H: "품절", I: "기타" };

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
  const id = ADMIN_ID, pw = ADMIN_PW;
  if (!id || !pw) return false;
  try {
    const idEl = page.locator('input[name="loginId"], input#mall_id').first();
    const pwEl = page.locator('input[name="loginPasswd"], input#userpasswd').first();
    await idEl.waitFor({ state: "visible", timeout: 10000 });
    await idEl.fill(id); await pwEl.fill(pw);
    const btn = page.getByRole("button", { name: "로그인", exact: true }).first();
    if (await btn.count()) await btn.click({ timeout: 5000 }).catch(() => {});
    else await pwEl.press("Enter").catch(() => {});
    log("자동 로그인 제출"); await sleep(7000); return true;
  } catch (e) { log("자동 로그인 실패: " + e.message); return false; }
}

async function ensureLoggedIn(page) {
  let autoTried = false;
  for (let i = 0; i < 60; i++) {
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
  const ri = process.argv.indexOf("--reason");
  const reasonCode = (ri >= 0 && process.argv[ri + 1]) ? process.argv[ri + 1].toUpperCase() : "A";
  if (!orderId) { log("사용법: node cafe24CancelOrder.js <주문번호> [--confirm] [--reason A]"); process.exit(1); }
  if (!REASON_LABEL[reasonCode]) { log("알 수 없는 사유코드: " + reasonCode); process.exit(1); }

  const profileDir = path.join(os.homedir(), ".paulvice-marketplace-agent", BRAND === "harriot" ? "cafe24-admin-harriot" : "cafe24-admin");
  fs.mkdirSync(profileDir, { recursive: true });
  const ctx = await chromium.launchPersistentContext(profileDir, {
    headless: false, channel: "chrome", acceptDownloads: true, locale: "ko-KR", viewport: { width: 1600, height: 1000 },
    args: ["--disable-blink-features=AutomationControlled", "--start-maximized", "--lang=ko-KR"],
    ignoreDefaultArgs: ["--enable-automation"],
  });
  const dialogs = [];
  const handleDialog = (d) => {
    dialogs.push(d.message()); log("DIALOG: " + d.message().slice(0, 140));
    if (doConfirm) d.accept().catch(() => {}); else d.dismiss().catch(() => {}); // 정찰은 dismiss(실행 차단)
  };
  ctx.on("page", (p) => p.on("dialog", handleDialog));
  try {
    const page = ctx.pages()[0] || (await ctx.newPage());
    page.on("dialog", handleDialog);

    await page.goto(ADMIN_HOME, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    await sleep(4000);
    if (!(await ensureLoggedIn(page))) throw new Error("로그인 실패");
    log("✅ 관리자 로그인 확인");

    // 주문 상세 진입(목록에서 행 찾아 클릭)
    await page.goto(orderListUrl(), { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    await sleep(5000);
    const row = page.locator("tr", { hasText: orderId }).first();
    if (!(await row.count().catch(() => 0))) {
      await page.screenshot({ path: "/tmp/cafe24_orderlist.png", fullPage: true }).catch(() => {});
      throw new Error(`주문목록에서 ${orderId} 못 찾음(기간외?). 스샷 /tmp/cafe24_orderlist.png`);
    }
    const before = ctx.pages().length;
    await row.getByText(orderId, { exact: false }).first().click({ timeout: 6000 }).catch(() => {});
    await sleep(5000);
    let detail = ctx.pages().length > before ? ctx.pages()[ctx.pages().length - 1] : page;
    await detail.bringToFront().catch(() => {});
    await sleep(1500);
    log("상세 URL: " + detail.url());

    // 품목 체크(om_no[]) — 상품명 보이는 행 전부
    const checked = await detail.evaluate(() => {
      let n = 0;
      document.querySelectorAll('input[name="om_no[]"]').forEach((c) => { if (!c.checked) { c.click(); n++; } });
      return n;
    }).catch(() => 0);
    log(`품목 체크: ${checked}건`);
    await sleep(800);

    // '주문취소'(#eOrderCancel) → 취소처리 페이지(order_cancel_list.php) 진입
    const beforeC = ctx.pages().length;
    await detail.locator("#eOrderCancel").first().click({ timeout: 6000 }).catch(() => log("#eOrderCancel 클릭 실패(이미 열렸을 수 있음)"));
    await sleep(4500);
    let cancelPage = ctx.pages().length > beforeC ? ctx.pages()[ctx.pages().length - 1] : detail;
    // 취소처리 페이지가 아니면 직접 이동
    if (!/order_cancel/i.test(cancelPage.url())) {
      await cancelPage.goto(`https://${MALL}.cafe24.com/admin/php/shop1/s_new/order_cancel_list.php?order_id=${orderId}&menu_no=74`, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
      await sleep(4000);
    }
    await cancelPage.bringToFront().catch(() => {});
    log("취소처리 페이지 URL: " + cancelPage.url());

    // 취소사유(구분) 셀렉트 존재 확인
    const hasSelect = await cancelPage.locator('select[name="cs_type"]').count().catch(() => 0);
    if (!hasSelect) {
      await cancelPage.screenshot({ path: "/tmp/cafe24_cancelpage.png", fullPage: true }).catch(() => {});
      throw new Error("취소처리 페이지에서 구분(cs_type) 셀렉트 못 찾음 — 화면 구조 변경. 스샷 /tmp/cafe24_cancelpage.png");
    }

    if (!doConfirm) {
      // 정찰: 취소처리 페이지 품목 체크 → '취소접수'로 폼 펼침 → 구분 select·'확인' 버튼 셀렉터 덤프(확인 안 누름)
      await cancelPage.evaluate(() => {
        document.querySelectorAll('input[type=checkbox]').forEach((c) => { const tr = c.closest("tr"); if (tr && tr.querySelector('input[name="c_quantity[]"]') && !c.checked) c.click(); });
      }).catch(() => {});
      await sleep(600);
      await cancelPage.locator("#eCancelAccept").first().click({ timeout: 6000 }).catch(() => log("#eCancelAccept(취소접수) 클릭 실패"));
      await sleep(3500);
      await cancelPage.screenshot({ path: "/tmp/cafe24_cancelform2.png", fullPage: true }).catch(() => {});
      const probe = await cancelPage.evaluate(() => {
        const vis = (e) => !!(e.offsetParent);
        const cs = document.querySelector('select[name="cs_type"]');
        const confirmBtns = [...document.querySelectorAll("a,button,input[type=button],input[type=submit]")].filter((e) => vis(e) && /^확인$/.test((e.innerText || e.value || "").trim()))
          .map((e) => ({ tag: e.tagName, id: e.id, name: e.name, cls: (e.className || "").slice(0, 30), onclick: (e.getAttribute("onclick") || "").slice(0, 60) }));
        const radio = [...document.querySelectorAll("input[type=radio]")].find((r) => /신용카드\s*결제취소/.test(r.closest("label")?.innerText || r.parentElement?.innerText || ""));
        return { cs_visible: cs ? vis(cs) : null, confirmBtns, cardRadioChecked: radio ? radio.checked : null, cardRadioId: radio?.id, cardRadioName: radio?.name };
      }).catch((e) => "evalfail:" + e.message);
      log("폼 펼친 후 덤프: " + JSON.stringify(probe, null, 1));
      log("정찰 종료 — 스샷 /tmp/cafe24_cancelform2.png. (확인 안 누름)");
      return;
    }

    // ── 실제 취소접수 ──
    // 취소처리 페이지의 주문상품 행 체크박스 선택(취소수량 input 있는 행)
    const cpChecked = await cancelPage.evaluate(() => {
      let n = 0;
      document.querySelectorAll('input[type=checkbox]').forEach((c) => {
        const tr = c.closest("tr");
        if (tr && tr.querySelector('input[name="c_quantity[]"]') && !c.checked) { c.click(); n++; }
      });
      return n;
    }).catch(() => 0);
    log(`취소처리 페이지 품목 체크: ${cpChecked}건`);
    await sleep(500);

    // 1) '취소접수'(#eCancelAccept) → 취소접수 폼(구분·사유·환불) 펼침. (제출 아님)
    await cancelPage.locator("#eCancelAccept").first().click({ timeout: 8000 })
      .catch(async () => { await cancelPage.getByRole("button", { name: "취소접수", exact: true }).first().click({ timeout: 6000 }); });
    await sleep(3500);

    // 2) 구분(cs_type) 사유 설정 — 폼 펼친 뒤 보임. JS 값 설정 + change(fSelect 동기화)
    const setOk = await cancelPage.evaluate((code) => {
      const s = document.querySelector('select[name="cs_type"]');
      if (!s) return false;
      s.value = code;
      s.dispatchEvent(new Event("change", { bubbles: true }));
      return s.value === code;
    }, reasonCode).catch(() => false);
    if (!setOk) throw new Error("구분(cs_type) 사유 설정 실패 — 폼이 안 펼쳐졌을 수 있음");
    log(`구분 사유 선택: ${reasonCode}(${REASON_LABEL[reasonCode]})`);
    await cancelPage.fill("#reason", "고객 요청에 의한 주문 취소 (고객 재주문 예정)").catch(() => {});
    // 환불 방법: '신용카드 결제취소'가 기본 선택(89,570원). 혹시 모르니 보장.
    await cancelPage.evaluate(() => {
      const card = [...document.querySelectorAll('input[type=radio]')].find((r) => /신용카드\s*결제취소/.test(r.closest("label")?.innerText || r.parentElement?.innerText || ""));
      if (card && !card.checked) card.click();
    }).catch(() => {});
    await sleep(500);
    await cancelPage.screenshot({ path: "/tmp/cafe24_before_submit.png", fullPage: true }).catch(() => {});

    // 3) '확인'(#eSubmit) → 실제 취소 제출. 확인 다이얼로그 자동수락(--confirm).
    log("확인(#eSubmit) 클릭 → 실제 취소 제출");
    await cancelPage.locator("#eSubmit").first().click({ timeout: 8000 })
      .catch(async () => { await cancelPage.getByRole("button", { name: "확인", exact: true }).first().click({ timeout: 6000 }); });
    await sleep(9000); // 다이얼로그 수락 + 처리
    await cancelPage.screenshot({ path: "/tmp/cafe24_after_submit.png", fullPage: true }).catch(() => {});
    log(`✅ 취소 제출 완료. 다이얼로그: ${dialogs.filter((d) => !/정보보호/.test(d)).join(" | ") || "(취소 관련 없음)"}. 스샷 /tmp/cafe24_after_submit.png`);
    log("→ API 재조회로 canceled/환불 검증 필요.");
  } finally {
    await sleep(2000);
    await ctx.close().catch(() => {});
  }
})().catch((e) => { console.error("ERR", e); process.exit(1); });
