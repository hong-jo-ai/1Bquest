/** 29CM 출고관리 목록에서 주문번호 클릭 → 새 창 상세에서 주소/수령인/상품 구조 확인. 읽기 전용. */
require("dotenv").config({ override: true });
const fs = require("fs");
const { getMarketplacePage, ensureLoggedIn, closeMarketplaceBrowsers } = require("./marketplaceSync");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
const SHIPMENT = "https://partner-order.29cm.co.kr/shipment?filter=TOTAL&orderStartDate=2026-03-01&orderEndDate=2026-06-07&datePeriod=3&page=1&size=100";

(async () => {
  const { page, context } = await getMarketplacePage("29cm", log);
  let popup = null;
  context.on("page", (p) => { popup = p; log("새 창 열림: " + p.url().slice(0, 90)); });
  const apis = [];
  // 새 창의 API도 캡처하기 위해 context 레벨
  context.on("page", (p) => {
    p.on("response", async (res) => { try { const u=res.url(); const ct=res.headers()["content-type"]||""; if(ct.includes("json")&&/29cm/.test(u)&&/order|detail|delivery|receiver|ship/i.test(u)){const b=await res.json().catch(()=>null); if(b)apis.push({u,b});} } catch{} });
  });

  await ensureLoggedIn("29cm", page, log);
  await page.goto(SHIPMENT, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(()=>{});
  await sleep(5000);
  await page.locator('button:has-text("검색하기")').first().click({ timeout: 6000 }).catch(()=>{});
  await sleep(5000); await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(()=>{});

  // 주문번호 링크 (ORD...) 찾기
  const links = page.getByText(/^ORD\d{8}-\d+$/);
  const cnt = await links.count().catch(()=>0);
  log("주문번호 링크 수: " + cnt);
  if (!cnt) { log("주문번호 링크 없음 — tbody tr=" + await page.locator("tbody tr").count().catch(()=>0)); await closeMarketplaceBrowsers().catch(()=>{}); return; }
  const firstNo = (await links.first().innerText().catch(()=>"")).trim();
  log("첫 주문번호 클릭: " + firstNo);
  await links.first().click({ timeout: 6000 }).catch((e)=>log("클릭경고 "+e.message.slice(0,40)));
  await sleep(5000);

  if (!popup) { const ps = context.pages().filter(p=>p!==page); popup = ps[ps.length-1] || null; }
  if (popup) {
    await popup.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(()=>{});
    await sleep(3000);
    const txt = await popup.locator("body").innerText().catch(()=>"");
    log("상세창 URL: " + popup.url());
    log("주소포함? " + /주소|배송지|받는|수령|우편/.test(txt) + " / 길이 " + txt.length);
    fs.writeFileSync("/tmp/29cm_detail.txt", txt);
    // 라벨:값 형태로 보이는 줄 중 주소/연락처/수령 관련
    const lines = txt.split("\n").map(l=>l.trim()).filter(Boolean);
    log("상세창 주요 라인:");
    lines.forEach((l,i)=>{ if(/수령|받는|주소|배송지|연락처|전화|휴대|우편|상품|옵션|수량|주문번호|요청|메모/.test(l)) log("  "+l.slice(0,80)+(lines[i+1]&&lines[i+1].length<60?" → "+lines[i+1]:"")); });
  } else log("새 창을 못 찾음");

  // 상세 API에서 주소 필드
  for (const a of apis) { if(/address|주소|배송지|zipcode|우편|cellphone|receiver/i.test(JSON.stringify(a.b))){ log("[상세 API 주소후보] "+a.u.slice(0,90)); fs.writeFileSync("/tmp/29cm_detail_api.json", JSON.stringify(a.b,null,1).slice(0,60000)); } }
  await sleep(1500);
  await closeMarketplaceBrowsers().catch(() => {});
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
