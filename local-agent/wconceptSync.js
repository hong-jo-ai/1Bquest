/**
 * W컨셉(newpin.wconcept.co.kr) 2계정 합산 매출 동기화.
 *
 * 계정별로: 로그인(ID/PW 타이핑 → WCKAuth.LoginSubmit, SHA256) → 팝업 /Auth/TwoFactorAuth
 * → '인증번호 발송' → 텔레그램으로 사장님께 코드 요청 → /api/marketplace/sms-code 폴링 →
 * #certiCode 타이핑 → #submit → 주문조회(LstOrderMaster) 검색 → '엑셀 다운로드'.
 * 두 계정 엑셀을 행 단위로 합쳐(xlsx) 하나로 만든 뒤 /api/marketplace/sync-ingest(channel=wconcept) 적재.
 *
 * SMS 인증 때문에 무인 불가 — 실행 시 사장님이 텔레그램으로 코드 2개를 'wc 123456' 형태로 전달해야 함.
 */
const os = require("os");
const path = require("path");
const fs = require("fs");
const XLSX = require("xlsx");
const { chromium } = require("playwright");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function env(n) { return process.env[n] || ""; }
function base() { return (env("DASHBOARD_URL") || "https://paulvice-dashboard.vercel.app").replace(/\/$/, ""); }

const ACCOUNTS = [
  { key: "1", id: env("WCONCEPT_ACCOUNT_1_ID"), pw: env("WCONCEPT_ACCOUNT_1_PW") },
  { key: "2", id: env("WCONCEPT_ACCOUNT_2_ID"), pw: env("WCONCEPT_ACCOUNT_2_PW") },
];

async function tg(msg) {
  const token = env("TELEGRAM_BOT_TOKEN"), chat = env("TELEGRAM_CHAT_ID");
  if (!token || !chat) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text: msg }),
  }).catch(() => {});
}

// after(ISO) 이후 새 SMS 코드를 최대 4분 폴링
async function pollSmsCode(afterTs) {
  const token = env("PAULWISE_MCP_TOKEN");
  for (let i = 0; i < 48; i++) {
    try {
      const r = await fetch(`${base()}/api/marketplace/sms-code?after=${encodeURIComponent(afterTs)}`, {
        headers: { "x-agent-token": token },
      });
      const j = await r.json().catch(() => ({}));
      if (j.code) return j.code;
    } catch { /* 재시도 */ }
    await sleep(5000);
  }
  return null;
}

async function loginWconcept(ctx, page, acc, log) {
  let popup = null;
  ctx.on("page", (p) => { popup = p; });

  await page.goto(env("WCONCEPT_LOGIN_URL"), { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(2500);

  if (!(await page.locator("#userid").count())) {
    log(`W컨셉 ${acc.key}번: 로그인 폼 없음 (이미 로그인 상태일 수 있음)`);
    return !/Auth\/Login/i.test(page.url());
  }

  const startTs = new Date().toISOString();
  await page.locator("#userid").click();
  await page.locator("#userid").pressSequentially(acc.id, { delay: 50 });
  await page.locator("#pw").click();
  await page.locator("#pw").pressSequentially(acc.pw, { delay: 60 });
  await sleep(400);
  await page.evaluate(() => window.WCKAuth.LoginSubmit());
  log(`W컨셉 ${acc.key}번(${acc.id}) 로그인 제출`);
  await sleep(5000);

  if (!popup) {
    const ps = ctx.pages().filter((p) => p !== page);
    popup = ps[ps.length - 1] || null;
  }
  if (!popup) { log(`W컨셉 ${acc.key}번: 인증 팝업을 찾지 못함`); return false; }
  await popup.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
  await sleep(1500);

  // 인증번호 발송 → SMS
  await popup.locator('button:has-text("인증번호 발송"), button:has-text("발송")').first()
    .click({ timeout: 8000 }).catch((e) => log(`발송 버튼 클릭 실패: ${e.message.slice(0, 40)}`));
  await tg(`🔐 W컨셉 ${acc.key}번 계정(${acc.id}) 인증발송했어요. 휴대폰 SMS를 'wc 코드'로 보내주세요.`);
  log(`W컨셉 ${acc.key}번: SMS 코드 대기 (텔레그램으로 'wc 코드' 전송 요망, 최대 4분)`);

  const code = await pollSmsCode(startTs);
  if (!code) { log(`W컨셉 ${acc.key}번: 인증번호 미수신 (시간초과)`); return false; }
  log(`W컨셉 ${acc.key}번: 인증번호 수신`);

  await popup.locator("#certiCode").click();
  await popup.locator("#certiCode").pressSequentially(code, { delay: 90 });
  await sleep(400);
  await popup.locator("#submit").click({ timeout: 6000 }).catch(() => {});
  await sleep(6000);
  await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});

  const ok = !/Auth\/Login/i.test(page.url());
  log(`W컨셉 ${acc.key}번: 인증 ${ok ? "성공" : "실패"} (${page.url()})`);
  return ok;
}

// W컨셉 주문조회 셀렉터 (확정·고정 — .env의 '#' 값은 dotenv가 주석처리하므로 코드에 박음)
const WC_ORDERS_URL = "https://newpin.wconcept.co.kr/Order/LstOrderMaster";
const WC_DATE_START = "#strfrom";
const WC_DATE_END = "#strto";
const WC_SEARCH = "#btnSearch";
const WC_DOWNLOAD = 'button:has-text("엑셀 다운로드")';

async function downloadWconcept(page, startDate, endDate, acc, log) {
  await page.goto(env("WCONCEPT_ORDERS_URL") || WC_ORDERS_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(4000);
  // 날짜 입력 (readonly 가능성 대비 evaluate로 값 설정 + change 트리거)
  await page.evaluate(({ s, e, ss, es }) => {
    const f = document.querySelector(ss), t = document.querySelector(es);
    if (f) { f.value = s; f.dispatchEvent(new Event("change", { bubbles: true })); }
    if (t) { t.value = e; t.dispatchEvent(new Event("change", { bubbles: true })); }
  }, { s: startDate, e: endDate, ss: WC_DATE_START, es: WC_DATE_END });
  await sleep(500);
  await page.locator(WC_SEARCH).click({ timeout: 10000 }).catch(() => {});
  await sleep(3000);
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

  const dir = path.join(os.tmpdir(), "paulvice-marketplace-downloads");
  fs.mkdirSync(dir, { recursive: true });
  const [dl] = await Promise.all([
    page.waitForEvent("download", { timeout: 120000 }),
    page.locator(WC_DOWNLOAD).first().click({ timeout: 30000 }),
  ]);
  const fp = path.join(dir, `${Date.now()}-wconcept-${acc.key}-${dl.suggestedFilename()}`);
  await dl.saveAs(fp);
  log(`W컨셉 ${acc.key}번: 엑셀 다운로드 완료 (${fp})`);
  return fp;
}

// 여러 엑셀을 행 단위로 합쳐 하나의 xlsx 버퍼로 (첫 파일 헤더 + 모든 데이터 행)
function combineXlsxFiles(filePaths) {
  let header = null;
  const dataRows = [];
  for (const fp of filePaths) {
    const wb = XLSX.read(fs.readFileSync(fp), { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
    if (!rows.length) continue;
    if (!header) header = rows[0];
    for (let i = 1; i < rows.length; i++) dataRows.push(rows[i]);
  }
  const all = header ? [header, ...dataRows] : dataRows;
  const outWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(outWb, XLSX.utils.aoa_to_sheet(all), "Sheet1");
  const buf = XLSX.write(outWb, { type: "buffer", bookType: "xlsx" });
  const outPath = path.join(os.tmpdir(), "paulvice-marketplace-downloads", "wconcept_combined.xlsx");
  fs.writeFileSync(outPath, buf);
  return { outPath, rowCount: dataRows.length };
}

async function ingestCombined(filePath, log) {
  const token = env("PAULWISE_MCP_TOKEN");
  const buffer = fs.readFileSync(filePath);
  const form = new FormData();
  // 채널 고정 파일명 → 매 실행 교체(중복 누적 없음)
  form.append("file", new Blob([buffer]), "wconcept_combined.xlsx");
  const res = await fetch(`${base()}/api/marketplace/sync-ingest?channel=wconcept`, {
    method: "POST", headers: { "x-agent-token": token }, body: form,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) throw new Error(json.error || `적재 실패 (HTTP ${res.status})`);
  log(`W컨셉 대시보드 적재 완료: ${json.rowCount}건 (${json.period?.start}~${json.period?.end})`);
  return json;
}

async function syncWconcept({ startDate, endDate }, log) {
  for (const a of ACCOUNTS) {
    if (!a.id || !a.pw) throw new Error(`W컨셉 ${a.key}번 계정 ID/PW 미설정`);
  }
  const files = [];
  for (const acc of ACCOUNTS) {
    const profileDir = path.join(os.homedir(), ".paulvice-marketplace-agent", `wconcept_${acc.key}`);
    fs.mkdirSync(profileDir, { recursive: true });
    const ctx = await chromium.launchPersistentContext(profileDir, {
      headless: false, channel: "chrome", acceptDownloads: true, locale: "ko-KR", viewport: null,
      args: ["--disable-blink-features=AutomationControlled", "--start-maximized", "--lang=ko-KR"],
      ignoreDefaultArgs: ["--enable-automation"],
    });
    try {
      const page = ctx.pages()[0] || (await ctx.newPage());
      const ok = await loginWconcept(ctx, page, acc, log);
      if (!ok) throw new Error(`W컨셉 ${acc.key}번 로그인/인증 실패`);
      files.push(await downloadWconcept(page, startDate, endDate, acc, log));
    } finally {
      await ctx.close().catch(() => {});
    }
  }
  const { outPath, rowCount } = combineXlsxFiles(files);
  log(`두 계정 합산: 데이터 ${rowCount}행 → ${outPath}`);
  const result = await ingestCombined(outPath, log);
  return { success: true, channel: "wconcept", combinedRows: rowCount, ...result };
}

module.exports = { syncWconcept };
