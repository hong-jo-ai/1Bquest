/** 29CM /list '엑셀 다운로드' 드롭다운의 '전체주문다운로드/선택주문다운로드'(주문단위, 주소 포함 추정) 받아 컬럼 확인. 읽기 전용. */
require("dotenv").config({ override: true });
const fs = require("fs"), path = require("path"), os = require("os");
const XLSX = require("xlsx");
const { getMarketplacePage, ensureLoggedIn, closeMarketplaceBrowsers } = require("./marketplaceSync");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
const LIST = "https://partner-order.29cm.co.kr/list?fromDate=2026-05-01&toDate=2026-06-07&dateConditionType=ORDERED_AT&periodTemplate=31&page=1&size=200";

(async () => {
  const { page } = await getMarketplacePage("29cm", log);
  const dls = [];
  page.on("download", async (d) => { const fp = "/tmp/29cm_order_" + dls.length + "_" + d.suggestedFilename(); await d.saveAs(fp).catch(()=>{}); dls.push(fp); log("다운로드: " + fp); });
  await ensureLoggedIn("29cm", page, log);
  await page.goto(LIST, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(()=>{});
  await sleep(6000); await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(()=>{});

  // '엑셀 다운로드' 드롭다운 열기
  const dd = page.locator('button:has-text("엑셀 다운로드"), button:has-text("엑셀다운로드")').first();
  if (await dd.count()) { await dd.click({ timeout: 6000 }).catch(()=>{}); log("엑셀 다운로드 드롭다운 열기"); await sleep(1500); }
  // 메뉴 항목 텍스트 덤프
  const items = [...new Set((await page.locator('[role=menu] *, .dropdown *, li, button').allInnerTexts().catch(()=>[])).map(t=>t.replace(/\s+/g," ").trim()).filter(t=>/다운로드|받기/.test(t)))];
  log("드롭다운/버튼 항목: " + items.join(" | ").slice(0, 500));

  // '전체주문다운로드' 또는 '주문 다운로드'(상품 아님)의 '받기' 클릭
  // 라벨이 '전체 주문 다운로드' 처럼 '상품'이 없는 주문단위
  const candidates = ['전체주문다운로드', '전체 주문 다운로드', '주문 다운로드', '선택주문다운로드', '선택 주문 다운로드'];
  let clicked = false;
  for (const label of candidates) {
    const get = page.locator(`xpath=//*[normalize-space()="${label}"]/following::button[normalize-space()="받기"][1]`).first();
    if (await get.count()) { log("'" + label + "' 받기 클릭"); await get.click({ timeout: 6000 }).catch(()=>{}); clicked = true; break; }
    const direct = page.locator(`text="${label}"`).first();
    if (await direct.count()) { log("'" + label + "' 직접 클릭"); await direct.click({ timeout: 6000 }).catch(()=>{}); clicked = true; break; }
  }
  if (!clicked) log("주문단위 다운로드 항목 못 찾음 — 위 항목 목록 참고");
  await sleep(2000);
  // 사유 모달
  const reason = page.getByPlaceholder(/사유/).first();
  if (await reason.count()) { await reason.fill("출고 배송정보 확인").catch(()=>{}); log("사유 입력"); await page.locator('button:has-text("확인"), button:has-text("받기")').first().click({ timeout: 5000 }).catch(()=>{}); }
  await sleep(8000);

  for (const fp of dls) {
    try {
      const wb = XLSX.read(fs.readFileSync(fp)); const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header:1, defval:"" });
      log(`\n${fp} 헤더(${(rows[0]||[]).length}):`); (rows[0]||[]).forEach((h,i)=>log("  ["+i+"] "+h));
      log("주소컬럼 존재? " + /주소|배송지|연락처|전화|우편/.test((rows[0]||[]).join(",")));
    } catch(e){ log("파싱실패 "+fp+" "+e.message.slice(0,40)); }
  }
  await sleep(1500);
  await closeMarketplaceBrowsers().catch(() => {});
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
