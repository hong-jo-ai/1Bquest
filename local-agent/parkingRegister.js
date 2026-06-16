/**
 * 사무실 주차 2시간 할인권 자동등록 — 차량번호 4자리 → 로그인 → 검색 → "2시간할인(무료권)" 적용.
 *
 * 사용: node parkingRegister.js 4330         ← 실제 등록
 *       node parkingRegister.js 4330 --dry   ← 조회만(할인 적용 안 함, 현재 할인내역 출력)
 *
 * 반환(콘솔 마지막 줄): RESULT={"ok":true,"carNo":"4330","applied":"2시간할인","already":false}
 */
const { chromium } = require("playwright");
const path = require("path"), os = require("os");
require("dotenv").config({ path: path.join(__dirname, ".env"), override: true });

const BASE = process.env.PARK_URL || "http://220.120.152.199:8090";
const ID = process.env.PARK_ID, PW = process.env.PARK_PW;
const DISCOUNT_BTN = "#cph_body_rptList_btnIns_0";   // "2시간할인(무료권)"
const DISCOUNT_LABEL = "2시간할인";
const log = (m) => console.log(`[park] ${m}`);

const carNo = (process.argv[2] || "").replace(/\D/g, "");
const DRY = process.argv.includes("--dry");

async function readDiscounts(page) {
  // 할인내역 테이블에서 적용된 할인 행 텍스트 수집
  return await page.evaluate(() => {
    const out = [];
    for (const tb of document.querySelectorAll("table")) {
      if (!/할인순서|할인정보/.test(tb.innerText || "")) continue;
      for (const tr of tb.querySelectorAll("tbody tr")) {
        const t = tr.innerText.replace(/\s+/g, " ").trim();
        if (t && !/할인순서/.test(t)) out.push(t);
      }
    }
    return out;
  }).catch(() => []);
}

(async () => {
  if (!ID || !PW) { console.log("RESULT=" + JSON.stringify({ ok: false, error: "PARK_ID/PW 미설정" })); process.exit(1); }
  if (!/^\d{4}$/.test(carNo)) { console.log("RESULT=" + JSON.stringify({ ok: false, error: "차량번호 4자리 숫자 필요" })); process.exit(1); }

  const ctx = await chromium.launchPersistentContext(path.join(os.tmpdir(), "park-agent"), {
    headless: true, channel: "chrome", locale: "ko-KR", viewport: { width: 1280, height: 900 },
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  page.setDefaultTimeout(20000);
  let dialogMsgs = [];
  page.on("dialog", (d) => { dialogMsgs.push(d.message()); log(`DIALOG: ${d.message()}`); d.accept().catch(() => {}); });

  const result = { ok: false, carNo };
  try {
    // 로그인
    await page.goto(`${BASE}/User/Login.aspx`, { waitUntil: "domcontentloaded" });
    await page.fill("#cph_body_userId", ID);
    await page.fill("#cph_body_userPw", PW);
    await Promise.all([page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {}), page.click("#cph_body_btnLogin")]);
    await page.waitForTimeout(1500);

    // 차량 검색
    await page.goto(`${BASE}/Car/Search.aspx`, { waitUntil: "domcontentloaded" }).catch(() => {});
    await page.fill("#cph_body_carNo", carNo);
    await Promise.all([page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {}), page.click("#cph_body_btnSearch")]);
    await page.waitForTimeout(2000);

    if (!/SearchDetail/i.test(page.url())) {
      result.error = `입차차량 없음(검색결과 없음). ${dialogMsgs.join(" / ")}`.trim();
      log(`❌ ${result.error}`);
      console.log("RESULT=" + JSON.stringify(result)); await ctx.close(); process.exit(0);
    }

    const before = await readDiscounts(page);
    const already = before.some((r) => r.includes(DISCOUNT_LABEL));
    log(`현재 할인내역 ${before.length}건${already ? ` (이미 ${DISCOUNT_LABEL} 있음)` : ""}`);
    before.forEach((r) => log(`   · ${r}`));

    if (DRY) {
      result.ok = true; result.dry = true; result.discounts = before; result.already = already;
      log(`[dry] 조회만 — 할인 적용 안 함`);
      console.log("RESULT=" + JSON.stringify(result)); await ctx.close(); process.exit(0);
    }
    if (already) {
      result.ok = true; result.already = true; result.applied = DISCOUNT_LABEL;
      log(`✅ 이미 ${DISCOUNT_LABEL} 적용됨 — 중복 등록 안 함`);
      console.log("RESULT=" + JSON.stringify(result)); await ctx.close(); process.exit(0);
    }

    // 2시간 할인 적용
    log(`"${DISCOUNT_LABEL}(무료권)" 적용 클릭`);
    await Promise.all([page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {}), page.click(DISCOUNT_BTN)]);
    await page.waitForTimeout(2500);

    const after = await readDiscounts(page);
    const ok = after.length > before.length || after.some((r) => r.includes(DISCOUNT_LABEL));
    result.ok = ok; result.applied = ok ? DISCOUNT_LABEL : null; result.discounts = after; result.dialog = dialogMsgs;
    log(ok ? `✅ ${carNo} ${DISCOUNT_LABEL} 등록 완료 (할인내역 ${after.length}건)` : `⚠️ 등록 확인 실패 — 화면 재확인 필요`);
    console.log("RESULT=" + JSON.stringify(result));
  } catch (e) {
    result.error = e && e.message;
    log(`오류: ${result.error}`);
    console.log("RESULT=" + JSON.stringify(result));
  } finally { await ctx.close(); }
})();
