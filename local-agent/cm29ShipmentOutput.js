/** 29CM 출고관리 읽기 전용 — 검색하기 → 행 확인 → '선택 주문 출력' 캡처해 주소 포함 여부 확인. 쓰기 없음. */
require("dotenv").config({ override: true });
const fs = require("fs");
const { getMarketplacePage, ensureLoggedIn, closeMarketplaceBrowsers } = require("./marketplaceSync");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
const SHIPMENT = "https://partner-order.29cm.co.kr/shipment?filter=TOTAL&orderStartDate=2026-03-07&orderEndDate=2026-06-07&datePeriod=3&page=1&size=100";

(async () => {
  const { page, context } = await getMarketplacePage("29cm", log);
  const caps = [];
  page.on("response", async (res) => { try { const u=res.url(); const ct=res.headers()["content-type"]||""; if(ct.includes("json")&&/29cm\.co\.kr/.test(u)&&/order|ship|delivery|manage/i.test(u)){const b=await res.json().catch(()=>null); if(b)caps.push({u,b});} } catch{} });
  context.on("page", (p) => log("팝업: " + p.url().slice(0,80)));
  const downloads = [];
  page.on("download", async (d) => { const fp="/tmp/29cm_print_"+downloads.length+"_"+d.suggestedFilename(); await d.saveAs(fp).catch(()=>{}); downloads.push(fp); log("다운로드: "+fp); });

  await ensureLoggedIn("29cm", page, log);
  await page.goto(SHIPMENT, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(()=>{});
  await sleep(4000);
  await page.locator('button:has-text("검색하기")').first().click({ timeout: 6000 }).catch((e)=>log("검색 클릭경고 "+e.message.slice(0,40)));
  await sleep(5000); await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(()=>{});

  const rows = await page.locator('tbody input[type=checkbox], tbody .ant-checkbox-input').count().catch(()=>0);
  log("출고관리 행수: " + rows);
  // 목록 API에서 주소 필드 탐색
  for (const c of caps) {
    const s = JSON.stringify(c.b);
    if (/address|주소|배송지|zipcode|우편|cellphone|receiverAddress/i.test(s)) { log("[API 주소후보] " + c.u.slice(0,90)); fs.writeFileSync("/tmp/29cm_ship_api.json", JSON.stringify(c.b,null,1).slice(0,80000)); }
  }
  if (rows > 0) {
    const head = page.locator('thead input[type=checkbox], thead .ant-checkbox-input').first();
    if (await head.count()) await head.check({ timeout: 4000 }).catch(()=>{});
    await sleep(800);
    const printBtn = page.locator('button').filter({ hasText: /선택\s*주문\s*출력|주문\s*출력|송장\s*출력/ }).first();
    if (await printBtn.count()) { log("'주문 출력' 클릭"); await printBtn.click({ timeout: 8000 }).catch((e)=>log("경고 "+e.message.slice(0,40))); await sleep(7000); }
    else log("주문 출력 버튼 없음. 버튼들: " + [...new Set((await page.locator("button").allInnerTexts()).map(b=>b.trim()).filter(Boolean))].join(" | ").slice(0,400));
  }
  // 팝업 텍스트 확인
  for (const p of context.pages()) {
    if (p === page) continue;
    try { await p.waitForLoadState("domcontentloaded",{timeout:6000}).catch(()=>{}); const t=await p.locator("body").innerText().catch(()=>""); const hasAddr=/주소|배송지|\d{5}|(시|도)\s/.test(t); log(`팝업 주소포함=${hasAddr} 길이=${t.length} url=${p.url().slice(0,50)}`); if(t){fs.writeFileSync("/tmp/29cm_print_popup.txt",t); log("일부: "+t.replace(/\s+/g," ").slice(0,500));} } catch{}
  }
  log("다운로드: " + downloads.join(", "));
  await sleep(2000);
  await closeMarketplaceBrowsers().catch(() => {});
})().catch((e) => { console.error("ERR", e); process.exit(1); });
