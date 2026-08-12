/**
 * 무신사 송장입력 (Phase2) — 우체국 송장을 배송출고처리에 역입력 → 출고완료(배송중).
 * 송장 소스: pp_shipments(channel=무신사, submitted, regi_no). order_number=주문일련번호(9자리).
 * 글로벌·일반 모두 동일 화면(배송출고처리, iframe ord36)에서 처리.
 *
 * 흐름: 로그인 → /order/delivery-export iframe 검색 → 그리드 주문일련번호·송장칸(dlv_no) 수집
 *   → pp_shipments 중 그리드에 있고 송장 빈 건만 타깃(멱등) → '택배송장일괄입력'(popDeliveryInv) 팝업
 *   → 택배사 select(DLV_CD)=우체국택배 → FILE 업로드(탭구분 '주문일련번호\t송장', 헤더없음 — delivery_inv_import)
 *   → 팝업 그리드 검증(주문일련번호↔송장, 택배사) → '송장등록'(delivery_procedure) → 확인 다이얼로그.
 * 멱등: 송장등록되면 주문이 배송출고처리에서 빠짐 → 재실행 시 그리드에 없어 스킵. 그리드 송장칸에 값 있어도 스킵.
 * ⚠️ 2026-06-11 2건(최서연·김희영) 실검증 예정. AG-Grid/iframe/팝업 셀렉터 민감.
 */
require("dotenv").config({ override: true });
const fs = require("fs"), path = require("path"), os = require("os");
const DASH = "/Users/mac/sungjo_ai/paulwise-dashboard";
function le(p) { try { for (const l of fs.readFileSync(p, "utf8").split("\n")) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (!m) continue; let v = m[2].trim().replace(/^["']|["']$/g, ""); if (!(m[1] in process.env)) process.env[m[1]] = v; } } catch {} }
le(DASH + "/.env.supabase"); le(DASH + "/.env.local");
const { createClient } = require(DASH + "/node_modules/@supabase/supabase-js");
const { getMarketplacePage, ensureLoggedIn, closeMarketplaceBrowsers } = require("./marketplaceSync");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
const EXP = "https://partner.musinsa.com/order/delivery-export";
const getFrame = (page) => page.frames().find((f) => /bizest\.musinsa\.com\/po\/.*(delivery|order)/.test(f.url()));

// 배송출고처리 그리드: 행별 {serial(주문일련번호 8~11자리), ordNo(주문번호 15~18자리), inv(송장 dlv_no)}
// AG-Grid는 고정열/중앙 컨테이너로 한 행이 여러 .ag-row 조각으로 쪼개짐 → row-index로 셀 병합.
async function readExportGrid(frame) {
  return await frame.evaluate(() => {
    const byIdx = {};
    document.querySelectorAll(".ag-row").forEach((r) => { const idx = r.getAttribute("row-index") ?? r.getAttribute("row-id"); if (idx == null) return; (byIdx[idx] = byIdx[idx] || []).push(...r.querySelectorAll(".ag-cell")); });
    const out = [];
    Object.values(byIdx).forEach((cells) => {
      if (cells.length < 3) return;
      const get = (col) => { const c = cells.find((x) => x.getAttribute("col-id") === col); return c ? (c.innerText || "").replace(/\s+/g, " ").trim() : ""; };
      let serial = "", ordNo = "";
      cells.forEach((c) => { const v = (c.innerText || "").trim(); if (/^\d{15,18}$/.test(v)) ordNo = v; else if (/^\d{8,11}$/.test(v) && !serial) serial = v; });
      const inv = get("dlv_no");
      if (serial || ordNo) out.push({ serial, ordNo, inv });
    });
    return out;
  }).catch(() => []);
}

async function dispatchMusinsa(opts = {}) {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const since = new Date(Date.now() - 14 * 86400000).toISOString();
  // 윈도우는 registered_at 기준 — 취소→재접수 행은 created_at이 최초 접수일이라(업서트)
  // created_at 기준이면 14일 밖으로 빠져 송장입력이 누락된다 (2026-08-12 이창훈·곽태미 실사례).
  const { data } = await sb.from("pp_shipments").select("order_number,recipient_name,regi_no")
    .eq("channel", "무신사").eq("req_type", "1").eq("is_test", false).eq("status", "submitted")
    .not("regi_no", "is", null).gte("registered_at", since).order("registered_at", { ascending: false });
  let pending = data || [];
  if (process.env.ONLY_ORDER) pending = pending.filter((t) => t.order_number === process.env.ONLY_ORDER);
  log(`무신사 송장 후보(pp_shipments) ${pending.length}건`);
  if (!pending.length) { log("대상 없음"); return { ok: 0, skip: 0 }; }

  const { page, context } = await getMarketplacePage("musinsa", log);
  page.on("dialog", (d) => { log("  dialog: " + d.message().replace(/\s+/g, " ").slice(0, 80)); d.accept().catch(() => {}); });
  let popup = null;
  const popupDialogs = [];
  const onPop = (p) => { if (p !== page) { popup = p; p.on("dialog", (d) => { const m = d.message().replace(/\s+/g, " ").slice(0, 90); popupDialogs.push(m); log("  popup dialog: " + m); d.accept().catch(() => {}); }); p.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {}); } };
  context.on("page", onPop);
  let ok = 0, skip = 0;
  try {
    await ensureLoggedIn("musinsa", page, log);
    await page.goto(EXP, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    await sleep(6000); await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
    let f = getFrame(page); for (let i = 0; i < 10 && !f; i++) { await sleep(1000); f = getFrame(page); }
    if (!f) { log("배송출고처리 iframe 없음"); return { ok, skip }; }
    await f.locator('button:has-text("검색")').filter({ hasNotText: "초기화" }).first().click({ timeout: 6000 }).catch(() => {});
    await sleep(6000);

    const grid = await readExportGrid(f);
    log(`배송출고처리 그리드 ${grid.length}건: ${grid.map((g) => g.serial || g.ordNo).join(",")}`);
    // pp_shipments.order_number 는 일반=주문일련번호, 글로벌=주문번호 → 둘 다로 그리드 행 매칭. 업로드는 항상 그리드의 주문일련번호(serial) 사용.
    const find = (ord) => grid.find((g) => g.serial === ord || g.ordNo === ord);
    const targets = [], gone = [], already = [];
    for (const s of pending) {
      const g = find(s.order_number);
      if (!g) { gone.push(s); continue; }
      if (String(g.inv).trim()) { already.push({ s, inv: g.inv }); continue; }
      if (!g.serial) { gone.push(s); continue; } // 업로드에 일련번호 필요
      targets.push({ ...s, serial: g.serial });
    }
    skip += gone.length + already.length;
    gone.forEach((s) => log(`  ${s.order_number}(${s.recipient_name || ""}): 배송출고처리에 없음(이미 출고/기간외) — 스킵`));
    already.forEach((x) => log(`  ${x.s.order_number}(${x.s.recipient_name || ""}): 이미 송장(${x.inv}) — 스킵`));
    if (!targets.length) { log("입력할 신규 송장 없음"); return { ok, skip }; }
    if (opts.dryRun) { log(`[DRYRUN] 입력 대상 ${targets.length}건: ` + targets.map((t) => `${t.serial}=${t.regi_no}`).join(", ")); return { ok: 0, skip, dryRun: targets.length }; }

    // 택배송장일괄입력 팝업
    popup = null;
    await f.evaluate(() => { try { popDeliveryInv(); } catch (e) {} }).catch(() => {});
    for (let i = 0; i < 15 && !popup; i++) await sleep(1000);
    if (!popup) { log("택배송장일괄입력 팝업 안 뜸"); return { ok, skip }; }
    await popup.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
    await sleep(3000);

    // 택배사 = 우체국택배
    await popup.locator('select[name="DLV_CD"]').selectOption({ label: "우체국택배" }).catch((e) => log("DLV_CD 선택: " + e.message));
    await sleep(800);

    // txt 업로드: 주문일련번호\t송장 (헤더 없음, CRLF)
    const dir = path.join(os.tmpdir(), "paulvice-marketplace-downloads"); fs.mkdirSync(dir, { recursive: true });
    const txt = path.join(dir, `musinsa-inv-${Date.now()}.txt`);
    fs.writeFileSync(txt, targets.map((t) => `${t.serial}\t${t.regi_no}`).join("\r\n") + "\r\n", "utf8");
    await popup.locator('input[type=file][name="FILE"], input[type=file]').first().setInputFiles(txt).catch((e) => log("파일업로드: " + e.message));
    await sleep(5000); await popup.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});

    // 팝업 그리드 검증: 업로드된 행(주문일련번호↔송장). 고정열 조각을 row-index로 병합.
    const pg = await popup.evaluate(() => {
      const byIdx = {};
      document.querySelectorAll(".ag-row").forEach((r) => { const idx = r.getAttribute("row-index") ?? r.getAttribute("row-id"); if (idx == null) return; (byIdx[idx] = byIdx[idx] || []).push(...r.querySelectorAll(".ag-cell")); });
      return Object.values(byIdx).map((cells) => cells.map((c) => (c.innerText || "").replace(/\s+/g, " ").trim()).filter(Boolean).join("|")).filter(Boolean).slice(0, 40);
    }).catch(() => []);
    log(`팝업 업로드 그리드 ${pg.length}행:`); pg.forEach((r) => log("  " + r.slice(0, 90)));
    const loaded = pg.length;
    if (loaded < targets.length) { log(`⚠️ 업로드 행(${loaded}) < 대상(${targets.length}) — 송장등록 중단`); await popup.close().catch(() => {}); return { ok, skip }; }
    // 모든 송장이 그리드에 보이는지 확인
    const allShown = targets.every((t) => pg.some((r) => r.includes(t.serial) && r.includes(t.regi_no) && /우체국/.test(r)));
    if (!allShown) { log("⚠️ 일부 주문일련번호↔송장↔우체국택배 매칭 안 보임 — 송장등록 중단(수동확인)"); await popup.close().catch(() => {}); return { ok, skip }; }

    // 업로드된 행 전체선택 (필수 — 선택 안 하면 delivery_procedure가 0건 처리)
    await popup.locator(".ag-header-select-all input, .ag-header-select-all .ag-checkbox-input, .ag-header-select-all").first().click({ timeout: 5000 }).catch(() => {});
    await sleep(1200);
    const selN = await popup.evaluate(() => document.querySelectorAll(".ag-row-selected").length).catch(() => 0);
    if (selN <= 0) { log("⚠️ 팝업 행 전체선택 실패 — 송장등록 중단"); await popup.close().catch(() => {}); return { ok, skip }; }

    // 송장등록 = 출고완료(delivery_procedure). 결과 다이얼로그로 실제 성공 판정.
    popupDialogs.length = 0;
    await popup.evaluate(() => { try { app_dlvinvoice_search.delivery_procedure(); } catch (e) {} }).catch(() => {});
    await sleep(5500);
    const done = popupDialogs.find((m) => /출고완료\s*처리하였습니다|처리하였습니다|처리되었습니다/.test(m));
    const fail = popupDialogs.find((m) => /없습니다|실패|오류|불가/.test(m));
    if (done) {
      ok = targets.length;
      targets.forEach((t) => log(`  ✅ ${t.serial}(${t.recipient_name || ""}): 송장 ${t.regi_no} 출고완료`));
      log(`출고완료 응답: ${done}`);
    } else {
      skip += targets.length;
      log(`⚠️ 출고완료 확인 응답 없음${fail ? " (" + fail + ")" : ""} — 결과 불확실(미처리로 간주)`);
    }
    await popup.close().catch(() => {});
  } finally {
    context.off("page", onPop);
    await closeMarketplaceBrowsers().catch(() => {});
  }
  log(`무신사 송장입력 완료: 성공 ${ok} / 스킵 ${skip}`);
  return { ok, skip };
}

module.exports = { dispatchMusinsa };

if (require.main === module) {
  dispatchMusinsa({ dryRun: process.env.MUSINSA_DISPATCH_DRYRUN === "1" })
    .then(() => process.exit(0))
    .catch((e) => { console.error("ERR", e.message); process.exit(1); });
}
