/** W컨셉 상품준비중내역(Ready) 읽기 전용 추출 — 헤더명→인덱스 매핑으로 우체국 행 생성. 송장번호 빈 건만(출고대기). 쓰기 없음. */
require("dotenv").config({ override: true });
const os = require("os"), path = require("path"), fs = require("fs");
const { chromium } = require("playwright");
const { loginWconcept, ACCOUNTS } = require("./wconceptSync");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
const READY = "https://newpin.wconcept.co.kr/Order/LstShippingOrderReady";

async function extract(page) {
  // 앵커 기반: 결제일자(날짜시각)와 배송지([우편번호]/주소)를 찾아 상대 위치로 매핑.
  // 데이터 행은 td 28개 이상(헤더와 열 어긋남 대응).
  return await page.evaluate(() => {
    const rows = [];
    const sampleCounts = {};
    for (const tr of document.querySelectorAll("tr")) {
      const tds = [...tr.querySelectorAll("td")];
      sampleCounts[tds.length] = (sampleCounts[tds.length] || 0) + 1;
      if (tds.length < 28) continue;
      rows.push(tds.map(td => td.innerText.replace(/\s+/g, " ").trim()));
    }
    return { rows, sampleCounts };
  });
}

function mapRow(cells) {
  const clean = (v) => { const s = String(v||"").trim(); return s==="-"?"":s; };
  // 앞쪽 앵커: 결제일자 (YYYY-MM-DD HH:MM)
  const dIdx = cells.findIndex(c => /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(c));
  // 뒤쪽 앵커: 배송지 ([우편번호] 또는 시/도 포함 긴 주소)
  let aIdx = cells.findIndex(c => /\[\d{5}\]/.test(c));
  if (aIdx < 0) aIdx = cells.findIndex(c => /(특별시|광역시|특별자치|[가-힣]+도)\s|[가-힣]+시\s|[가-힣]+군\s/.test(c) && c.length > 12);
  if (dIdx < 0 || aIdx < 0) return null;
  const 주문번호 = clean(cells[dIdx+1]);
  const 수취인 = clean(cells[dIdx+3]);
  const 상품명 = clean(cells[dIdx+5]);
  const 옵션 = [cells[dIdx+6],cells[dIdx+7],cells[dIdx+8]].map(clean).filter(Boolean).join(" ");
  const 수량 = clean(cells[dIdx+9]) || "1";
  const 송장번호 = clean(cells[aIdx-3]);
  const ph1 = clean(cells[aIdx-2]), ph2 = clean(cells[aIdx-1]);
  const addrRaw = clean(cells[aIdx]);
  const 배송메모 = clean(cells[aIdx+1]);
  const isMobile = (p) => /^01[016789]/.test(String(p||"").replace(/\D/g,""));
  const valid = (p) => isMobile(p) && !/^010-?0+-?0+$/.test(p.replace(/\s/g,""));
  const mobile = valid(ph1) ? ph1 : (valid(ph2) ? ph2 : "");
  const tel = mobile === ph1 ? "" : (mobile === ph2 ? "" : (valid(ph1)?"":ph1 || ph2));
  const zip = (addrRaw.match(/\[(\d{5})\]/) || addrRaw.match(/\b(\d{5})\b/) || [,""])[1];
  const addr = addrRaw.replace(/\[?\b\d{5}\b\]?/, "").trim();
  return { 주문번호, 수취인, 상품명: 상품명 + (옵션?" "+옵션:""), 수량, 송장번호, mobile, tel, addr, zip, 배송메모 };
}

(async () => {
  const acc = ACCOUNTS[0];
  const profileDir = path.join(os.homedir(), ".paulvice-marketplace-agent", `wconcept_${acc.key}`);
  const ctx = await chromium.launchPersistentContext(profileDir, {
    headless: false, channel: "chrome", acceptDownloads: true, locale: "ko-KR", viewport: null,
    args: ["--disable-blink-features=AutomationControlled", "--start-maximized", "--lang=ko-KR"], ignoreDefaultArgs: ["--enable-automation"],
  });
  try {
    const page = ctx.pages()[0] || (await ctx.newPage());
    await page.goto(READY, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(()=>{});
    await sleep(3000);
    if (/Auth\/Login/i.test(page.url())) { const ok = await loginWconcept(ctx, page, acc, log); if (!ok) throw new Error("로그인 실패"); await page.goto(READY, { waitUntil: "domcontentloaded" }); await sleep(3000); }
    await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(()=>{});
    // 1개월 + 조회로 충분히 로드
    await page.locator('button:has-text("1개월"), a:has-text("1개월")').first().click({ timeout: 4000 }).catch(()=>{});
    await page.locator('#btnSearch, button:has-text("조회")').first().click({ timeout: 4000 }).catch(()=>{});
    await sleep(4000); await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(()=>{});

    const { rows, sampleCounts } = await extract(page);
    log("td개수 분포: " + JSON.stringify(sampleCounts));
    log("후보 데이터 행수(td≥28): " + rows.length);

    const out = [];
    let mapped = 0, shipped = 0;
    for (const r of rows) {
      const m = mapRow(r);
      if (!m || !m.수취인) continue;
      mapped++;
      if (m.송장번호) { shipped++; continue; } // 이미 송장 있음 = 출고됨, 제외
      out.push({ name: m.수취인, mobile: m.mobile, tel: m.tel, addr: m.addr, zip: m.zip, prod: m.상품명, qty: m.수량, msg: m.배송메모, order: m.주문번호, seller: "W컨셉" });
    }
    log(`매핑 성공 ${mapped}건 (송장있어 제외 ${shipped}건)`);
    log("\n=== W컨셉 우체국 행 (송장 없는 출고대기) " + out.length + "건 ===");
    out.slice(0, 20).forEach(r => log(JSON.stringify([r.name,r.mobile,r.tel,r.addr,r.zip,r.prod,r.qty,r.msg,r.order,r.seller])));
    fs.writeFileSync("/tmp/wconcept_po_rows.json", JSON.stringify(out, null, 2));
    log("→ /tmp/wconcept_po_rows.json 저장 (" + out.length + "건)");
  } finally { await sleep(1500); await ctx.close().catch(()=>{}); }
})().catch((e) => { console.error("ERR", e); process.exit(1); });
