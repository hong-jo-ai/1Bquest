/**
 * 무신사 일반(국내) 배송 출고 → 우체국 행.
 * 흐름(사장님 지시): 배송출고요청에서 검색 → 목록 왼쪽 체크박스 전부 선택 → '상품준비중 변경'
 *   → 배송출고처리 페이지 검색 → 전체선택 → '택배송장목록받기'(popDeliveryInvDnView 팝업)
 *   → 팝업 '배송목록 받기'(download_dlv_inv) → 엑셀(invoice_list)에서 수령자/우편번호/주소/연락처/상품 파싱.
 * 주소는 결제완료 단계(배송출고요청)에선 '설정안함'이라 상품준비중 변경 후에야 노출 → 준비 단계가 필수(29CM과 동일).
 * seller="무신사" (글로벌과 합산). ⚠️ AG-Grid/iframe/팝업 구조라 셀렉터 민감 — 2026-06-11 2건 실검증.
 */
require("dotenv").config({ override: true });
const fs = require("fs"), path = require("path"), os = require("os"), XLSX = require("xlsx");
const { getMarketplacePage, ensureLoggedIn } = require("./marketplaceSync");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REQ = "https://partner.musinsa.com/order/delivery-request";
const EXP = "https://partner.musinsa.com/order/delivery-export";
const clean = (v) => { const s = String(v ?? "").trim(); return s === "-" ? "" : s; };
const isMobile = (p) => /^01[016789]/.test(String(p || "").replace(/\D/g, ""));
const getFrame = (page) => page.frames().find((f) => /bizest\.musinsa\.com\/po\/.*(delivery|order)/.test(f.url()));

async function ensureMusinsa(page, log) {
  await ensureLoggedIn("musinsa", page, log);
  await page.goto("https://partner.musinsa.com/order/history", { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  await sleep(4000);
  if (/sso|oauth\/login/i.test(page.url())) { log("무신사 재로그인"); await ensureLoggedIn("musinsa", page, log); await sleep(4000); }
  return !/sso|oauth\/login/i.test(page.url());
}

async function loadFrameSearch(page, url, log) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  await sleep(6000); await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
  let f = getFrame(page);
  for (let i = 0; i < 10 && !f; i++) { await sleep(1000); f = getFrame(page); }
  if (!f) return null;
  await f.locator('button:has-text("검색")').filter({ hasNotText: "초기화" }).first().click({ timeout: 6000 }).catch(() => {});
  await sleep(6000);
  return f;
}

async function selectAll(frame) {
  await frame.locator(".ag-header-select-all input, .ag-header-select-all .ag-checkbox-input, .ag-header-select-all").first().click({ timeout: 5000 }).catch(() => {});
  await sleep(1500);
  let sel = await frame.evaluate(() => document.querySelectorAll(".ag-row-selected").length).catch(() => 0);
  if (sel <= 0) {
    const boxes = frame.locator(".ag-pinned-left-cols-container .ag-selection-checkbox, .ag-selection-checkbox");
    const n = await boxes.count().catch(() => 0);
    for (let i = 0; i < n; i++) { await boxes.nth(i).click({ timeout: 3000 }).catch(() => {}); await sleep(250); }
    await sleep(800);
    sel = await frame.evaluate(() => document.querySelectorAll(".ag-row-selected").length).catch(() => 0);
  }
  return sel;
}

function rowsFromExcel(file, log) {
  const wb = XLSX.readFile(file);
  const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
  if (!data.length) return [];
  const head = data[0].map((h) => String(h || "").trim());
  const col = (re) => head.findIndex((h) => re.test(h));
  const ci = {
    serial: col(/주문일련번호/), order: col(/^주문번호/), addr1: col(/주소1|기본주소/), addr2: col(/주소2|상세주소/),
    name: col(/^수령자/), zip: col(/우편번호/), tel: col(/전화번호/), hp: col(/핸드폰|휴대/), opt: col(/^옵션/),
    qty: col(/주문수량|수량/), prod: col(/상품명/), msg: col(/출고메시지|배송메시지|메모/),
  };
  const out = [];
  for (let r = 1; r < data.length; r++) {
    const row = data[r]; if (!row || !row.length) continue;
    const g = (i) => (i >= 0 ? clean(row[i]) : "");
    const name = g(ci.name); if (!name) continue;
    let a2 = g(ci.addr2);
    if (name && a2.endsWith(name)) a2 = a2.slice(0, -name.length).trim();
    const addr = (g(ci.addr1) + " " + a2).replace(/\s+/g, " ").trim();
    const zipRaw = g(ci.zip).replace(/\D/g, "");
    const zip = zipRaw ? zipRaw.padStart(5, "0").slice(0, 5) : "";
    const cand = [g(ci.hp), g(ci.tel)].filter(Boolean);
    const mobile = cand.find(isMobile) || "";
    const tel = cand.find((p) => p && !isMobile(p)) || "";
    const prod = g(ci.prod).replace(/^\[\d+\]\s*/, "").trim();
    const order = g(ci.serial) || g(ci.order);
    if (!addr) { log && log(`  ⚠️ 주소 없음 — 스킵 (${name})`); continue; }
    out.push({ name, mobile, tel, addr, zip, prod, color: g(ci.opt), qty: g(ci.qty) || "1", msg: g(ci.msg), order, seller: "무신사" });
  }
  return out;
}

async function getMusinsaDomesticRows(_opts, log = console.log) {
  const { page, context } = await getMarketplacePage("musinsa", log);
  page.on("dialog", (d) => { log(`  무신사 dialog: ${d.message().replace(/\s+/g, " ").slice(0, 70)}`); d.accept().catch(() => {}); });
  let popup = null, dl = null;
  page.on("download", (d) => { dl = d; });
  context.on("page", (p) => {
    if (p === page) return;
    popup = p; p.on("download", (d) => { dl = d; }); p.on("dialog", (d) => { d.accept().catch(() => {}); });
    p.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {}).then(() => {
      if (!/order|delivery|inv|popup|detail/i.test(p.url())) p.close().catch(() => {});
    });
  });
  if (!(await ensureMusinsa(page, log))) { log("무신사 로그인 실패"); return []; }

  // 1) 배송출고요청: 검색 → 전체선택 → 상품준비중 변경(go_delivery)
  const req = await loadFrameSearch(page, REQ, log);
  if (!req) { log("배송출고요청 iframe 못 찾음"); return []; }
  const reqRows = await req.evaluate(() => document.querySelectorAll(".ag-center-cols-container .ag-row, .ag-row").length).catch(() => 0);
  if (reqRows > 0) {
    const sel = await selectAll(req);
    if (sel > 0) {
      const called = await req.evaluate(() => { try { if (window.app_ord35_grid && app_ord35_grid.go_delivery) { app_ord35_grid.go_delivery(); return true; } } catch (e) {} return false; }).catch(() => false);
      if (!called) await req.locator('button:has-text("상품준비중 변경"), a:has-text("상품준비중 변경")').first().click({ timeout: 6000, force: true }).catch(() => {});
      await sleep(6000); await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
      log(`무신사 일반: ${reqRows}행 상품준비중 변경`);
    } else log("무신사 일반: 배송출고요청 선택 실패 — 준비 건너뜀");
  } else log("무신사 일반: 배송출고요청 신규 0건");

  // 2) 배송출고처리: 검색 → 전체선택 → 택배송장목록받기 팝업 → 배송목록 받기(엑셀)
  const exp = await loadFrameSearch(page, EXP, log);
  if (!exp) { log("배송출고처리 iframe 못 찾음"); return []; }
  const expRows = await exp.evaluate(() => document.querySelectorAll(".ag-center-cols-container .ag-row, .ag-row").length).catch(() => 0);
  if (expRows <= 0) { log("무신사 일반: 배송출고처리 0건"); return []; }
  await selectAll(exp);
  popup = null; dl = null;
  await exp.evaluate(() => { try { popDeliveryInvDnView(); } catch (e) {} }).catch(() => {});
  for (let i = 0; i < 15 && !popup; i++) await sleep(1000);
  if (!popup) { log("무신사 일반: 택배송장목록 팝업 안 뜸"); return []; }
  await popup.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
  await sleep(3000);
  await popup.evaluate(() => { try { app_dlvinv_download.download_dlv_inv(); } catch (e) {} }).catch(() => {});
  for (let i = 0; i < 15 && !dl; i++) await sleep(1000);
  if (!dl) { await popup.locator('button:has-text("배송목록 받기"), a:has-text("배송목록 받기")').first().click({ timeout: 6000 }).catch(() => {}); for (let i = 0; i < 20 && !dl; i++) await sleep(1000); }
  if (!dl) { log("무신사 일반: 엑셀 다운로드 실패"); return []; }
  const dir = path.join(os.tmpdir(), "paulvice-marketplace-downloads"); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${Date.now()}-musinsa-dom-${dl.suggestedFilename()}`);
  await dl.saveAs(file);
  await popup.close().catch(() => {});

  const rows = rowsFromExcel(file, log);
  log(`무신사 일반 우체국 행 ${rows.length}건`);
  rows.forEach((r) => log(`  무신사 ${r.order}: ${r.name} / ${r.mobile || r.tel} / (${r.zip}) ${r.addr.slice(0, 22)}`));
  return rows;
}

module.exports = { getMusinsaDomesticRows, rowsFromExcel };

if (require.main === module) {
  const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
  getMusinsaDomesticRows({}, log).then((rows) => {
    console.log("\n=== 무신사 일반 우체국 행 ===");
    rows.forEach((r) => console.log(JSON.stringify([r.name, r.mobile, r.tel, r.addr, r.zip, r.prod, r.color, r.qty, r.order, r.seller])));
    const { closeMarketplaceBrowsers } = require("./marketplaceSync");
    return closeMarketplaceBrowsers();
  }).catch((e) => { console.error("ERR", e.message); process.exit(1); });
}
