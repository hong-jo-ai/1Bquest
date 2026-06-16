/**
 * 29CM 출고 주소 추출 — 주문번호별 상세창(/detail/{serial})에서 수령인/주소/상품 파싱.
 * 엑셀 다운로드(팝업+비밀번호) 대신 상세창 사용. 읽기 전용.
 *
 * getCm29OutboundRows(opts, log): 출고관리(또는 결제완료) 주문들의 우체국 행 배열 반환.
 *   - 주문 serial 목록: shipment 페이지 표의 주문번호 링크에서 수집(검색 후).
 *   - 각 serial → /detail/{serial} 에서 수령자명/연락처/우편번호/주소/배송메세지/상품 추출.
 */
require("dotenv").config({ override: true });
const { getMarketplacePage, ensureLoggedIn } = require("./marketplaceSync");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function ymd(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
const TODAY = ymd(new Date());
const D90 = ymd(new Date(Date.now() - 90*86400000)); // 29CM 최대 3개월
const SHIPMENT = `https://partner-order.29cm.co.kr/shipment?filter=TOTAL&orderStartDate=${D90}&orderEndDate=${TODAY}&datePeriod=3&page=1&size=200`;

// 결제완료(prepare) 큐 = 아직 배송준비 안 된 주문. 이 단계가 출고관리로 안 넘기면 수집기가 못 봄.
const PREPARE = `https://partner-order.29cm.co.kr/prepare?filter=TOTAL&orderStartDate=${D90}&orderEndDate=${TODAY}&datePeriod=3&isGeneralItem=true&isBookingItem=true&page=1&size=200&sort=createdAt,DESC&isPrepareItem=false`;

// 결제완료 주문을 전부 선택 → '상품준비처리'(쓰기) → 출고관리로 전환. 반환: 전환된 건수.
// dryRun이면 대상 건수만 로깅하고 쓰기 안 함. CM29_PREPARE_MAX(기본 50) 초과 시 안전상 중단.
async function prepareCm29Orders(page, log, { dryRun = false } = {}) {
  await page.goto(PREPARE, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(()=>{});
  await sleep(6000); await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(()=>{});
  const rows = page.locator('tbody tr').filter({ has: page.locator('td') });
  const n = await page.locator('tbody input[type=checkbox]').count().catch(()=>0);
  log(`29CM 상품준비처리 대상(결제완료) ${n}건`);
  if (n === 0) { log("29CM 결제완료 0건 — 준비처리 스킵"); return 0; }
  const CAP = Number(process.env.CM29_PREPARE_MAX || 50);
  if (n > CAP) { log(`⚠️ 준비처리 대상 ${n}건 > 상한 ${CAP} — 안전상 중단(수동 확인 요망)`); return 0; }
  if (dryRun) { log(`[dryRun] ${n}건 준비처리 대상 — 쓰기 생략`); return 0; }

  // 체크박스: 행별 input[type=checkbox]를 직접 클릭해야 React 선택 상태가 켜짐(label/래퍼 클릭은 불안정 — 검증됨)
  for (let i = 0; i < n; i++) {
    const r = rows.nth(i);
    const input = r.locator('input[type=checkbox]').first();
    await input.click({ timeout: 3000 }).catch(async () => { await r.locator('label').first().click({ timeout: 3000 }).catch(()=>{}); });
  }
  await sleep(800);
  let checked = await page.locator('tbody input[type=checkbox]:checked').count().catch(()=>0);
  log(`선택됨 ${checked}/${n}`);
  if (checked === 0) { log("⚠️ 선택 반영 안 됨 — 준비처리 중단"); return 0; }

  // 액션 버튼명 = '선택 상품 준비 처리'
  const prepBtn = page.getByRole("button", { name: /상품\s*준비\s*처리/ }).first();
  if (!(await prepBtn.count())) { log("⚠️ '상품준비처리' 버튼 없음 — 중단"); return 0; }
  await prepBtn.click({ timeout: 8000 }).catch(()=>{});
  log("상품준비처리 클릭");
  // 커스텀 확인모달(클래스 불안정 css-*) → role+텍스트 '확인'(exact)으로 클릭. 취소와 구분됨.
  const confirmBtn = page.getByRole("button", { name: "확인", exact: true }).first();
  try {
    await confirmBtn.waitFor({ state: "visible", timeout: 8000 });
    await confirmBtn.click({ timeout: 5000 });
    log("모달 '확인' 클릭");
  } catch { log("⚠️ 확인 모달 못 찾음 — 커밋 안 됐을 수 있음"); }
  await sleep(5000); await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(()=>{});

  // 검증: prepare 다시 로드 → 잔여 건수
  await page.goto(PREPARE, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(()=>{});
  await sleep(4000); await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(()=>{});
  const n2 = await page.locator('tbody input[type=checkbox]').count().catch(()=>0);
  log(`준비처리 후 결제완료 잔여 ${n2}건 (0이면 전량 전환)`);
  return n - n2;
}

async function collectSerials(page, log) {
  await page.goto(SHIPMENT, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(()=>{});
  await sleep(4000);
  await page.locator('button:has-text("검색하기")').first().click({ timeout: 6000 }).catch(()=>{});
  await sleep(5000); await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(()=>{});
  const links = page.getByText(/^ORD\d{8}-\d+$/);
  const n = await links.count().catch(()=>0);
  const serials = [];
  for (let i = 0; i < n; i++) { const t = (await links.nth(i).innerText().catch(()=>"")).trim(); if (t && !serials.includes(t)) serials.push(t); }
  log(`29CM 출고관리 주문번호 ${serials.length}건: ${serials.join(", ")}`);
  return serials;
}

async function getDetail(page, serial, log) {
  await page.goto(`https://partner-order.29cm.co.kr/detail/${serial}`, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(()=>{});
  await sleep(3500); await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(()=>{});
  const txt = await page.locator("body").innerText().catch(()=>"");
  const lines = txt.split("\n").map(l=>l.replace(/\t/g," ").trim());
  function after(label) { const i = lines.findIndex(l => l.startsWith(label)); if (i<0) return ""; const same = lines[i].slice(label.length).trim(); return same || (lines[i+1]||"").trim(); }
  // 수령자 정보 블록 우선
  let recvIdx = lines.findIndex(l => /수령자\s*정보/.test(l));
  const slice = recvIdx >= 0 ? lines.slice(recvIdx) : lines;
  const grab = (label) => { const i = slice.findIndex(l => l.startsWith(label)); if (i<0) return ""; const same = slice[i].slice(label.length).trim(); return same || (slice[i+1]||"").trim(); };
  const name = grab("수령자명");
  const phoneRaw = grab("연락처");
  const phone = (phoneRaw.match(/01[016789][-\s]?\d{3,4}[-\s]?\d{4}/) || [""])[0].replace(/\s/g,"");
  const addrRaw = grab("배송 주소");
  const zip = (addrRaw.match(/\((\d{5})\)/) || [,""])[1];
  const addr = addrRaw.replace(/\(\d{5}\)/, "").trim();
  const msg = grab("배송 메세지");
  // 상품: 상세내용 테이블에서 헤더 기준으로 상품명+옵션+직접입력옵션(각인)+최종수량 추출.
  // 29CM 컬럼: 상품명 / 옵션 / 직접 입력형 옵션 / … / 최종수량
  const items = await page.evaluate(() => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    for (const tb of document.querySelectorAll("table")) {
      if (!/상품명/.test(tb.innerText || "")) continue;
      const ths = [...tb.querySelectorAll("thead th, thead td")];
      const headers = (ths.length ? ths : [...(tb.querySelector("tr")?.querySelectorAll("th,td") || [])]).map((c) => norm(c.innerText));
      const exact = (label) => headers.findIndex((h) => h === label);
      const inc = (re) => headers.findIndex((h) => re.test(h));
      const pi = exact("상품명") >= 0 ? exact("상품명") : inc(/상품명/);
      const oi = exact("옵션");                 // '직접 입력형 옵션'과 구분 위해 정확매칭
      const ci = inc(/직접.*옵션/);              // 직접 입력형 옵션(각인 등)
      let qi = exact("최종수량"); if (qi < 0) qi = inc(/수량/);
      const res = [];
      for (const tr of tb.querySelectorAll("tbody tr")) {
        const cells = [...tr.querySelectorAll("td")].map((td) => norm(td.innerText));
        if (!cells.length) continue;
        let prod = pi >= 0 ? cells[pi] : "";
        if (!prod) prod = cells.filter((c) => /[가-힣]/.test(c) && c.length > 4 && c !== "-").sort((a, b) => b.length - a.length)[0] || "";
        if (!prod) continue;
        const opt = oi >= 0 ? cells[oi] : "";
        const cust = ci >= 0 ? cells[ci] : "";
        const qty = qi >= 0 ? cells[qi] : "";
        const q = (qty || "").replace(/[^\d]/g, "") || "1";
        let full = prod;
        if (opt && opt !== "-") full += ` / ${opt}`;
        if (cust && cust !== "-") full += ` (${cust})`;
        if (Number(q) > 1) full += ` x${q}`;       // 수량 2개+ 송장에 표시
        res.push({ prod: full, qty: q, raw: cells.join("|").slice(0, 200) });
      }
      return res;
    }
    return [];
  }).catch(() => []);
  log(`  ${serial}: ${name} / ${phone} / (${zip}) ${addr.slice(0,30)}... / 상품 ${items.length}개`);
  return { serial, name, phone, zip, addr, msg, items };
}

async function getCm29OutboundRows(_opts, log) {
  const { page } = await getMarketplacePage("29cm", log);
  await ensureLoggedIn("29cm", page, log);
  // 수집 전에 결제완료→배송준비(상품준비처리) 전환. 안 하면 신규 주문이 출고관리 큐에 안 떠 누락됨.
  // CM29_DO_PREPARE=0 이면 끔, CM29_PREPARE_DRYRUN=1 이면 건수만 보고 쓰기 생략.
  if ((process.env.CM29_DO_PREPARE ?? "1") !== "0") {
    try {
      await prepareCm29Orders(page, log, { dryRun: process.env.CM29_PREPARE_DRYRUN === "1" });
    } catch (e) { log("29CM 준비처리 실패(수집은 계속): " + e.message); }
  }
  const serials = await collectSerials(page, log);
  const rows = [];
  for (const s of serials) {
    const d = await getDetail(page, s, log);
    const items = d.items.length ? d.items : [{ prod: "" }];
    for (const it of items) {
      rows.push({ name: d.name, mobile: phoneIsMobile(d.phone)?d.phone:"", tel: phoneIsMobile(d.phone)?"":d.phone, addr: d.addr, zip: d.zip, prod: it.prod, color: "", qty: it.qty || "1", msg: d.msg, order: d.serial, seller: "29CM" });
    }
  }
  return rows;
}
function phoneIsMobile(p){ return /^01[016789]/.test((p||"").replace(/\D/g,"")); }

module.exports = { getCm29OutboundRows, getDetail, collectSerials, prepareCm29Orders };

// 직접 실행 시 테스트
if (require.main === module) {
  require("dotenv").config({ override: true });
  const { closeMarketplaceBrowsers } = require("./marketplaceSync");
  const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
  getCm29OutboundRows({}, log).then(rows => {
    console.log("\n=== 29CM 우체국 행 ===");
    rows.forEach(r => console.log(JSON.stringify([r.name,r.mobile,r.tel,r.addr,r.zip,r.prod,r.qty,r.msg,r.order,r.seller])));
    return closeMarketplaceBrowsers();
  }).catch(e => { console.error("ERR", e.message); process.exit(1); });
}
