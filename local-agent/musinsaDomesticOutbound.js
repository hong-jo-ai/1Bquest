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

/**
 * 출고 누락 경보 — 이 스크립트의 실패는 "0행"으로 조용히 끝나 하트비트에도 안 잡힌다
 * (2026-08-28: 14:30·15:10 두 런이 말없이 신규주문을 흘렸다). 그래서 사람이 개입해야 하는
 * 상황은 텔레그램으로 직접 알린다. 알림 실패가 본작업을 막지 않도록 전부 삼킨다.
 */
async function alert(msg, log) {
  try {
    const { notifyFail } = require("./notifyFail");
    await notifyFail("무신사 국내 출고", msg);
    log(`⚠️ 경보 발송: ${msg.slice(0, 60)}`);
  } catch (e) {
    log(`경보 발송 실패: ${e && e.message}`);
  }
}

async function ensureMusinsa(page, log) {
  await ensureLoggedIn("musinsa", page, log);
  await page.goto("https://partner.musinsa.com/order/history", { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  await sleep(4000);
  if (/sso|oauth\/login/i.test(page.url())) { log("무신사 재로그인"); await ensureLoggedIn("musinsa", page, log); await sleep(4000); }
  return !/sso|oauth\/login/i.test(page.url());
}

/**
 * 그리드가 실제로 그려질 때까지 기다린 뒤 건수를 돌려준다.
 * AG-Grid 는 검색 직후 잠깐 0행이라, 행 수만 보면 "로딩 중"을 "0건"으로 오독한다
 * (2026-08-28 14:30·15:10 런이 이 구멍으로 신규주문 2건을 통째 흘렸다).
 * 그래서 화면의 "총 N/M 건" 텍스트를 1차 근거로 삼고, 행 수는 보조로만 쓴다.
 * @returns {{ total:number|null, rows:number, ready:boolean }}
 */
async function gridCount(frame, waitMs = 20000) {
  const started = Date.now();
  let total = null, rows = 0;
  while (Date.now() - started < waitMs) {
    const txt = await frame.locator("body").innerText().catch(() => "");
    const m = txt.replace(/\s+/g, " ").match(/총\s*(\d+)\/(\d+)\s*건/);
    rows = await frame.evaluate(() => document.querySelectorAll(".ag-center-cols-container .ag-row, .ag-row").length).catch(() => 0);
    if (m) {
      total = Number(m[2]);
      // 건수가 0이 아니면 행이 그려질 때까지 조금 더 기다린다.
      if (total === 0 || rows > 0) return { total, rows, ready: true };
    } else if (rows > 0) {
      return { total: null, rows, ready: true };
    }
    await sleep(1500);
  }
  return { total, rows, ready: false };
}

async function loadFrameSearch(page, url, log) {
  // iframe 로딩이 들쭉날쭉 — 한 번 실패로 0행 처리되면 출고가 통째로 누락된다(2026-08-27 12:30 크론).
  // 3회까지 새로고침 재시도(2026-08-28: 2회로도 연속 실패해 신규주문이 하루 밀렸다).
  let f = null;
  for (let attempt = 1; attempt <= 3 && !f; attempt++) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    await sleep(6000); await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
    for (let i = 0; i < 25 && !f; i++) { await sleep(1000); f = getFrame(page); }
    if (!f) log(`iframe 못 찾음 (시도 ${attempt}/3) — ${url}`);
  }
  if (!f) return null;
  await f.locator('button:has-text("검색")').filter({ hasNotText: "초기화" }).first().click({ timeout: 6000 }).catch(() => {});
  await sleep(6000);
  return f;
}

/**
 * 이 화면은 순수 AG-Grid 가 아니라 무신사 자체 래퍼(gridX2, window.ord3X_gx)다.
 * 선택 여부의 정본은 `gx.getIsSelectedNode(row)` — 화면의 `.ag-row-selected` 클래스가 아니다.
 * (2026-08-28: .ag-row-selected 로만 판정하다 "선택 실패"를 오판해 신규주문을 흘렸다.)
 * 또 `chk === "2"` 인 행은 출고보류·교환건이라 무신사 스스로 처리 대상에서 빼므로 분모에서 제외한다.
 */
async function gridState(frame) {
  return frame.evaluate(() => {
    const gx = Object.keys(window).map((k) => (/_gx$/.test(k) ? window[k] : null))
      .find((o) => o && typeof o.getIsSelectedNode === "function" && typeof o.getRows === "function");
    if (!gx) return { ok: false, selectable: 0, selected: 0, total: 0 };
    const app = Object.keys(window).map((k) => (/^app_.*_grid$/.test(k) ? window[k] : null)).find((o) => o && o.list_data);
    const list = (app && app.list_data) || [];
    let selected = 0;
    for (let r = gx.getFixedRows(); r < gx.getRows(); r++) if (gx.getIsSelectedNode(r)) selected++;
    const selectable = list.length ? list.filter((x) => String(x.chk) !== "2").length : gx.getRows() - gx.getFixedRows();
    const held = list.filter((x) => String(x.chk) === "2").map((x) => `${x.ord_opt_no}(${x.ord_kind_nm || x.ord_type_nm || "보류"})`);
    return { ok: true, selectable, selected, total: gx.getRows() - gx.getFixedRows(), held };
  }).catch(() => ({ ok: false, selectable: 0, selected: 0, total: 0 }));
}

/** 전체선택 — 헤더 체크박스 → 실패 시 행별 체크박스. 판정은 항상 그리드 API 로. */
async function selectAll(frame) {
  const before = await gridState(frame);
  if (before.selectable <= 0) return 0; // 선택 가능한 행이 애초에 없음(전부 출고보류/교환)

  await frame.locator(".ag-header-select-all input, .ag-header-select-all .ag-checkbox-input, .ag-header-select-all")
    .first().click({ timeout: 5000 }).catch(() => {});
  await sleep(1500);
  let st = await gridState(frame);
  if (st.selected > 0) return st.selected;

  const boxes = frame.locator(".ag-pinned-left-cols-container .ag-selection-checkbox, .ag-selection-checkbox, .ag-pinned-left-cols-container .ag-row");
  const n = await boxes.count().catch(() => 0);
  for (let i = 0; i < n; i++) {
    await boxes.nth(i).click({ timeout: 3000 }).catch(() => {});
    await sleep(250);
    st = await gridState(frame);
    if (st.selected >= st.selectable) break;
  }
  await sleep(800);
  st = await gridState(frame);
  return st.selected;
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
  // 수동 복구용 우회: MUSINSA_DOM_ROWS_FILE=<json> 이면 브라우저 없이 해당 rows 반환 (2026-08-19 백로그 복구에 사용)
  if (process.env.MUSINSA_DOM_ROWS_FILE) {
    const rows = JSON.parse(fs.readFileSync(process.env.MUSINSA_DOM_ROWS_FILE, "utf-8"));
    log(`무신사 일반: 파일 주입 ${rows.length}행 (${process.env.MUSINSA_DOM_ROWS_FILE})`);
    return rows;
  }
  const { page, context } = await getMarketplacePage("musinsa", log);
  page.on("dialog", (d) => { log(`  무신사 dialog: ${d.message().replace(/\s+/g, " ").slice(0, 70)}`); d.accept().catch(() => {}); });
  let popup = null, dl = null;
  page.on("download", (d) => { dl = d; });
  context.on("page", (p) => {
    if (p === page) return;
    popup = p; p.on("download", (d) => { dl = d; }); p.on("dialog", (d) => { d.accept().catch(() => {}); });
    // ⚠️ 잡창 자동 닫기 로직 제거(2026-08-19): 무신사가 8/7경 팝업 URL을 바꾼 뒤 이 로직이
    // 필요한 invoice 팝업까지 잡창으로 오판해 닫아 엑셀 다운로드가 전멸했다(8/7~8/18).
    // 잡창이 남아 있어도 다운로드에 지장이 없으므로 아무것도 닫지 않는다.
  });
  if (!(await ensureMusinsa(page, log))) { log("무신사 로그인 실패"); return []; }

  // 1) 배송출고요청: 검색 → 전체선택 → 상품준비중 변경(go_delivery)
  const req = await loadFrameSearch(page, REQ, log);
  if (!req) {
    log("배송출고요청 iframe 못 찾음");
    await alert("배송출고요청 화면(iframe)을 3회 모두 못 잡았습니다. 신규주문이 있으면 그대로 밀립니다 — 무신사 파트너에서 직접 [상품준비중 변경] 필요.", log);
    return [];
  }
  // 행 수만 보면 "로딩 중"을 "0건"으로 오독한다 → 화면의 "총 N/M 건"을 우선 근거로.
  const { total: reqTotal, rows: reqRows, ready } = await gridCount(req);
  const pending = reqTotal != null ? reqTotal : reqRows;
  if (!ready) {
    log(`무신사 일반: 배송출고요청 그리드 로딩 확인 실패(총=${reqTotal} 행=${reqRows})`);
    await alert(`배송출고요청 그리드를 읽지 못했습니다(총=${reqTotal ?? "?"} 행=${reqRows}). 신규주문이 밀렸을 수 있으니 화면 확인 필요.`, log);
  }
  let prepared = 0;
  // 출고보류·교환건(chk=2)은 무신사가 스스로 대상에서 빼므로 "처리해야 할 건"에서 제외한다.
  const st0 = await gridState(req);
  if (st0.selectable === 0 && pending > 0) {
    log(`무신사 일반: 신규 ${pending}건 전부 출고보류/교환 — 준비 대상 없음${st0.held && st0.held.length ? ` [${st0.held.join(", ")}]` : ""}`);
  }
  if (st0.selectable > 0) {
    let sel = await selectAll(req);
    if (sel <= 0) {
      // 한 번 더 — 그리드가 늦게 그려져 체크박스를 놓치는 경우가 있다(2026-08-28 15:10 런).
      log("무신사 일반: 전체선택 실패 — 재시도");
      await sleep(4000);
      sel = await selectAll(req);
    }
    if (sel > 0) {
      const called = await req.evaluate(() => { try { if (window.app_ord35_grid && app_ord35_grid.go_delivery) { app_ord35_grid.go_delivery(); return true; } } catch (e) {} return false; }).catch(() => false);
      if (!called) await req.locator('button:has-text("상품준비중 변경"), a:has-text("상품준비중 변경")').first().click({ timeout: 6000, force: true }).catch(() => {});
      await sleep(6000); await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
      prepared = sel;
      log(`무신사 일반: ${sel}행 상품준비중 변경 (신규 ${pending}건)`);
    } else {
      log("무신사 일반: 배송출고요청 선택 실패 — 준비 건너뜀");
      await alert(`처리 가능한 신규주문 ${st0.selectable}건(전체 ${pending}건)이 있는데 [상품준비중 변경]을 못 눌렀습니다 → 이 주문들은 우체국 접수에서 빠집니다. 무신사 파트너에서 수동 처리 필요.`, log);
    }
  } else if (pending === 0) log("무신사 일반: 배송출고요청 신규 0건");

  // 2) 배송출고처리: 검색 → 전체선택 → 택배송장목록받기 팝업 → 배송목록 받기(엑셀)
  const exp = await loadFrameSearch(page, EXP, log);
  if (!exp) {
    log("배송출고처리 iframe 못 찾음");
    await alert("배송출고처리 화면(iframe)을 3회 모두 못 잡았습니다 — 송장 발급 대상 엑셀을 못 받았습니다.", log);
    return [];
  }
  const expCount = await gridCount(exp);
  const expRows = expCount.total != null ? expCount.total : expCount.rows;
  if (expRows <= 0) {
    log("무신사 일반: 배송출고처리 0건");
    // 방금 상품준비중으로 넘긴 게 있는데 출고처리 목록이 비면 = 어딘가 끊긴 것.
    if (prepared > 0) await alert(`${prepared}건을 상품준비중으로 넘겼는데 배송출고처리 목록이 0건입니다 — 송장 발급이 누락됩니다.`, log);
    return [];
  }

  // 팝업(배송목록 받기)이 정본 — invoice_list 엑셀만 비마스킹 수취인 정보를 담는다.
  // (AG-Grid 우클릭 내보내기는 이름·연락처가 마스킹되어 우체국 접수에 사용 불가 — 2026-08-19 확인)
  // 8/7~8/18 간헐 전멸 이력이 있어 selectAll부터 3회 재시도.
  let file = null;
  for (let attempt = 1; attempt <= 3 && !file; attempt++) {
    if (attempt > 1) { log(`무신사 일반: 팝업 다운로드 재시도 ${attempt}/3`); await sleep(3000); }
    const sel = await selectAll(exp);
    if (sel <= 0) { log("무신사 일반: 전체선택 0행 — 재시도"); continue; }
    popup = null; dl = null;
    await exp.evaluate(() => { try { popDeliveryInvDnView(); } catch (e) {} }).catch(() => {});
    for (let i = 0; i < 15 && !popup; i++) await sleep(1000);
    if (!popup) { log("무신사 일반: 택배송장목록 팝업 안 뜸"); continue; }
    await popup.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
    await sleep(3000);
    log(`  [dbg] 팝업 url=${popup.url() || "(빈값)"} closed=${popup.isClosed()}`);
    const btns = await popup.evaluate(() => Array.from(document.querySelectorAll("button, a, input[type=button]")).map((b) => (b.textContent || b.value || "").trim()).filter(Boolean).slice(0, 10)).catch((e) => "evalErr:" + e.message.split("\n")[0]);
    log(`  [dbg] 팝업 버튼: ${JSON.stringify(btns)}`);
    await popup.locator('button:has-text("배송목록 받기"), a:has-text("배송목록 받기")').first().click({ timeout: 6000 }).catch((e) => log("  [dbg] 클릭 실패: " + e.message.split("\n")[0]));
    for (let i = 0; i < 15 && !dl; i++) await sleep(1000);
    if (!dl) {
      const t = await popup.evaluate(() => { try { app_dlvinv_download.download_dlv_inv(); return "called"; } catch (e) { return "err:" + e.message; } }).catch((e) => "evalErr:" + e.message.split("\n")[0]);
      log(`  [dbg] 폴백 download_dlv_inv: ${t}`);
      for (let i = 0; i < 20 && !dl; i++) await sleep(1000);
    }
    if (!dl) { log(`무신사 일반: 엑셀 다운로드 실패 (시도 ${attempt}/3)`); await popup.close().catch(() => {}); continue; }
    const dir = path.join(os.tmpdir(), "paulvice-marketplace-downloads"); fs.mkdirSync(dir, { recursive: true });
    file = path.join(dir, `${Date.now()}-musinsa-dom-${dl.suggestedFilename()}`);
    await dl.saveAs(file);
    await popup.close().catch(() => {});
  }
  if (!file) {
    log(`⚠️ 무신사 일반: 배송출고처리 ${expRows}행이 있는데 엑셀 다운로드 3회 모두 실패 — 접수 누락 위험, 수동 확인 필요`);
    return [];
  }

  const rows = rowsFromExcel(file, log);
  log(`무신사 일반 우체국 행 ${rows.length}건`);
  rows.forEach((r) => log(`  무신사 ${r.order}: ${r.name} / ${r.mobile || r.tel} / (${r.zip}) ${r.addr.slice(0, 22)}`));
  return rows;
}

module.exports = { getMusinsaDomesticRows, rowsFromExcel };

// CLI. `--json <path>` 를 주면 rows 를 그 파일에 JSON 으로 남긴다 —
// buildPostOffice 가 이 스크립트를 자식 프로세스로 띄워 결과를 받는 경로(2026-08-24).
if (require.main === module) {
  const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
  const jsonIdx = process.argv.indexOf("--json");
  const jsonOut = jsonIdx >= 0 ? process.argv[jsonIdx + 1] : null;
  getMusinsaDomesticRows({}, log).then(async (rows) => {
    if (jsonOut) {
      fs.writeFileSync(jsonOut, JSON.stringify(rows));
      log(`rows ${rows.length}건 → ${jsonOut}`);
    } else {
      console.log("\n=== 무신사 일반 우체국 행 ===");
      rows.forEach((r) => console.log(JSON.stringify([r.name, r.mobile, r.tel, r.addr, r.zip, r.prod, r.color, r.qty, r.order, r.seller])));
    }
    const { closeMarketplaceBrowsers } = require("./marketplaceSync");
    await closeMarketplaceBrowsers().catch(() => {});
    process.exit(0);
  }).catch(async (e) => {
    console.error("ERR", e.message);
    try { const { closeMarketplaceBrowsers } = require("./marketplaceSync"); await closeMarketplaceBrowsers(); } catch (_) {}
    process.exit(1);
  });
}
