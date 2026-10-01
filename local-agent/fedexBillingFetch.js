/**
 * 페덱스 Billing Online 청구 내역 자동 다운로드 → `다운로드/페덱스청구/` 저장 → fedexInvoiceImport.js 로 적재.
 *
 * 사장님 지시(2026-10-01): "한 달에 한 번 페덱스에 들어가서 보고서를 받아 데이터를 업데이트해 줘. 로그인 정보는 .env 에 넣어 둘게."
 * 로그인 정보 = local-agent/.env 의 FEDEX_WEB_USER / FEDEX_WEB_PW (코드·로그·메모리에 값을 남기지 말 것).
 *
 * 동작(전용 상시 창 CDP 9351, fedexBrowser.js):
 *   1) 청구서 화면을 연다. 로그인 화면이면 쿠키 배너를 "필수 외 거부"로 닫고 **한 번만** 로그인한다.
 *   2) 화면이 쓰는 내부 API 를 같은 세션으로 부른다(버튼을 누르는 것보다 화면 개편에 덜 깨진다):
 *        POST api.fedex.com/bill/v1/accounts/invoices/retrieve   청구서 목록(미결제+종결)
 *        POST api.fedex.com/bill/v1/reports                      엑셀(전체 열) 보고서 생성 → reportId
 *        POST api.fedex.com/bill/v1/reports/retrieve             생성 상태(PENDING → COMPLETED)
 *        POST www.fedex.com/bill/v1/documents/reports/download   파일 받기
 *   3) 저장한 엑셀을 fedexInvoiceImport.js 가 읽어 kv 에 쌓고 텔레그램 요약을 보낸다.
 *
 * 🔴 계정 잠금 방지 — 마켓에서 자동 로그인으로 잠긴 선례가 있다:
 *   - 로그인은 실행당 1회. 실패하면(비밀번호 오류·인증 코드 요구·알 수 없는 화면) **재시도하지 않고** 텔레그램으로 알린 뒤
 *     상태 파일에 실패를 남긴다. 실패가 남아 있으면 다음 실행은 로그인하지 않는다 → 사장님이 창에서 직접 로그인하거나 `--force`.
 *   - 비밀번호는 주소가 정확히 www.fedex.com/secure-login 일 때만 입력한다.
 *
 * 실행: node fedexBillingFetch.js           (launchd: 매월 9일·24일 10:20)
 *       node fedexBillingFetch.js --force   지난 로그인 실패 기록을 무시하고 시도
 *       node fedexBillingFetch.js --no-import 저장만 하고 적재는 건너뜀
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
require("dotenv").config({ path: path.join(__dirname, ".env"), override: true });
const { openFedex } = require("./fedexBrowser");
const { relayText } = require("./telegramRelay");
const { beat } = require("./heartbeat");

const ARGV = process.argv.slice(2);
const FORCE = ARGV.includes("--force");
const ACCOUNT = process.env.FEDEX_ACCOUNT_NUMBER || "208162184";
const FOLDER = "/Users/mac/Library/CloudStorage/GoogleDrive-shong@harriotwatches.com/공유 드라이브/다운로드/페덱스청구";
const STATE = path.join(os.homedir(), ".paulvice-marketplace-agent", "fedex-login-state.json");
const START = "https://www.fedex.com/online/billing/cbs/invoices";
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readState = () => { try { return JSON.parse(fs.readFileSync(STATE, "utf8")); } catch { return {}; } };
const writeState = (s) => { fs.mkdirSync(path.dirname(STATE), { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(s, null, 1)); };
const onLogin = (u) => { try { const x = new URL(u); return x.hostname === "www.fedex.com" && x.pathname.startsWith("/secure-login"); } catch { return false; } };
const onBilling = (u) => /^https:\/\/www\.fedex\.com\/online\/billing\//.test(u);

class Stop extends Error {} // 재시도하면 안 되는 중단(로그인 문제)

async function ensureLogin(page) {
  await page.goto(START, { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(8000);
  if (onBilling(page.url())) { log("세션 유효 — 로그인 건너뜀"); return; }
  if (!onLogin(page.url())) throw new Stop(`예상 밖 화면: ${page.url().slice(0, 120)}`);

  const st = readState();
  if (st.lastResult === "fail" && !FORCE) throw new Stop(`지난 로그인 실패(${st.lastAttempt})가 남아 있어 자동 로그인을 하지 않습니다. 전용 창에서 직접 로그인하거나 --force 로 실행하세요.`);
  const user = process.env.FEDEX_WEB_USER, pw = process.env.FEDEX_WEB_PW;
  if (!user || !pw) throw new Stop("local-agent/.env 에 FEDEX_WEB_USER / FEDEX_WEB_PW 가 없습니다.");

  // 쿠키 배너가 입력란을 가린다 — 필수 외 쿠키는 거부
  await page.evaluate(() => { const h = document.querySelector("#usercentrics-cmp-ui"); const r = h && (h.shadowRoot || h); const d = r && r.querySelector("#deny"); if (d) d.click(); }).catch(() => {});
  await sleep(1500);
  if (!onLogin(page.url())) throw new Stop("로그인 화면이 아닌데 입력하려 했다 — 중단");

  log("로그인 1회 시도");
  writeState({ lastAttempt: new Date().toISOString(), lastResult: "fail" }); // 성공해야 ok 로 바꾼다(중간에 죽어도 재시도 안 하게)
  await page.click("#username", { timeout: 10000 }); await page.keyboard.type(user, { delay: 70 });
  await page.click("#password", { timeout: 10000 }); await page.keyboard.type(pw, { delay: 70 });
  await sleep(600);
  await page.click("#login_button", { timeout: 10000 });
  for (let i = 0; i < 30 && !onBilling(page.url()); i++) await sleep(1000);
  if (!onBilling(page.url())) {
    const text = (await page.evaluate(() => document.body.innerText).catch(() => "")).replace(/\s+/g, " ").slice(0, 300);
    throw new Stop(`로그인 후 청구 화면에 못 들어갔습니다(인증 코드·비밀번호 오류 가능). 화면: ${text}`);
  }
  writeState({ lastAttempt: new Date().toISOString(), lastResult: "ok" });
  log("로그인 성공");
  await sleep(6000);
}

async function main() {
  const fx = await openFedex(log);
  const page = fx.page;
  try {
    // 화면이 API 를 부를 때 쓰는 인증 헤더를 그대로 빌린다(토큰은 화면이 발급받은 것 — 따로 저장하지 않는다)
    let hdr = null;
    page.on("request", (r) => { if (!hdr && /api\.fedex\.com\/bill\//.test(r.url())) { const h = r.headers(); if (h.authorization) hdr = { authorization: h.authorization, "x-clientid": h["x-clientid"] || "CBS", "content-type": "application/json" }; } });
    await ensureLogin(page);
    for (let i = 0; i < 20 && !hdr; i++) await sleep(1000);
    if (!hdr) { await page.reload({ waitUntil: "domcontentloaded" }); for (let i = 0; i < 20 && !hdr; i++) await sleep(1000); }
    if (!hdr) throw new Error("청구 화면의 API 인증 헤더를 잡지 못했습니다(화면 구조 변경 가능)");

    const call = (url, body) => page.evaluate(async ({ url, body, hdr }) => {
      const r = await fetch(url, { method: "POST", headers: { ...hdr, "x-client-transaction-id": crypto.randomUUID() }, body: JSON.stringify(body), credentials: "include" });
      return { status: r.status, text: await r.text() };
    }, { url, body, hdr });
    const api = async (pathname, body) => {
      const r = await call("https://api.fedex.com" + pathname, body);
      if (r.status !== 200) throw new Error(`${pathname} ${r.status} ${r.text.slice(0, 200)}`);
      return JSON.parse(r.text);
    };

    // 1) 청구서 목록 — 미결제 + 종결. 보고서 한 번에 100장까지라 최근 것부터 자른다(적재는 중복을 걸러낸다).
    const list = await api("/bill/v1/accounts/invoices/retrieve", { accountNumber: ACCOUNT, payerAccountNumbers: [ACCOUNT], pageCriteria: { cursor: 0, pageSize: 250 }, invoiceStatus: ["OPEN", "OPEN_DISPUTE", "PAST_DUE", "PAST_DUE_DISPUTE", "CLOSED"], processingOption: "INVOICE_LIST" });
    const invoices = (list.invoices || []).sort((a, b) => String(b.invoiceDate.raw).localeCompare(String(a.invoiceDate.raw))).slice(0, 100);
    if (!invoices.length) throw new Error("청구서 목록이 비어 있습니다");
    log(`청구서 ${invoices.length}장 (${invoices[invoices.length - 1].invoiceDate.raw} ~ ${invoices[0].invoiceDate.raw})`);

    // 2) 엑셀(전체 열) 보고서 생성
    const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).replace(/[-: ]/g, "").slice(0, 12);
    const reportName = `pv_auto_${stamp}`;
    const made = await api("/bill/v1/reports", {
      accountNumber: ACCOUNT,
      accountInvoices: invoices.map((i) => ({ payerAccountNumber: i.payerAccountNumber, invoice: i.invoice, settlementType: i.settlementTypeCode })),
      reportDataSet: "INVOICE", reportFilter: { payerAccountNumbers: [], invoiceStatus: "ALL", paymentStatus: "ALL" },
      reportType: "XLSX", columnsTemplateId: "STD_ALL_COLS", reportName,
    });
    if (!made.reportId) throw new Error(`보고서 생성 응답에 reportId 없음: ${JSON.stringify(made).slice(0, 200)}`);
    log(`보고서 생성 요청 ${made.reportId} (${reportName})`);

    // 3) 완료까지 기다림(보통 1분 안쪽)
    let status = "";
    for (let i = 0; i < 40; i++) {
      await sleep(10000);
      const r = await api("/bill/v1/reports/retrieve", { accountNumber: ACCOUNT });
      status = ((r.reportDetails || []).find((x) => String(x.reportId) === String(made.reportId)) || {}).status || "";
      if (status === "COMPLETED") break;
      if (/FAIL|ERROR/i.test(status)) throw new Error(`보고서 생성 실패 상태: ${status}`);
    }
    if (status !== "COMPLETED") throw new Error(`보고서가 7분 안에 완성되지 않았습니다(마지막 상태 ${status || "없음"})`);

    // 4) 내려받아 저장
    const b64 = await page.evaluate(async ({ body, hdr }) => {
      const r = await fetch("https://www.fedex.com/bill/v1/documents/reports/download", { method: "POST", headers: { ...hdr, "x-client-transaction-id": crypto.randomUUID() }, body: JSON.stringify(body), credentials: "include" });
      if (r.status !== 200) return "ERR " + r.status;
      const buf = new Uint8Array(await r.arrayBuffer()); let s = ""; for (let i = 0; i < buf.length; i += 8192) s += String.fromCharCode.apply(null, buf.subarray(i, i + 8192)); return btoa(s);
    }, { body: { accountNumber: ACCOUNT, documentId: String(made.reportId) }, hdr });
    if (b64.startsWith("ERR")) throw new Error(`파일 내려받기 실패 ${b64}`);
    const bin = Buffer.from(b64, "base64");
    if (bin.slice(0, 2).toString() !== "PK") throw new Error("내려받은 파일이 엑셀 형식이 아닙니다");
    fs.mkdirSync(FOLDER, { recursive: true });
    const out = path.join(FOLDER, `페덱스청구내역_자동_${stamp.slice(0, 8)}_${stamp.slice(8)}.xlsx`); // 사장님이 넣은 파일과 이름이 겹치지 않게
    fs.writeFileSync(out, bin);
    log(`저장: ${out} (${bin.length.toLocaleString()} bytes)`);

    // 5) 적재(폴더 스캔 방식 — 새 행이 있으면 요약 텔레그램이 나간다)
    if (!ARGV.includes("--no-import")) {
      const o = execFileSync(process.execPath, [path.join(__dirname, "fedexInvoiceImport.js")], { cwd: __dirname, encoding: "utf8", timeout: 120000 });
      o.trim().split("\n").forEach((l) => log("  [적재] " + l.replace(/^\[[^\]]+\]\s*/, "")));
    }
    await beat("fedex-billing-fetch", { invoices: invoices.length, file: path.basename(out) });
  } finally {
    await fx.release();
  }
}

// ⚠️ 문법검사로 require 만 해도 실제 다운로드가 돌지 않게(2026-10-01 실제로 한 번 돌았다 — fedexLabelWatch 9/30 과 같은 실수)
if (require.main !== module) { module.exports = {}; return; }

main().catch(async (e) => {
  const msg = (e && e.message) || String(e);
  log(`실패: ${msg}`);
  await relayText(`🔴 페덱스 청구 내역 자동 다운로드 실패\n${msg.slice(0, 500)}\n\n${e instanceof Stop ? "재시도하지 않습니다. 아이맥의 페덱스 전용 크롬 창에서 직접 로그인해 두면 다음 실행부터 이어집니다." : "다음 예정 실행에서 다시 시도합니다."} 급하면 엑셀을 직접 받아 「다운로드/페덱스청구」에 넣어 주세요.`);
  process.exitCode = 1;
});
