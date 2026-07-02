/**
 * W컨셉 CS 동기화 — 반품/교환 클레임을 CS 인박스로 보냄.
 * 소스: 교환/반품 접수 내역(OrderReturnManageShipping?type=return|exchange). 로그인(SMS 자동) 후 그리드 파싱.
 * 회수는 W컨셉 계약배송사 자동 진행 — 우리는 신청정보 기록 후, 택배 도착하면 인박스에서 '회수완료'(write-back).
 *
 * ⚠️ W컨셉 그리드는 헤더/데이터 열 어긋남 → 데이터행 td 인덱스로 파싱(검증된 매핑):
 *   [2]접수일 [3]주문번호(Z..) [4]주문상태 [6]수취인 [9]택배사 [10]반송장 [17]클레임사유 [21]상품명 [22]옵션
 */
require("dotenv").config({ override: true });
const os = require("os"), path = require("path");
const { chromium } = require("playwright");
const { loginWconcept, ACCOUNTS } = require("./wconceptSync");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
function env(n) { return process.env[n] || ""; }
function base() { return (env("DASHBOARD_URL") || "https://paulvice-dashboard.vercel.app").replace(/\/$/, ""); }

// W컨셉 주문상태 → CS 라이프사이클. 반품처리중/접수=requested(처리필요), 완료=done, 취소/반려=rejected.
function mapStatus(s) {
  const t = String(s || "").replace(/\s+/g, "");
  if (/완료/.test(t)) return "done";
  if (/취소|반려|거부/.test(t)) return "rejected";
  return "requested"; // 반품처리중/반품접수 등 진행중
}

async function scrapeClaims(page, claimType, log) {
  const url = `https://newpin.wconcept.co.kr/Order/OrderReturnManageShipping?type=${claimType === "exchange" ? "exchange" : "return"}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  await sleep(5000); await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
  return await page.evaluate((ct) => {
    const out = [];
    const trs = [...document.querySelectorAll("tr")].filter((tr) => tr.querySelector("input[type=checkbox]") && /\bZ\d{5,}\b/.test(tr.innerText || ""));
    for (const tr of trs) {
      const c = [...tr.querySelectorAll("td")].map((td) => (td.innerText || "").replace(/\s+/g, " ").trim());
      const order = (c[3] || "").match(/Z\d{5,}/)?.[0] || c[3];
      if (!order) continue;
      out.push({
        orderNumber: order,
        statusText: c[4] || "",
        customerName: c[6] || c[5] || "",
        product: (c[21] || "") + (c[22] ? " " + c[22] : ""),
        reason: c[17] || "",
        recoveryTrackingNo: (c[10] || "").replace(/\D/g, "") || "",
        receivedAt: c[8] || "",     // 반입완료일(회수 도착)
        acceptedAt: c[2] || "",     // 접수일
        claimType: ct,
      });
    }
    return out;
  }, claimType);
}

(async () => {
  log("=== W컨셉 CS 동기화 시작 ===");
  const acc = ACCOUNTS[0];
  const profileDir = path.join(os.homedir(), ".paulvice-marketplace-agent", `wconcept_${acc.key}`);
  const ctx = await chromium.launchPersistentContext(profileDir, {
    headless: false, channel: "chrome", acceptDownloads: true, locale: "ko-KR", viewport: null,
    args: ["--disable-blink-features=AutomationControlled", "--start-maximized", "--lang=ko-KR"],
    ignoreDefaultArgs: ["--enable-automation"],
  });
  ctx.on("page", (p) => p.on("dialog", (d) => d.accept().catch(() => {})));
  const claims = [];
  try {
    const page = ctx.pages()[0] || (await ctx.newPage());
    page.on("dialog", (d) => d.accept().catch(() => {}));
    await page.goto("https://newpin.wconcept.co.kr/Order/OrderReturnManageShipping?type=return", { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    await sleep(3000);
    if (/Auth\/Login/i.test(page.url())) { if (!(await loginWconcept(ctx, page, acc, log))) throw new Error("W컨셉 로그인 실패"); }

    for (const ct of ["return", "exchange"]) {
      const rows = await scrapeClaims(page, ct, log);
      for (const r of rows) {
        claims.push({
          channel: "wconcept",
          orderNumber: r.orderNumber,
          claimType: ct,
          status: mapStatus(r.statusText),
          product: r.product,
          reason: r.reason,
          customerName: r.customerName,
          recoveryTrackingNo: r.recoveryTrackingNo,
          requestedAt: /\d{4}-\d{2}-\d{2}/.test(r.acceptedAt) ? `${r.acceptedAt}T00:00:00+09:00` : undefined,
          raw: { statusText: r.statusText, receivedAt: r.receivedAt, tracking: r.recoveryTrackingNo },
        });
      }
      log(`W컨셉 ${ct} ${rows.length}건`);
    }
  } finally { await ctx.close().catch(() => {}); }

  if (!claims.length) { log("클레임 없음"); return; }
  const res = await fetch(`${base()}/api/cs/ingest/sixshop-returns`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-agent-token": env("PAULWISE_MCP_TOKEN") },
    body: JSON.stringify({ claims }),
  });
  log(`반품 적재: ${JSON.stringify(await res.json().catch(() => ({})))}`);
  await require("./heartbeat").beat("wconcept-cs-sync");
  log("=== 완료 ===");
})().catch(async (e) => { console.error("ERR", e); try { await require("./notifyFail").notifyFail("W컨셉 CS 동기화", e && e.message ? e.message : String(e)); } catch (_) {} process.exit(1); });
