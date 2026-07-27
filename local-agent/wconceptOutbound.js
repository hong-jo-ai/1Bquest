/**
 * W컨셉 출고: 결제완료내역(LstShippingOrder) 주문확인(쓰기) → 상품준비중내역(Ready) 전체 추출 → 우체국 행.
 * 결제완료엔 주소가 없어 주문확인으로 Ready 이동 후 주소 확보. 송장 없는 건만(출고대기).
 * 로그인 SMS 필요. 계정1만(필요시 ACCOUNTS 순회 확장).
 */
require("dotenv").config({ override: true });
const os = require("os"), path = require("path"), fs = require("fs");
const { chromium } = require("playwright");
const { loginWconcept, ACCOUNTS } = require("./wconceptSync");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LST = "https://newpin.wconcept.co.kr/Order/LstShippingOrder";       // 결제완료내역
const READY = "https://newpin.wconcept.co.kr/Order/LstShippingOrderReady"; // 상품준비중내역

const clean = (v) => { const s = String(v||"").trim(); return s==="-"?"":s; };
const isMobile = (p) => /^01[016789]/.test(String(p||"").replace(/\D/g,""));
const valid = (p) => isMobile(p) && !/^010-?0+-?0+$/.test(String(p).replace(/\s/g,""));

// 데이터 행 = 결제일자(YYYY-MM-DD HH:MM) 셀을 가진 tr (그리드 컬럼수 무관)
async function dataRows(page) {
  return await page.evaluate(() => {
    const rows = [];
    for (const tr of document.querySelectorAll("tr")) {
      const tds = [...tr.querySelectorAll("td")];
      if (tds.length < 8) continue;
      const cells = tds.map(td => td.innerText.replace(/\s+/g, " ").trim());
      // 결제일자 셀: 날짜만(결제완료내역) 또는 날짜+시각(상품준비중) 모두 인식
      if (cells.some(c => /^\d{4}-\d{2}-\d{2}(\s|$)/.test(c))) rows.push(cells);
    }
    return rows;
  });
}
// Ready 행 → 우체국 (앵커 기반)
function mapReady(cells) {
  const dIdx = cells.findIndex(c => /^\d{4}-\d{2}-\d{2}(\s|$)/.test(c));
  let aIdx = cells.findIndex(c => /\[\d{5}\]/.test(c));
  if (aIdx < 0) aIdx = cells.findIndex(c => /(특별시|광역시|특별자치|[가-힣]+도)\s|[가-힣]+시\s|[가-힣]+군\s/.test(c) && c.length > 12);
  if (dIdx < 0 || aIdx < 0) return null;
  const ph1 = clean(cells[aIdx-2]), ph2 = clean(cells[aIdx-1]);
  const mobile = valid(ph1) ? ph1 : (valid(ph2) ? ph2 : "");
  const tel = (mobile===ph1||mobile===ph2) ? "" : (valid(ph1)?"":(ph1||ph2));
  const addrRaw = clean(cells[aIdx]);
  const zip = (addrRaw.match(/\[(\d{5})\]/) || addrRaw.match(/\b(\d{5})\b/) || [,""])[1];
  const addr = addrRaw.replace(/\[?\b\d{5}\b\]?/, "").trim();
  const 옵션 = [cells[dIdx+6],cells[dIdx+7],cells[dIdx+8]].map(clean).filter(Boolean).join(" ");
  return {
    name: clean(cells[dIdx+3]), mobile, tel,
    addr, zip,
    prod: clean(cells[dIdx+5]) + (옵션?" "+옵션:""),
    qty: clean(cells[dIdx+9]) || "1",
    msg: clean(cells[aIdx+1]),
    order: clean(cells[dIdx+1]),
    invoice: clean(cells[aIdx-3]),
    seller: "W컨셉",
  };
}

async function getWconceptOutboundRows({ doConfirm = true, accounts = ACCOUNTS } = {}, log) {
  const all = [];
  for (const acc of accounts) {
    if (!acc.id || !acc.pw) continue;
    log(`── W컨셉 계정 ${acc.key}(${acc.id}) ──`);
    const rows = await processAccount(acc, doConfirm, log).catch(e => { log(`계정 ${acc.key} 실패: ${e.message}`); return []; });
    all.push(...rows);
  }
  return all;
}

async function processAccount(acc, doConfirm, log) {
  const profileDir = path.join(os.homedir(), ".paulvice-marketplace-agent", `wconcept_${acc.key}`);
  const ctx = await chromium.launchPersistentContext(profileDir, {
    headless: false, channel: "chrome", acceptDownloads: true, locale: "ko-KR", viewport: null,
    args: ["--disable-blink-features=AutomationControlled", "--start-maximized", "--lang=ko-KR"], ignoreDefaultArgs: ["--enable-automation"],
  });
  // JS confirm() 자동 수락
  ctx.on("page", (p) => p.on("dialog", (d) => { log(`DIALOG: ${d.message().slice(0,80)}`); d.accept().catch(()=>{}); }));
  try {
    const page = ctx.pages()[0] || (await ctx.newPage());
    page.on("dialog", (d) => { log(`DIALOG: ${d.message().slice(0,80)}`); d.accept().catch(()=>{}); });
    await page.goto(LST, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(()=>{});
    await sleep(3000);
    if (/Auth\/Login/i.test(page.url())) { const ok = await loginWconcept(ctx, page, acc, log); if (!ok) throw new Error("W컨셉 로그인 실패"); }

    // 로그인 후 뜨는 공지/광고 팝업창은 모두 자동 닫기 (메인 페이지 제외)
    ctx.on("page", (p) => {
      if (p === page) return;
      p.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(()=>{}).then(() => {
        log(`팝업창 닫음: ${p.url().slice(0,60)}`);
        p.close().catch(()=>{});
      });
    });

    // ── 결제완료내역: 주문확인(쓰기) ──
    await page.goto(LST, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(()=>{});
    await sleep(3000);
    await page.locator('button:has-text("1개월"), a:has-text("1개월")').first().click({ timeout: 4000 }).catch(()=>{});
    await page.locator('#btnSearch, button:has-text("조회")').first().click({ timeout: 4000 }).catch(()=>{});
    await sleep(3500); await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(()=>{});
    const lstRows = await dataRows(page);
    log(`결제완료내역 주문 ${lstRows.length}건`);
    if (doConfirm && lstRows.length > 0) {
      // W컨셉 그리드 체크박스 = Semantic UI(_gridCheck / #gridChkAll). 숨은 input이라 일반 클릭 X.
      // 1) 전체선택 컨테이너(.ui.checkbox) 클릭 시도
      await page.locator('div.ui.checkbox:has(#gridChkAll)').first().click({ timeout: 4000 }).catch(()=>{});
      await sleep(600);
      let checked = await page.locator('input._gridCheck:checked').count().catch(()=>0);
      // 2) 행별 .ui.checkbox 컨테이너 클릭
      if (checked === 0) {
        const conts = page.locator('div.ui.checkbox:has(input._gridCheck)');
        const cn = await conts.count().catch(()=>0);
        for (let i = 0; i < cn; i++) await conts.nth(i).click({ timeout: 1500 }).catch(()=>{});
        checked = await page.locator('input._gridCheck:checked').count().catch(()=>0);
      }
      // 3) JS 강제 체크 + change 이벤트 (그리드 핸들러가 :checked 를 읽음)
      if (checked === 0) {
        checked = await page.evaluate(() => {
          const cs = [...document.querySelectorAll('input._gridCheck')];
          cs.forEach(c => { c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); });
          const all = document.querySelector('#gridChkAll'); if (all) { all.checked = true; all.dispatchEvent(new Event('change', { bubbles: true })); }
          return document.querySelectorAll('input._gridCheck:checked').length;
        }).catch(()=>0);
        log("JS 강제 체크 적용");
      }
      log(`선택된 체크박스 ${checked}개`);
      if (checked === 0) {
        log("⚠️ 선택 0 — 체크박스 DOM 진단:");
        const diag = await page.evaluate(() => {
          const inputs = [...document.querySelectorAll('input[type=checkbox]')];
          // 데이터 행의 첫 셀(체크박스 칸) 구조 + 헤더 체크박스 칸
          let rowCell = "", headCell = "", rowFull = "";
          for (const tr of document.querySelectorAll("tr")) {
            const tds = [...tr.querySelectorAll("td")];
            if (tds.length >= 8 && tds.some(td=>/^\d{4}-\d{2}-\d{2}/.test(td.innerText.trim()))) { rowCell = tds[0].outerHTML.slice(0,300); rowFull = tr.outerHTML.slice(0,700); break; }
          }
          const headTr = [...document.querySelectorAll("tr")].find(tr=>[...tr.querySelectorAll("th,td")].some(c=>/수취인/.test(c.innerText)));
          if (headTr) headCell = (headTr.querySelector("th,td")||{}).outerHTML?.slice(0,250) || "";
          const cbInfo = inputs.slice(0,4).map(i=>({ id:i.id, name:i.name, cls:i.className, disabled:i.disabled, onclick:(i.getAttribute("onclick")||"").slice(0,60), parentCls:(i.parentElement&&i.parentElement.className)||"" }));
          // 선택용으로 보이는 클릭 요소(이미지/span/label) 후보
          const clickables = [...document.querySelectorAll('img[onclick], span[onclick], label, a[onclick]')].filter(e=>/check|select|chk|all/i.test((e.getAttribute("onclick")||"")+e.className+e.id)).slice(0,6).map(e=>e.outerHTML.slice(0,90));
          return { totalCheckboxes: inputs.length, cbInfo, rowCell, headCell, clickables, rowFull };
        }).catch(e=>({err:e.message}));
        log("진단: " + JSON.stringify(diag).slice(0, 1800));
      }
      else {
        await page.getByRole("button", { name: "주문확인", exact: true }).first().click({ timeout: 8000 }).catch(async()=>{ await page.locator('button:has-text("주문확인")').first().click({ timeout:6000 }).catch(()=>{}); });
        log("주문확인 클릭(쓰기) — 확인 다이얼로그 자동 수락");
        await sleep(6000); await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(()=>{});
      }
    }

    // ── 상품준비중내역: 전체 추출 ──
    await page.goto(READY, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(()=>{});
    await sleep(3000);
    await page.locator('button:has-text("1개월"), a:has-text("1개월")').first().click({ timeout: 4000 }).catch(()=>{});
    await page.locator('#btnSearch, button:has-text("조회")').first().click({ timeout: 4000 }).catch(()=>{});
    await sleep(3500); await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(()=>{});
    const readyRows = await dataRows(page);
    const out = []; const seen = new Set();
    let total = 0, shipped = 0;
    for (const r of readyRows) {
      const m = mapReady(r);
      if (!m || !m.name) continue;
      total++;
      if (m.invoice) { shipped++; continue; }
      const k = m.order + "|" + m.prod;
      if (seen.has(k)) continue; seen.add(k);
      out.push(m);
    }
    log(`상품준비중내역 매핑 ${total}건 (송장있어 제외 ${shipped}) → 출고대기 ${out.length}건`);
    return out;
  } finally { await sleep(1500); await ctx.close().catch(()=>{}); }
}

module.exports = { getWconceptOutboundRows };

if (require.main === module) {
  const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
  const accounts = process.env.WC_ACCOUNT ? ACCOUNTS.filter(a => a.key === process.env.WC_ACCOUNT) : ACCOUNTS;
  getWconceptOutboundRows({ doConfirm: true, accounts }, log).then(rows => {
    console.log("\n=== W컨셉 우체국 행 ===");
    rows.forEach(r => console.log(JSON.stringify([r.name,r.mobile,r.tel,r.addr,r.zip,r.prod,r.qty,r.msg,r.order,r.seller])));
    const norm = (r)=>({name:r.name,mobile:r.mobile,tel:r.tel,addr:r.addr,zip:r.zip,prod:r.prod,qty:r.qty,msg:r.msg,order:r.order,seller:r.seller});
    const FP = "/tmp/wconcept_po_rows.json";
    // 기존 캐시와 병합(WC_MERGE=1). 단일계정만 돌릴 때 다른 계정분 보존. 주문번호+상품 dedup.
    let merged = rows.map(norm);
    if (process.env.WC_MERGE === "1" && fs.existsSync(FP)) {
      try {
        const prev = JSON.parse(fs.readFileSync(FP, "utf8"));
        const keys = new Set(merged.map(r=>r.order+"|"+r.prod));
        for (const p of prev) if (!keys.has(p.order+"|"+p.prod)) merged.push(p);
        console.log(`기존 캐시 ${prev.length}건과 병합 → ${merged.length}건`);
      } catch {}
    }
    if (merged.length > 0) {
      fs.writeFileSync(FP, JSON.stringify(merged, null, 2));
      console.log("→ "+FP+" 저장 ("+merged.length+"건, 이번 실행 "+rows.length+"건)");
    } else {
      console.log("0건 — 캐시 보존(덮어쓰기 안 함)");
    }
  }).catch(e => { console.error("ERR", e.message); process.exit(1); });
}
