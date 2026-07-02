/** 29CM 출고관리 '엑셀 일괄 출고' 클릭 → 모달(전체/선택 주문 다운로드) → 다운로드 → 주소 컬럼 확인. 읽기 전용. */
require("dotenv").config({ override: true });
const fs = require("fs");
const XLSX = require("xlsx");
const { getMarketplacePage, ensureLoggedIn, closeMarketplaceBrowsers } = require("./marketplaceSync");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
const SHIPMENT = "https://partner-order.29cm.co.kr/shipment?filter=TOTAL&orderStartDate=2026-03-01&orderEndDate=2026-06-07&datePeriod=3&page=1&size=100";

(async () => {
  const { page, context } = await getMarketplacePage("29cm", log);
  const dls = [];
  page.on("download", async (d) => { const fp = "/tmp/29cm_bulk_" + dls.length + "_" + d.suggestedFilename(); await d.saveAs(fp).catch(()=>{}); dls.push(fp); log("다운로드: " + fp); });
  context.on("page", (p)=>log("팝업: "+p.url().slice(0,70)));
  await ensureLoggedIn("29cm", page, log);
  await page.goto(SHIPMENT, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(()=>{});
  await sleep(5000);
  await page.locator('button:has-text("검색하기")').first().click({ timeout: 6000 }).catch(()=>{});
  await sleep(5000); await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(()=>{});
  log("출고관리 tbody tr=" + await page.locator('tbody tr').count().catch(()=>0));
  // 전체선택
  const headCb = page.locator('thead .ant-checkbox-wrapper, thead .ant-checkbox, thead label').first();
  if (await headCb.count()) { await headCb.click({ timeout: 4000 }).catch(()=>{}); log("전체선택"); }
  await sleep(800);

  // '엑셀 일괄 출고' 클릭
  const bulk = page.getByRole("button", { name: /엑셀\s*일괄\s*출고/ }).first();
  if (await bulk.count()) { await bulk.click({ timeout: 6000 }).catch(()=>{}); log("'엑셀 일괄 출고' 클릭 → 모달 대기"); await sleep(2500); }
  else log("'엑셀 일괄 출고' 버튼 없음");

  // 모달 내용/버튼 덤프
  const dlg = page.locator('[role=dialog], .modal, .ant-modal').last();
  if (await dlg.count()) {
    const t = (await dlg.innerText().catch(()=>"")).replace(/\s+/g," ").slice(0,400);
    const btns = [...new Set((await dlg.locator("button, a").allInnerTexts().catch(()=>[])).map(b=>b.trim()).filter(Boolean))];
    log("모달 텍스트: " + t);
    log("모달 버튼: " + btns.join(" | "));
    // 전체주문/선택주문 다운로드 클릭
    for (const label of ['전체주문다운로드','전체 주문 다운로드','선택주문다운로드','선택 주문 다운로드','다운로드','양식 다운로드','엑셀 다운로드']) {
      const el = dlg.locator(`xpath=.//*[normalize-space()="${label}"]`).first();
      if (await el.count()) { log("모달에서 '" + label + "' 클릭"); await el.click({ timeout: 6000 }).catch(()=>{}); await sleep(2500); break; }
    }
  } else log("모달 없음");
  await sleep(6000);

  for (const fp of dls) {
    try { const wb = XLSX.read(fs.readFileSync(fp)); const r = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header:1, defval:"" });
      log(`\n${fp} 헤더(${(r[0]||[]).length}):`); (r[0]||[]).forEach((h,i)=>log("  ["+i+"] "+h));
      log("주소컬럼? " + /주소|배송지|연락처|전화|우편/.test((r[0]||[]).join(","))); if(r[1])log("1행: "+JSON.stringify(r[1]).slice(0,900));
    } catch(e){ log("파싱실패 "+e.message.slice(0,40)); }
  }
  if (!dls.length) log("다운로드 없음");
  await sleep(1500);
  await closeMarketplaceBrowsers().catch(() => {});
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
