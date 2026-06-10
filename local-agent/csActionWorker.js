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

const HANDLERS = {
  sixshop_reply: doSixshopReply,
  // sixshop_return_confirm / sixshop_return_received 는 Phase 2b 에서 추가
};

async function processWithBrowser(jobs) {
  // 전용 프로필 — 스케줄 동기화(sixshop 프로필)와 동시 실행 시 Chrome 프로필 락 충돌 방지.
  const profileDir = path.join(os.homedir(), ".paulvice-marketplace-agent", "sixshop-csaction");
  const ctx = await chromium.launchPersistentContext(profileDir, {
    headless: false, channel: "chrome", acceptDownloads: true, locale: "ko-KR", viewport: null,
    args: ["--disable-blink-features=AutomationControlled", "--start-maximized", "--lang=ko-KR"],
    ignoreDefaultArgs: ["--enable-automation"],
  });
  ctx.on("page", (pg) => pg.on("dialog", (d) => d.accept().catch(()=>{})));
  try {
    const page = ctx.pages()[0] || (await ctx.newPage());
    if (!(await loginSixshop(page, log))) throw new Error("식스샵 로그인 실패");
    await ensureStore(page, "harriotwatches", log);
    for (const job of jobs) {
      const handler = HANDLERS[job.kind];
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
    // 로그인 등 공통 실패 — 잡들을 error 처리(브라우저 세션 단위)
    for (const job of jobs) await writeJob(job, { status: "error", error: "세션 실패: " + (e && e.message) });
    log("세션 실패: " + (e && e.message));
  } finally {
    await ctx.close().catch(()=>{});
  }
}

async function tick() {
  const { data, error } = await sb.from("kv_store").select("key,data").like("key", PREFIX + "%");
  if (error) { log("kv 조회 실패: " + error.message); return; }
  const jobs = (data || []).map((r) => r.data).filter(Boolean);
  const pending = jobs.filter((j) => j.status === "pending").sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)));
  if (pending.length) {
    // 선점
    const claimed = [];
    for (const job of pending) { claimed.push(await writeJob(job, { status: "processing" })); }
    await processWithBrowser(claimed);
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
