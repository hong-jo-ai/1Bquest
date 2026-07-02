/** 29CM 출고관리 — '검색하기' 클릭 후 delivery-manage 응답(resultList) 잡아 주소 필드 확인. 읽기 전용. */
require("dotenv").config({ override: true });
const fs = require("fs");
const { getMarketplacePage, ensureLoggedIn, closeMarketplaceBrowsers } = require("./marketplaceSync");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
const SHIPMENT = "https://partner-order.29cm.co.kr/shipment?filter=TOTAL&orderStartDate=2026-03-01&orderEndDate=2026-06-07&datePeriod=3&page=1&size=100";

(async () => {
  const { page } = await getMarketplacePage("29cm", log);
  let best = null;
  page.on("response", async (res) => {
    try {
      const u = res.url();
      if (!/delivery-manage\?/.test(u)) return;
      const b = await res.json().catch(() => null);
      const list = b && b.data && b.data.resultList;
      if (Array.isArray(list) && (!best || list.length > best.length)) { best = list; log(`delivery-manage 응답: totalCount=${b.data.totalCount}, resultList=${list.length}`); }
    } catch {}
  });
  await ensureLoggedIn("29cm", page, log);
  await page.goto(SHIPMENT, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(()=>{});
  await sleep(5000);
  // 검색하기 확실히 클릭
  const search = page.locator('button:has-text("검색하기")').first();
  await search.scrollIntoViewIfNeeded().catch(()=>{});
  await search.click({ timeout: 8000 }).catch((e)=>log("검색 클릭경고 "+e.message.slice(0,40)));
  log("검색하기 클릭");
  await sleep(6000); await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(()=>{});
  await sleep(2000);

  if (best && best.length) {
    log(`\n출고관리 주문 ${best.length}건. 첫 항목 키:`);
    log(Object.keys(best[0]).join(", "));
    const s = JSON.stringify(best[0]);
    log("주소관련 필드 존재? " + /address|주소|배송지|zip|postal|우편|cellphone|phone|receiver/i.test(s));
    log("\n첫 항목:");
    log(JSON.stringify(best[0], null, 1).slice(0, 2500));
    fs.writeFileSync("/tmp/29cm_deliverymanage.json", JSON.stringify(best, null, 2));
    log("→ /tmp/29cm_deliverymanage.json 저장 ("+best.length+"건)");
  } else {
    log("resultList 비어있음 (검색 후에도 0). tbody tr: " + await page.locator("tbody tr").count().catch(()=>0));
  }
  await sleep(1500);
  await closeMarketplaceBrowsers().catch(() => {});
})().catch((e) => { console.error("ERR", e); process.exit(1); });
