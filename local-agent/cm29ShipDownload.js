/** 29CM 출고관리(2건 있음) 엑셀 다운로드 탐색 — 버튼 전체 덤프 → 전체/선택 주문 다운로드 클릭 → 주소 컬럼 확인. 읽기 전용. */
require("dotenv").config({ override: true });
const fs = require("fs");
const XLSX = require("xlsx");
const { getMarketplacePage, ensureLoggedIn, closeMarketplaceBrowsers } = require("./marketplaceSync");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
const SHIPMENT = "https://partner-order.29cm.co.kr/shipment?filter=TOTAL&orderStartDate=2026-03-01&orderEndDate=2026-06-07&datePeriod=3&page=1&size=100";

(async () => {
  const { page } = await getMarketplacePage("29cm", log);
  const dls = [];
  page.on("download", async (d) => { const fp = "/tmp/29cm_ship_dl_" + dls.length + "_" + d.suggestedFilename(); await d.saveAs(fp).catch(()=>{}); dls.push(fp); log("다운로드: " + fp); });
  await ensureLoggedIn("29cm", page, log);
  await page.goto(SHIPMENT, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(()=>{});
  await sleep(5000);
  await page.locator('button:has-text("검색하기")').first().click({ timeout: 6000 }).catch(()=>{});
  await sleep(5000); await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(()=>{});
  log("출고관리 tbody tr=" + await page.locator('tbody tr').count().catch(()=>0));

  // 전체선택 (Ant 체크박스 보이는 것 클릭)
  const headCb = page.locator('thead .ant-checkbox-wrapper, thead .ant-checkbox, thead label').first();
  if (await headCb.count()) { await headCb.click({ timeout: 4000 }).catch(()=>{}); log("전체선택"); }
  await sleep(1000);

  // 모든 버튼/링크 텍스트 덤프
  const all = [...new Set((await page.locator('button, a, [role=button]').allInnerTexts().catch(()=>[])).map(t=>t.replace(/\s+/g," ").trim()).filter(Boolean))];
  log("출고관리 클릭요소 전체: " + all.join(" | ").slice(0, 900));

  // 엑셀 다운로드 계열 클릭 시도 (드롭다운이면 먼저 열기)
  for (const opener of ['엑셀 다운로드','엑셀다운로드','다운로드']) {
    const b = page.getByRole("button", { name: opener, exact: false }).first();
    if (await b.count()) { await b.click({ timeout: 5000 }).catch(()=>{}); log("열기: " + opener); await sleep(1500); break; }
  }
  const items = [...new Set((await page.locator('[role=menuitem], [role=menu] *, li, button, a').allInnerTexts().catch(()=>[])).map(t=>t.replace(/\s+/g," ").trim()).filter(t=>/다운로드/.test(t)))];
  log("다운로드 메뉴 항목: " + items.join(" | ").slice(0, 400));
  for (const label of ['전체주문다운로드','전체 주문 다운로드','선택주문다운로드','선택 주문 다운로드','주문 다운로드','주문정보 다운로드']) {
    const el = page.locator(`xpath=//*[normalize-space()="${label}"]`).first();
    if (await el.count()) { log("'" + label + "' 클릭"); await el.click({ timeout: 6000 }).catch(()=>{}); break; }
  }
  await sleep(2000);
  const reason = page.getByPlaceholder(/사유/).first();
  if (await reason.count() && await reason.isVisible().catch(()=>false)) { await reason.fill("출고 배송정보 확인"); await page.locator('button:has-text("받기"), button:has-text("확인"), button:has-text("다운로드")').first().click({ timeout: 5000 }).catch(()=>{}); log("사유+확인"); }
  await sleep(8000);

  for (const fp of dls) {
    try { const wb = XLSX.read(fs.readFileSync(fp)); const r = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header:1, defval:"" });
      log(`\n${fp} 헤더(${(r[0]||[]).length}):`); (r[0]||[]).forEach((h,i)=>log("  ["+i+"] "+h));
      log("주소컬럼? " + /주소|배송지|연락처|전화|우편/.test((r[0]||[]).join(","))); if(r[1])log("1행: "+JSON.stringify(r[1]).slice(0,900));
    } catch(e){ log("파싱실패 "+e.message.slice(0,40)); }
  }
  if (!dls.length) log("다운로드 발생 안 함 — 위 '클릭요소 전체'에서 정확한 버튼명 확인 필요");
  await sleep(1500);
  await closeMarketplaceBrowsers().catch(() => {});
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
