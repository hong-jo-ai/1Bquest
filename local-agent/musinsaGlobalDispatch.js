/**
 * 무신사 글로벌 송장입력 (Phase2-글로벌) — prep 개편 대응 리라이트 (2026-07-22 실측 검증).
 *
 * 개편 후 글로벌 흐름(중요):
 *   ① '글로벌 배송 출고 요청'(/order/global-delivery-request, bizest dlv11)에서 '상품준비중 변경'
 *      → 주문이 ② '글로벌 배송 출고 처리'(/order/global-delivery-export, bizest dlv12)로 **이동**한다.
 *   송장입력·출고완료는 dlv12에서 해야 한다. 구버전은 dlv11만 봐서 "그리드 0건=이미 출고"로
 *   오판, 조용히 스킵했다(2026-07-22 에나멜 이어커프 미출고 사고 — 사장님 발견).
 *
 * dlv12 입력 방법(실측):
 *   - 택배송장일괄입력 팝업(view_deliveryInv)은 업로드 매칭까지 되지만 delivery_procedure가
 *     "0건 처리, 1건 실패"로 거부됨 — dlv12에서는 사용 금지.
 *   - 정답 = dlv_no 셀 **더블클릭 인라인 편집** + Enter → 행 체크(JS) → '출고완료' 버튼
 *     → edit_delivery_procedure {"cd":"1","msg":"ok"} → 재검색 시 행 소멸로 검증.
 *   - 택배사는 서버측 EPOST(우체국) 기본 — 별도 선택 불필요. 표기가 '우체국택배'가 아니라
 *     코드 'EPOST'로 나오는 것에 주의(텍스트 검증 시 /우체국|EPOST/).
 *
 * 조용한 실패 금지: 후보가 있는데 어느 화면에도 없거나 처리 실패하면 텔레그램 즉시 알림.
 * 멱등: dlv_no 값 있으면 스킵, 출고완료되면 dlv12 목록에서 빠짐.
 */
require("dotenv").config({ override: true });
const fs = require("fs");
const DASH = "/Users/mac/sungjo_ai/paulwise-dashboard";
function le(p) { try { for (const l of fs.readFileSync(p, "utf8").split("\n")) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (!m) continue; let v = m[2].trim().replace(/^["']|["']$/g, ""); if (!(m[1] in process.env)) process.env[m[1]] = v; } } catch {} }
le(DASH + "/.env.supabase"); le(DASH + "/.env.local");
const { createClient } = require(DASH + "/node_modules/@supabase/supabase-js");
require("./shippingHold").checkOrExit("무신사글로벌 송장입력", "paulvice");
const { getMarketplacePage, ensureLoggedIn, closeMarketplaceBrowsers } = require("./marketplaceSync");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);

const LIST = "https://partner.musinsa.com/order/global-delivery-request";   // dlv11 — 상품준비중 변경
const EXPORT = "https://partner.musinsa.com/order/global-delivery-export";  // dlv12 — 송장입력·출고완료
const getReqFrame = (page) => page.frames().find((f) => /bizest\.musinsa\.com\/po\/order-group-admin\/delivery\/dlv11/.test(f.url()));
const getExportFrame = (page) => page.frames().find((f) => /bizest\.musinsa\.com\/po\/order-group-admin\/delivery\/dlv12/.test(f.url()));
// 글로벌 주문 식별 — 수취인이 무신사 글로벌 허브(국내 수령자)
const isGlobalCand = (r) => /Global Hub|Domestic recipient|글로벌\s*허브|무신사로지스틱스/i.test(String(r.recipient_name || ""));

async function alertGlobal(msg) {
  log(msg);
  try { const { relayText } = require("./telegramRelay"); await relayText(msg); } catch {}
}

// dlv11 그리드 파싱 (구버전과 동일 — 주문번호/일련번호/송장)
async function readReqGrid(frame) {
  return await frame.evaluate(() => {
    const byIdx = {};
    document.querySelectorAll(".ag-row").forEach((r) => { const idx = r.getAttribute("row-index") ?? r.getAttribute("row-id"); if (idx == null) return; (byIdx[idx] = byIdx[idx] || []).push(...r.querySelectorAll(".ag-cell")); });
    const out = [];
    Object.values(byIdx).forEach((cells) => {
      const get = (col) => { const c = cells.find((x) => x.getAttribute("col-id") === col); return c ? (c.innerText || "").replace(/\s+/g, " ").trim() : ""; };
      let serial = "", ordNo = "";
      cells.forEach((c) => { const v = (c.innerText || "").trim(); if (/^\d{15,18}$/.test(v)) ordNo = v; else if (/^\d{8,11}$/.test(v) && !serial) serial = v; });
      const inv = get("dlv_no");
      if (serial || ordNo) out.push({ serial, ordNo, inv });
    });
    return out;
  }).catch(() => []);
}

// dlv12 그리드 파싱 — row-index별 프래그먼트 병합, col-id 기준 (ord_no/ord_opt_no/dlv_no)
async function readExportGrid(frame) {
  return await frame.evaluate(() => {
    const frags = [...document.querySelectorAll(".ag-row")];
    const byIdx = {};
    frags.forEach((r) => { const i = r.getAttribute("row-index"); if (i == null) return; (byIdx[i] = byIdx[i] || []).push(r); });
    return Object.entries(byIdx).map(([idx, rows]) => {
      const cells = rows.flatMap((r) => [...r.querySelectorAll(".ag-cell")]);
      const get = (col) => { const c = cells.find((x) => x.getAttribute("col-id") === col); return c ? (c.innerText || "").replace(/\s+/g, " ").trim() : ""; };
      return { idx, ordNo: get("ord_no"), serial: get("ord_opt_no"), inv: get("dlv_no") };
    }).filter((r) => r.ordNo || r.serial);
  }).catch(() => []);
}

async function dispatchMusinsaGlobal(opts = {}) {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const since = new Date(Date.now() - 14 * 86400000).toISOString();
  // registered_at 기준 — 취소→재접수 행이 created_at(최초 접수일) 윈도우 밖으로 빠지는 누락 방지 (musinsaDispatch 동일 수정 2026-08-12)
  const { data } = await sb.from("pp_shipments").select("order_number,recipient_name,regi_no,registered_at")
    .eq("channel", "무신사").eq("req_type", "1").eq("is_test", false).eq("status", "submitted")
    .not("regi_no", "is", null).gte("registered_at", since).order("registered_at", { ascending: false });
  let pending = (data || []).filter(isGlobalCand);
  if (process.env.ONLY_ORDER) pending = pending.filter((t) => t.order_number === process.env.ONLY_ORDER);
  log(`무신사 글로벌 송장 후보(pp_shipments) ${pending.length}건`);
  if (!pending.length) { log("글로벌 대상 없음 — 브라우저 안 엶"); return { ok: 0, skip: 0 }; }

  const { page } = await getMarketplacePage("musinsa", log);
  page.on("dialog", (d) => { log("  dialog: " + d.message().replace(/\s+/g, " ").slice(0, 100)); d.accept().catch(() => {}); });
  let ok = 0, skip = 0;
  try {
    await ensureLoggedIn("musinsa", page, log);
    await page.goto("https://partner.musinsa.com/order/history", { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    await sleep(4000);
    if (/sso|oauth\/login/i.test(page.url())) { log("무신사 재로그인"); await ensureLoggedIn("musinsa", page, log); await sleep(4000); }

    // ── Phase A: 출고요청(dlv11) — 아직 요청 단계인 후보를 '상품준비중 변경'으로 dlv12로 이동
    await page.goto(LIST, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    await sleep(6000); await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
    let fr = getReqFrame(page); for (let i = 0; i < 10 && !fr; i++) { await sleep(1000); fr = getReqFrame(page); }
    if (fr) {
      await fr.locator('button:has-text("검색")').filter({ hasNotText: "초기화" }).first().click({ timeout: 6000 }).catch(() => {});
      await sleep(6000);
      const reqGrid = await readReqGrid(fr);
      log(`글로벌 출고요청(dlv11) 그리드 ${reqGrid.length}건: ${reqGrid.map((g) => g.serial || g.ordNo).join(",") || "-"}`);
      const inReq = pending.filter((s) => reqGrid.some((g) => g.serial === s.order_number || g.ordNo === s.order_number));
      if (inReq.length && opts.dryRun) log(`[DRYRUN] dlv11 준비중변경 대상 ${inReq.length}건`);
      else if (inReq.length) {
        // ⚠️ 전체선택→go_delivery는 그리드 전체에 적용 — 그리드 행수 == 대상 수일 때만 진행(무관 주문 보호)
        if (reqGrid.length > inReq.length) {
          log(`⚠️ dlv11 그리드 ${reqGrid.length}건 > 대상 ${inReq.length}건 — 무관 주문 보호 위해 준비중변경 스킵(수동확인)`);
        } else {
          await fr.locator(".ag-header-select-all input, .ag-header-select-all .ag-checkbox-input, .ag-header-select-all").first().click({ timeout: 5000 }).catch(() => {});
          await sleep(1200);
          const called = await fr.evaluate(() => { try { if (window.app_dlv11_grid && app_dlv11_grid.go_delivery) { app_dlv11_grid.go_delivery(); return true; } } catch (e) {} return false; }).catch(() => false);
          if (!called) await fr.locator('button:has-text("상품준비중 변경"), a:has-text("상품준비중 변경")').first().click({ timeout: 6000, force: true }).catch(() => {});
          log(`상품준비중 변경 호출(${called ? "go_delivery" : "버튼"}) — ${inReq.length}건 → dlv12 이동 대기`);
          await sleep(6000);
        }
      }
    } else log("dlv11 iframe 없음 — 출고처리(dlv12) 단계로 바로 진행");

    // ── Phase B: 출고처리(dlv12) — dlv_no 인라인 입력 + 출고완료
    await page.goto(EXPORT, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    await sleep(6000); await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
    let fx = getExportFrame(page); for (let i = 0; i < 10 && !fx; i++) { await sleep(1000); fx = getExportFrame(page); }
    if (!fx) { await alertGlobal(`🚨 무신사 글로벌: 출고처리(dlv12) iframe 없음 — 후보 ${pending.length}건 미처리, 파트너센터 수동확인 요망`); return { ok, skip }; }
    await fx.locator('button:has-text("검색")').filter({ hasNotText: "초기화" }).first().click({ timeout: 6000 }).catch(() => {});
    await sleep(6000);

    const exGrid = await readExportGrid(fx);
    log(`글로벌 출고처리(dlv12) 그리드 ${exGrid.length}건: ${exGrid.map((g) => g.ordNo || g.serial).join(",") || "-"}`);
    const targets = [], gone = [], already = [];
    for (const s of pending) {
      const g = exGrid.find((x) => x.ordNo === s.order_number || x.serial === s.order_number);
      if (!g) { gone.push(s); continue; }
      if (String(g.inv).trim()) { already.push({ s, inv: g.inv }); continue; }
      targets.push({ ...s, rowIdx: g.idx });
    }
    skip += gone.length + already.length;
    already.forEach((x) => log(`  ${x.s.order_number}: 이미 송장(${x.inv}) — 스킵`));
    gone.forEach((s) => log(`  ${s.order_number}(${s.recipient_name || ""}): 요청/처리 어디에도 없음(이미 출고/기간외) — 스킵`));
    // 최근 3일 내 접수분이 화면에 없으면 조용히 넘기지 않는다
    const recentGone = gone.filter((s) => s.registered_at && Date.now() - Date.parse(s.registered_at) < 3 * 86400000);
    if (recentGone.length) await alertGlobal(`⚠️ 무신사 글로벌: 최근 접수 ${recentGone.length}건(${recentGone.map((s) => s.order_number).join(", ")})이 출고요청/처리 화면에 없음 — 송장 미입력 가능성, 파트너센터 수동확인 요망`);
    if (!targets.length) { log("입력할 신규 글로벌 송장 없음"); return { ok, skip }; }
    if (opts.dryRun) { log(`[DRYRUN] dlv12 입력 대상 ${targets.length}건: ` + targets.map((t) => `${t.order_number}=${t.regi_no}`).join(", ")); return { ok: 0, skip, dryRun: targets.length }; }

    let filled = 0;
    for (const t of targets) {
      const cell = fx.locator(`.ag-row[row-index="${t.rowIdx}"] .ag-cell[col-id="dlv_no"]`).first();
      await cell.dblclick({ timeout: 5000 }).catch(() => {});
      await sleep(700);
      let editor = fx.locator('.ag-cell[col-id="dlv_no"] input, .ag-popup-editor input').first();
      if (!(await editor.count().catch(() => 0))) { await cell.click({ timeout: 4000 }).catch(() => {}); await sleep(600); editor = fx.locator('.ag-cell[col-id="dlv_no"] input, .ag-popup-editor input').first(); }
      if (!(await editor.count().catch(() => 0))) { log(`  ⚠️ ${t.order_number}: dlv_no 편집기 안 뜸 — 스킵`); continue; }
      await editor.fill(t.regi_no).catch(async () => { await editor.pressSequentially(t.regi_no, { delay: 20 }).catch(() => {}); });
      await editor.press("Enter").catch(() => {});
      await sleep(600);
      // 행 체크 — 숨김 커스텀 input 대비 JS 클릭 (29CM 개편과 동일 패턴)
      await fx.evaluate(({ idx }) => {
        const rows = [...document.querySelectorAll(`.ag-row[row-index="${idx}"]`)];
        const chk = rows.flatMap((r) => [...r.querySelectorAll('.ag-cell[col-id="chk"]')])[0];
        const inp = chk ? chk.querySelector("input") : null;
        if (inp && !inp.checked) inp.click(); else if (chk && !inp) chk.click();
      }, { idx: t.rowIdx }).catch(() => {});
      filled++;
      log(`  ✏️ ${t.order_number}: 송장 ${t.regi_no} 입력+체크`);
      await sleep(400);
    }
    if (!filled) { await alertGlobal(`🚨 무신사 글로벌: 대상 ${targets.length}건 모두 입력 실패(편집기 안 뜸) — UI 재변경 의심, 수동확인 요망`); return { ok, skip }; }

    const shipBtn = fx.locator('button:has-text("출고완료"), a:has-text("출고완료")').first();
    await shipBtn.click({ timeout: 6000 }).catch(async () => { await shipBtn.evaluate((el) => el.click()).catch(() => {}); });
    log("출고완료 클릭 (확인 dialog 자동수락)");
    await sleep(8000);

    // 검증: 재검색 후 대상이 목록에서 빠졌는지 확인해야 성공으로 센다
    await fx.locator('button:has-text("검색")').filter({ hasNotText: "초기화" }).first().click({ timeout: 5000 }).catch(() => {});
    await sleep(6000);
    const afterGrid = await readExportGrid(fx);
    for (const t of targets) {
      const still = afterGrid.find((x) => x.ordNo === t.order_number || x.serial === t.order_number);
      if (!still) { ok++; log(`  ✅ [글로벌] ${t.order_number}: 송장 ${t.regi_no} 출고완료 확인`); }
      else { skip++; log(`  ⚠️ ${t.order_number}: 출고완료 후에도 잔존(inv=${still.inv || "-"}) — 미완료`); }
    }
    if (ok < targets.length) await alertGlobal(`🚨 무신사 글로벌 송장입력 부분 실패: 대상 ${targets.length}건 중 ${ok}건만 완료 — 수동확인 요망`);
  } finally {
    await closeMarketplaceBrowsers().catch(() => {});
  }
  log(`무신사 글로벌 송장입력 완료: 성공 ${ok} / 스킵 ${skip}`);
  return { ok, skip };
}

module.exports = { dispatchMusinsaGlobal };

if (require.main === module) {
  dispatchMusinsaGlobal({ dryRun: process.env.MUSINSA_DISPATCH_DRYRUN === "1" })
    .then(() => process.exit(0))
    .catch((e) => { console.error("ERR", e.message); process.exit(1); });
}
