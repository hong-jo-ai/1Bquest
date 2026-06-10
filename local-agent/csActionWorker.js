/**
 * CS 액션 워커 (iMac 상주, launchd KeepAlive). 브라우저 자동화가 필요한 마켓 CS 처리 전담.
 * 배포 서버가 kv_store 에 'cs_action_job:<id>'(pending) 적재 → 이 워커가 폴링해 식스샵에서 실제 액션
 * (문의 게시판 댓글 / 반품·교환 수락·회수도착) 후 결과를 같은 row 에 done/error 로 기록.
 * (우체국 register 큐 워커와 별개 — 그쪽은 무브라우저.)
 *
 * 실행: node csActionWorker.js  (launchd com.paulvice.cs-action 가 상주 유지)
 */
const fs = require("fs"), path = require("path"), os = require("os");
const DASH = "/Users/mac/sungjo_ai/paulwise-dashboard";
function loadEnv(p){ try { for(const l of fs.readFileSync(p,"utf8").split("\n")){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);if(!m)continue;let v=m[2].trim().replace(/^["']|["']$/g,"");if(!(m[1] in process.env))process.env[m[1]]=v;} } catch {} }
require("dotenv").config({ override: true });
loadEnv(path.join(DASH, ".env.supabase")); loadEnv(path.join(DASH, ".env.local"));
const { createClient } = require(path.join(DASH, "node_modules/@supabase/supabase-js"));
const { chromium } = require("playwright");
const { loginSixshop, ensureStore } = require("./sixshopSync");
const { loginWconcept, ACCOUNTS: WC_ACCOUNTS } = require("./wconceptSync");

const PREFIX = "cs_action_job:";
const POLL_MS = 4000;
const CLEANUP_MS = 30 * 60 * 1000;
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function writeJob(job, patch) {
  const next = { ...job, ...patch, updatedAt: new Date().toISOString() };
  await sb.from("kv_store").upsert({ key: PREFIX + job.id, data: next, updated_at: next.updatedAt }, { onConflict: "key" });
  return next;
}

// ── 식스샵 문의 게시판 댓글 답변 ──
async function doSixshopReply(page, p) {
  await page.goto("https://www.sixshop.com/dashboard/board-productQna", { waitUntil: "domcontentloaded", timeout: 60000 }).catch(()=>{});
  await sleep(5000); await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(()=>{});
  // 이메일(+제목) 매칭 행의 '확인하기' 클릭
  const opened = await page.evaluate(({ email, title }) => {
    const btns = [...document.querySelectorAll("button,a")].filter((x) => /확인하기/.test(x.innerText || ""));
    for (const b of btns) {
      let row = b; for (let i=0;i<8;i++){ if(row.parentElement && (row.parentElement.innerText||"").length<500) row=row.parentElement; else break; }
      const txt = row.innerText || "";
      if ((email && txt.includes(email)) || (title && txt.includes(title.slice(0, 12)))) { b.click(); return true; }
    }
    return false;
  }, p);
  if (!opened) throw new Error("문의 글을 게시판에서 못 찾음(목록 1페이지)");
  await sleep(3000);
  // 모달 textarea 에 답변 입력
  const typed = await page.evaluate((body) => {
    const m = [...document.querySelectorAll("*")].find((e)=>/게시글\s*확인하기/.test(e.textContent||"") && e.getBoundingClientRect().width>300 && e.getBoundingClientRect().width<1000);
    if (!m) return false;
    const ta = m.querySelector("textarea");
    if (!ta) return false;
    ta.focus(); ta.value = body; ta.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }, p.body);
  if (!typed) throw new Error("답변 입력칸(textarea) 못 찾음");
  await sleep(800);
  if (process.env.CS_ACTION_DRYRUN === "1") { return { posted: false, dryRun: true }; } // 입력(찾기+타이핑)까지만, 실제 등록 안 함
  // '댓글 쓰기' 클릭 (모달 내 보이는 버튼)
  const clicked = await page.evaluate(() => {
    const m = [...document.querySelectorAll("*")].find((e)=>/게시글\s*확인하기/.test(e.textContent||"") && e.getBoundingClientRect().width>300 && e.getBoundingClientRect().width<1000);
    const b = m && [...m.querySelectorAll("button")].find((x)=>/댓글\s*쓰기/.test(x.innerText||"") && x.getBoundingClientRect().height>0);
    if (b) { b.click(); return true; }
    return false;
  });
  if (!clicked) throw new Error("'댓글 쓰기' 버튼 못 찾음");
  await sleep(3500); await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(()=>{});
  // 검증: 모달에 방금 단 답변 텍스트가 보이면 성공
  const ok = await page.evaluate((body) => {
    const m = [...document.querySelectorAll("*")].find((e)=>/게시글\s*확인하기/.test(e.textContent||"") && e.getBoundingClientRect().width>300 && e.getBoundingClientRect().width<1000);
    return !!(m && (m.innerText||"").includes(body.slice(0, 15)));
  }, p.body);
  if (!ok) throw new Error("댓글 등록 확인 실패(반영 안 됨)");
  return { posted: true };
}

// ── 식스샵 반품/교환/취소 클레임 처리: 주문목록 체크박스 → 툴바 버튼(예 '수거 완료 처리') → 확인 ──
// (발송처리와 동일 메커니즘 — 검증됨. payload: { orderNumber, buttonText })
async function doSixshopClaim(page, p) {
  if (!p.orderNumber || !p.buttonText) throw new Error("orderNumber/buttonText 필요");
  await page.goto("https://www.sixshop.com/dashboard/shop-orders", { waitUntil: "domcontentloaded", timeout: 60000 }).catch(()=>{});
  await sleep(5000); await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(()=>{});
  // 주문 행 체크박스 클릭(라벨 경유) — 발송처리와 동일
  const chk = await page.evaluate((order) => {
    const node = [...document.querySelectorAll("*")].find((e) => e.children.length === 0 && (e.textContent||"").trim() === order);
    if (!node) return "noorder";
    let row = node; for (let i=0;i<10&&row;i++){ if(row.querySelector&&row.querySelector('input[type=checkbox]')) break; row=row.parentElement; }
    const cb = row && row.querySelector && row.querySelector('input[type=checkbox]');
    if (!cb) return "nocb";
    const lab = cb.id ? document.querySelector(`label[for="${cb.id}"]`) : null;
    (lab || cb).click();
    return "ok";
  }, p.orderNumber);
  if (chk === "noorder") throw new Error("주문을 목록에서 못 찾음(클레임 상태 필터/기간 확인)");
  if (chk !== "ok") throw new Error("체크박스 못 찾음");
  await sleep(1500);
  if (process.env.CS_ACTION_DRYRUN === "1") return { done: false, dryRun: true };
  // 툴바에서 buttonText(예 '수거 완료 처리') 보이는 버튼 클릭
  const clicked = await page.evaluate((bt) => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.innerText||"").replace(/\s+/g," ").trim() === bt && x.getBoundingClientRect().height > 0);
    if (b) { b.click(); return true; }
    return false;
  }, p.buttonText);
  if (!clicked) throw new Error(`'${p.buttonText}' 버튼 안나타남(주문 미선택/상태 불일치)`);
  await sleep(2500);
  // 확인 모달: 처리하기(js-operate) 또는 확인 — 보이는 것 클릭
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /처리하기|확인/.test(x.innerText||"") && !/취소/.test(x.innerText||"") && x.getBoundingClientRect().height > 0);
    b && b.click();
  });
  await sleep(3000); await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(()=>{});
  return { done: true };
}

// ── W컨셉 반품 회수완료: 교환/반품 접수내역에서 주문행 체크 → '회수완료' 버튼 → 확인 ──
async function doWconceptClaim(page, p) {
  if (!p.orderNumber) throw new Error("orderNumber 필요");
  await page.goto("https://newpin.wconcept.co.kr/Order/OrderReturnManageShipping?type=return", { waitUntil: "domcontentloaded", timeout: 60000 }).catch(()=>{});
  await sleep(5000); await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(()=>{});
  // ⚠️ W컨셉 그리드는 고정 좌측열 복제 DOM(.freeze-multi-scroll-left) 사용. 회수완료(UpdateReturnBuyConfirm)는
  //    $(".chk:checked", ".freeze-multi-scroll-left") 를 읽으므로 그 패널의 체크박스를 Semantic UI API로 체크해야 한다.
  const chk = await page.evaluate((order) => {
    const jq = window.jQuery || window.$;
    let cb = null;
    for (const pane of document.querySelectorAll(".freeze-multi-scroll-left")) {
      const tr = [...pane.querySelectorAll("tr")].find((t) => (t.innerText||"").includes(order));
      if (tr) { cb = tr.querySelector("input.chk"); break; }
    }
    if (!cb) return "noorder";
    const box = cb.closest(".ui.checkbox");
    if (jq && jq.fn && jq.fn.checkbox && box) jq(box).checkbox("check");
    else { cb.checked = true; cb.dispatchEvent(new Event("change", { bubbles: true })); }
    return document.querySelectorAll(".freeze-multi-scroll-left .chk:checked").length > 0 ? "ok" : "notchecked";
  }, p.orderNumber);
  if (chk === "noorder") throw new Error(`반품건(${p.orderNumber})을 목록에서 못 찾음(이미 처리/기간외)`);
  if (chk !== "ok") throw new Error("체크박스 선택 반영 안 됨");
  await sleep(800);
  if (process.env.CS_ACTION_DRYRUN === "1") return { done: false, dryRun: true };
  // 회수완료 클릭 (confirm 다이얼로그는 ctx/page 핸들러가 자동수락; 성공="확인 처리가 완료되었습니다")
  page._csDialogs = [];
  await page.locator('button:has-text("회수완료")').first().click({ timeout: 6000 }).catch((e) => { throw new Error("회수완료 클릭 실패: " + e.message); });
  await sleep(4500); await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(()=>{});
  const dlgs = page._csDialogs || [];
  if (dlgs.some((m) => /선택된 주문이 없|선택하세요/.test(m))) throw new Error("선택 미반영(고정패널 체크 실패)");
  if (!dlgs.some((m) => /완료되었습니다/.test(m))) throw new Error("회수완료 확인 메시지 없음 — 미처리 의심");
  return { done: true };
}

const SIXSHOP_HANDLERS = {
  sixshop_reply: doSixshopReply,
  sixshop_claim: doSixshopClaim,
};
const WCONCEPT_HANDLERS = {
  wconcept_claim: doWconceptClaim,
};

// 플랫폼별 브라우저 1회 로그인 후 해당 잡들 처리. 전용 프로필(스케줄 동기화와 락 충돌 방지).
async function processGroup(jobs, { profile, handlers, login }) {
  const ctx = await chromium.launchPersistentContext(path.join(os.homedir(), ".paulvice-marketplace-agent", profile), {
    headless: false, channel: "chrome", acceptDownloads: true, locale: "ko-KR", viewport: null,
    args: ["--disable-blink-features=AutomationControlled", "--start-maximized", "--lang=ko-KR"],
    ignoreDefaultArgs: ["--enable-automation"],
  });
  ctx.on("page", (pg) => pg.on("dialog", (d) => d.accept().catch(()=>{})));
  try {
    const page = ctx.pages()[0] || (await ctx.newPage());
    page._csDialogs = [];
    page.on("dialog", (d) => { try { (page._csDialogs ||= []).push(d.message()); } catch {} d.accept().catch(()=>{}); });
    await login(ctx, page);
    for (const job of jobs) {
      const handler = handlers[job.kind];
      log(`CS 액션 [${job.kind}] ${job.id}`);
      try {
        if (!handler) throw new Error(`미지원 kind: ${job.kind}`);
        const result = await handler(page, job.payload || {});
        await writeJob(job, { status: "done", result, error: null });
        log(`  ✅ done ${job.id}`);
      } catch (e) {
        await writeJob(job, { status: "error", error: e && e.message ? e.message : String(e) });
        log(`  ❌ error ${job.id}: ${e && e.message}`);
      }
    }
  } catch (e) {
    for (const job of jobs) await writeJob(job, { status: "error", error: "세션 실패: " + (e && e.message) });
    log("세션 실패: " + (e && e.message));
  } finally {
    await ctx.close().catch(()=>{});
  }
}

async function processSixshop(jobs) {
  await processGroup(jobs, {
    profile: "sixshop-csaction", handlers: SIXSHOP_HANDLERS,
    login: async (ctx, page) => { if (!(await loginSixshop(page, log))) throw new Error("식스샵 로그인 실패"); await ensureStore(page, "harriotwatches", log); },
  });
}
async function processWconcept(jobs) {
  await processGroup(jobs, {
    profile: "wconcept-csaction", handlers: WCONCEPT_HANDLERS,
    login: async (ctx, page) => {
      const acc = WC_ACCOUNTS[0];
      await page.goto("https://newpin.wconcept.co.kr/Order/OrderReturnManageShipping?type=return", { waitUntil: "domcontentloaded", timeout: 60000 }).catch(()=>{});
      await sleep(3000);
      if (/Auth\/Login/i.test(page.url())) { if (!(await loginWconcept(ctx, page, acc, log))) throw new Error("W컨셉 로그인 실패"); }
    },
  });
}

async function tick() {
  const { data, error } = await sb.from("kv_store").select("key,data").like("key", PREFIX + "%");
  if (error) { log("kv 조회 실패: " + error.message); return; }
  const jobs = (data || []).map((r) => r.data).filter(Boolean);
  const pending = jobs.filter((j) => j.status === "pending").sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)));
  if (pending.length) {
    const claimed = [];
    for (const job of pending) { claimed.push(await writeJob(job, { status: "processing" })); }
    const wc = claimed.filter((j) => String(j.kind).startsWith("wconcept_"));
    const ss = claimed.filter((j) => !String(j.kind).startsWith("wconcept_"));
    if (ss.length) await processSixshop(ss);
    if (wc.length) await processWconcept(wc);
  }
  const now = Date.now();
  for (const j of jobs) {
    if ((j.status === "done" || j.status === "error") && now - new Date(j.updatedAt).getTime() > CLEANUP_MS) {
      await sb.from("kv_store").delete().eq("key", PREFIX + j.id);
    }
  }
}

(async () => {
  log("CS 액션 워커 시작 (poll " + POLL_MS + "ms)");
  for (;;) {
    try { await tick(); } catch (e) { log("tick 예외: " + (e && e.message)); }
    await sleep(POLL_MS);
  }
})();
