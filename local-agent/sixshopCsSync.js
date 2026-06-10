/**
 * 식스샵 CS 동기화 — 반품/교환/취소 클레임을 CS 인박스로 보냄.
 * 소스: 식스샵 국내 export 의 '주문 상태' 컬럼(반품 요청/반품 수거 중/완료 등). export를 새로 받아 파싱.
 * (문의/게시판은 위치 확정 후 별도 추가)
 *
 * 흐름: refreshSixshopOutbound()로 최신 export 다운 → 클레임 행 파싱 → POST /api/cs/ingest/sixshop-returns.
 * 서버가 멱등 upsert(활성=요청·수거중 생성/갱신, 완료/거부는 기존건만 갱신).
 */
require("dotenv").config({ override: true });
const fs = require("fs"), path = require("path"), os = require("os");
const XLSX = require("xlsx");
const { chromium } = require("playwright");
const { refreshSixshopOutbound } = require("./sixshopOutboundExport");
const { loginSixshop, ensureStore } = require("./sixshopSync");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
function env(n) { return process.env[n] || ""; }
function base() { return (env("DASHBOARD_URL") || "https://paulvice-dashboard.vercel.app").replace(/\/$/, ""); }
const clean = (v) => { const s = String(v ?? "").trim(); return s === "-" ? "" : s; };

// 식스샵 '주문 상태' → { claimType, status }. 활성=요청/수거중, 완료/거부=done/rejected. '(네이버페이 주문형)' 접미 무시.
function mapClaim(statusText) {
  const s = String(statusText || "").replace(/\(네이버페이[^)]*\)/g, "").replace(/\s+/g, " ").trim();
  if (/취소\s*요청/.test(s)) return { claimType: "cancel", status: "requested" };
  if (/취소\s*완료/.test(s)) return { claimType: "cancel", status: "done" };
  if (/취소\s*거부|취소\s*반려/.test(s)) return { claimType: "cancel", status: "rejected" };
  if (/반품\s*요청/.test(s)) return { claimType: "return", status: "requested" };
  if (/반품\s*수거/.test(s)) return { claimType: "return", status: "in_transit" };
  if (/반품\s*완료/.test(s)) return { claimType: "return", status: "done" };
  if (/반품\s*거부|반품\s*반려/.test(s)) return { claimType: "return", status: "rejected" };
  if (/교환\s*요청/.test(s)) return { claimType: "exchange", status: "requested" };
  if (/교환\s*수거/.test(s)) return { claimType: "exchange", status: "in_transit" };
  if (/교환\s*완료|교환\s*재배송/.test(s)) return { claimType: "exchange", status: "done" };
  if (/교환\s*거부|교환\s*반려/.test(s)) return { claimType: "exchange", status: "rejected" };
  return null; // 일반 주문상태(결제완료/배송중 등)
}

function latestExport() {
  const dir = path.join(os.tmpdir(), "paulvice-marketplace-downloads");
  if (!fs.existsSync(dir)) return null;
  const cands = fs.readdirSync(dir).filter((x) => x.includes("국내") && /\.xlsx$/.test(x))
    .map((x) => ({ x, m: fs.statSync(path.join(dir, x)).mtimeMs })).sort((a, b) => b.m - a.m);
  return cands.length ? path.join(dir, cands[0].x) : null;
}

function parseClaims(file) {
  const wb = XLSX.readFile(file);
  const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
  const C = { name: 0, order: 6, status: 8, pname: 47 };
  const out = [];
  for (let i = 1; i < data.length; i++) {
    const m = mapClaim(data[i][C.status]);
    if (!m) continue;
    out.push({
      orderNumber: clean(data[i][C.order]),
      claimType: m.claimType,
      status: m.status,
      product: clean(data[i][C.pname]),
      customerName: clean(data[i][C.name]),
      raw: { statusText: clean(data[i][C.status]) },
    });
  }
  return out.filter((c) => c.orderNumber);
}

// "2026.05.19 14:17" → ISO(KST). 실패 시 now.
function parseKst(s) {
  const m = String(s || "").match(/(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})/);
  if (!m) return new Date().toISOString();
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+09:00`;
}

// 문의하기 게시판(board-productQna) 목록 enumerate → 각 확인하기 모달에서 질문/답변 추출.
async function scrapeInquiries(log) {
  const profileDir = path.join(os.homedir(), ".paulvice-marketplace-agent", "sixshop");
  const ctx = await chromium.launchPersistentContext(profileDir, {
    headless: false, channel: "chrome", locale: "ko-KR", viewport: null,
    args: ["--disable-blink-features=AutomationControlled", "--start-maximized", "--lang=ko-KR"],
    ignoreDefaultArgs: ["--enable-automation"],
  });
  ctx.on("page", (p) => p.on("dialog", (d) => d.accept().catch(() => {})));
  const out = [];
  try {
    const page = ctx.pages()[0] || (await ctx.newPage());
    if (!(await loginSixshop(page, log))) throw new Error("식스샵 로그인 실패");
    await ensureStore(page, "harriotwatches", log);
    await page.goto("https://www.sixshop.com/dashboard/board-productQna", { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    await sleep(6000); await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});

    const n = await page.evaluate(() => [...document.querySelectorAll("button,a")].filter((b) => /확인하기/.test(b.innerText || "")).length);
    const limit = Math.min(n, Number(process.env.SIXSHOP_QNA_LIMIT || 15));
    log(`문의 게시판 ${n}건 (최근 ${limit}건 처리)`);

    for (let i = 0; i < limit; i++) {
      // i번째 확인하기 클릭 → 모달
      const rowText = await page.evaluate((idx) => {
        const b = [...document.querySelectorAll("button,a")].filter((x) => /확인하기/.test(x.innerText || ""))[idx];
        if (!b) return null;
        let row = b; for (let k = 0; k < 8; k++) { if (row.parentElement && (row.parentElement.innerText || "").length < 400) row = row.parentElement; else break; }
        b.click();
        return (row.innerText || "").replace(/\s+/g, " ").trim();
      }, i);
      if (!rowText) continue;
      await sleep(2500);
      const modalText = await page.evaluate(() => {
        const m = [...document.querySelectorAll("*")].find((e) => /게시글\s*확인하기/.test(e.textContent || "") && e.getBoundingClientRect().width > 300 && e.getBoundingClientRect().width < 1000);
        return m ? (m.innerText || "").replace(/\s+/g, " ").trim() : "";
      });
      // 모달 닫기 (X 또는 Esc)
      await page.evaluate(() => { const x = document.querySelector(".ico-close-line, [data-dialog-close]"); if (x) x.click(); }).catch(() => {});
      await page.keyboard.press("Escape").catch(() => {});
      await sleep(800);

      // 파싱: 목록행에서 제목/이메일/날짜/답변수, 모달에서 질문본문/답변
      const email = (rowText.match(/[\w.+-]+@[\w.-]+/) || [""])[0];
      const dateStr = (rowText.match(/\d{4}\.\d{2}\.\d{2}\s+\d{2}:\d{2}/) || [""])[0];
      const replyCount = Number((rowText.match(/\((\d+)\)/) || [, "0"])[1]);
      const title = rowText.replace(/\s*\(\d+\).*$/, "").trim();
      const author = email ? (rowText.split(email)[0].trim().split(" ").pop() || "") : "";
      // 모달: 날짜 뒤 ~ '댓글' 전 = 질문본문, 마지막 '삭제하기' 뒤 = 최신 답변
      let questionBody = "", answerBody = "";
      if (modalText) {
        const afterDate = dateStr && modalText.includes(dateStr) ? modalText.split(dateStr).slice(1).join(dateStr) : modalText;
        questionBody = afterDate.split(/댓글\s*\(/)[0].replace(/^[\s/]+/, "").trim();
        if (/삭제하기/.test(modalText)) answerBody = modalText.split("삭제하기").pop().trim();
      }
      const extId = `qna:${email || author}:${dateStr.replace(/[^\d]/g, "")}`;
      out.push({
        externalThreadId: extId, customerName: author, email, subject: title,
        askedAt: parseKst(dateStr), questionBody: questionBody || title,
        answers: replyCount > 0 ? [{ body: answerBody || "[답변 등록됨]", answeredAt: undefined }] : [],
      });
    }
  } finally { await ctx.close().catch(() => {}); }
  return out;
}

(async () => {
  log("=== 식스샵 CS 동기화 시작 ===");
  // 최신 export 확보 (실패 시 직전 export 사용)
  try { await refreshSixshopOutbound(); } catch (e) { log("export 갱신 실패(직전 export 사용): " + e.message); }
  const file = latestExport();
  if (!file) { log("식스샵 export 없음 — 중단"); return; }
  const claims = parseClaims(file);
  const act = claims.filter((c) => c.status === "requested" || c.status === "in_transit").length;
  log(`클레임 ${claims.length}건 파싱 (활성 ${act}) — ${file.split("/").pop()}`);
  if (!claims.length) { log("클레임 없음"); return; }

  const res = await fetch(`${base()}/api/cs/ingest/sixshop-returns`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-agent-token": env("PAULWISE_MCP_TOKEN") },
    body: JSON.stringify({ claims }),
  });
  const j = await res.json().catch(() => ({}));
  log(`반품 적재: ${JSON.stringify(j)}`);

  // 2) 문의 게시판 (SIXSHOP_CS_SKIP_QNA=1 이면 생략)
  if (env("SIXSHOP_CS_SKIP_QNA") !== "1") {
    try {
      const inquiries = await scrapeInquiries(log);
      const unanswered = inquiries.filter((q) => !q.answers.length).length;
      log(`문의 ${inquiries.length}건 (미답변 ${unanswered})`);
      if (inquiries.length) {
        const r2 = await fetch(`${base()}/api/cs/ingest/sixshop-inquiry`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-agent-token": env("PAULWISE_MCP_TOKEN") },
          body: JSON.stringify({ inquiries }),
        });
        log(`문의 적재: ${JSON.stringify(await r2.json().catch(() => ({})))}`);
      }
    } catch (e) { log("문의 수집 실패: " + e.message); }
  }
  log("=== 완료 ===");
})().catch((e) => { console.error("ERR", e); process.exit(1); });
