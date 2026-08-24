/**
 * 카페24 스킨 자동 배포 모듈 (폴바이스 skin2) — 2026-08-24
 *
 * 왜 이 모듈이 필요한가:
 *  - 히어로를 배너매니저(관리자 UI 전용, API 없음)에서 스킨 코드로 옮기면서, 배너 교체를
 *    에이전트가 끝까지 처리할 수 있게 하는 게 목적. 배너매니저는 로고·상단띠 등 나머지 용도로 남는다.
 *  - ⚠️ **엣지 캐시 함정**: 같은 경로에 덮어쓰면 캐시 노드마다 옛 버전이 섞여 나온다
 *    (2026-08-24 실증: 같은 URL 연속 호출에 display가 grid↔flex로 진동). 재업로드·쿼리스트링 무효.
 *    → **파일명을 버저닝하고 index.html 의 import 경로를 갈아끼우는 것**이 유일하게 즉시 반영되는 방법.
 *    이 모듈의 uploadVersioned/patchIndex 가 그 규칙을 강제한다.
 *
 * 안전장치: 배포 전 자동 백업 → 배포 → 라이브 검증 → 실패 시 rollback().
 */
const Client = require("ssh2-sftp-client");
const fs = require("fs"), path = require("path");

const HOST = "ecimg-ftp-c01.cafe24img.com", PORT = 8007, USER = "icaruse2000";
const DASH = path.resolve(__dirname, "..");
const BACKUP_ROOT = path.join(DASH, "downloads", "skin-backup");
const CDN = "https://ecimg.cafe24img.com/pg799b36658487045/icaruse2000";

function pw() {
  const v = process.env.CAFE24_SFTP_PW || process.env.PW;
  if (!v) throw new Error("SFTP 비밀번호 없음 — CAFE24_SFTP_PW 환경변수 필요");
  return v;
}
function stamp() {
  const d = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date());
  return d.replace(/[-: ]/g, "").slice(0, 12); // YYYYMMDDHHmm
}

// 연결 재사용 — 작업마다 새로 연결하면 카페24가 ECONNRESET 으로 끊는다(2026-08-24).
let shared = null;
async function connectWithRetry(tries = 3) {
  let last;
  for (let i = 1; i <= tries; i++) {
    const c = new Client();
    try {
      await c.connect({ host: HOST, port: PORT, username: USER, password: pw(), readyTimeout: 25000 });
      return c;
    } catch (e) {
      last = e; await c.end().catch(() => {});
      if (i < tries) await new Promise((r) => setTimeout(r, 4000 * i));
    }
  }
  throw new Error(`SFTP 접속 실패(${tries}회): ${last && last.message}`);
}
/** 여러 작업을 한 연결로 묶는다. 배포 스크립트는 이걸로 감쌀 것. */
async function session(fn) {
  if (shared) return fn(shared);
  shared = await connectWithRetry();
  try { return await fn(shared); }
  finally { await shared.end().catch(() => {}); shared = null; }
}
async function withSftp(fn) {
  if (shared) return fn(shared);
  const s = await connectWithRetry();
  try { return await fn(s); } finally { await s.end().catch(() => {}); }
}

/** 원격 파일들을 downloads/skin-backup/<tag>/ 로 내려받는다. 배포 전 필수. */
async function backupFiles(remotePaths, tag = stamp()) {
  const dir = path.join(BACKUP_ROOT, tag);
  fs.mkdirSync(dir, { recursive: true });
  const saved = [];
  await withSftp(async (s) => {
    for (const r of remotePaths) {
      const local = path.join(dir, r.replace(/^\//, "").replace(/\//g, "_"));
      try { await s.fastGet(r, local); saved.push({ remote: r, local }); }
      catch (e) { console.log(`  (백업 스킵) ${r} — ${e.message}`); }
    }
  });
  return { dir, saved };
}

/** 버저닝 업로드: base.html → base_<stamp>.html 로 올리고 원격 경로를 돌려준다(캐시 우회). */
async function uploadVersioned(localPath, remoteDir, base, ext = ".html", tag = stamp()) {
  const name = `${base}_${tag}${ext}`;
  const remote = `${remoteDir}/${name}`;
  await withSftp(async (s) => {
    try { await s.mkdir(remoteDir, true); } catch (e) {}
    await s.fastPut(localPath, remote);
  });
  return { remote, name, url: remote.startsWith("/web/") ? `${CDN}${remote}` : null };
}

/** 이미지 등 정적 파일을 그대로 업로드(파일명에 이미 버전이 들어있을 때). */
async function uploadFiles(pairs) {
  await withSftp(async (s) => {
    for (const [local, remote] of pairs) {
      const dir = remote.slice(0, remote.lastIndexOf("/"));
      try { await s.mkdir(dir, true); } catch (e) {}
      await s.fastPut(local, remote);
      console.log("  ↑", remote);
    }
  });
}

/** index.html 을 내려받아 치환 후 업로드. edits=[{from,to}] — from 이 없으면 에러(무언 실패 방지). */
async function patchIndex(edits, indexPath = "/skin2/index.html") {
  return withSftp(async (s) => {
    const tmp = path.join(require("os").tmpdir(), `skin_index_${Date.now()}.html`);
    await s.fastGet(indexPath, tmp);
    let html = fs.readFileSync(tmp, "utf8");
    const before = html;
    for (const { from, to } of edits) {
      if (!html.includes(from)) throw new Error(`index 치환 실패 — 원문에 없음: ${from.slice(0, 60)}`);
      html = html.split(from).join(to);
    }
    fs.writeFileSync(tmp, html);
    await s.fastPut(tmp, indexPath);
    fs.unlinkSync(tmp);
    return { before, after: html };
  });
}

/** 로컬 파일을 원격에 그대로 되돌린다(롤백). */
async function restore(saved) {
  await withSftp(async (s) => {
    for (const { remote, local } of saved) { await s.fastPut(local, remote); console.log("  ↺ 복구", remote); }
  });
}

/**
 * 라이브 검증 — 실제 렌더까지 보고 판정한다(파일이 올라갔다 ≠ 화면이 정상).
 * checks: { selectors:{sel:최소개수}, noBrokenImagesIn:'.pvm', maxConsoleErrors:0, custom:fn }
 */
/** 재시도 래퍼 — index.html 교체는 엣지 캐시 회전에 최대 수 분 걸린다(2026-08-24 실측 ~1분). */
async function verifyLiveRetry(opts = {}) {
  const { retries = 5, retryDelayMs = 45000 } = opts;
  let last;
  for (let i = 1; i <= retries; i++) {
    last = await verifyLive(opts);
    console.log(`  검증 ${i}/${retries}: ${last.ok ? "✅" : "대기 — " + last.fails.join(" / ").slice(0, 90)}`);
    if (last.ok) return last;
    if (i < retries) await new Promise((r) => setTimeout(r, retryDelayMs));
  }
  return last;
}

async function verifyLive({ url = "https://paulvice.co.kr/", mobile = true, checks = {}, screenshot = null, settleMs = 3000 } = {}) {
  const { chromium } = require("playwright");
  const b = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    const ctx = await b.newContext({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
      isMobile: mobile, deviceScaleFactor: 2,
      userAgent: mobile ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" : undefined,
    });
    const p = await ctx.newPage();
    const errors = [], bad = [];
    p.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });
    p.on("response", (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url().split("/").pop()}`); });
    await p.goto(url + (url.includes("?") ? "&" : "?") + "v=" + Date.now(), { waitUntil: "networkidle", timeout: 60000 });
    await p.waitForTimeout(settleMs);
    for (let i = 0; i < 10; i++) { await p.mouse.wheel(0, 800); await p.waitForTimeout(300); }
    await p.evaluate(() => window.scrollTo(0, 0));
    await p.waitForTimeout(1200);

    const fails = [];
    for (const [sel, min] of Object.entries(checks.selectors || {})) {
      const n = await p.evaluate((s) => document.querySelectorAll(s).length, sel);
      if (n < min) fails.push(`${sel} ${n}개 (기대 ${min}개 이상)`);
    }
    if (checks.noBrokenImagesIn) {
      const broken = await p.evaluate((scope) =>
        [...document.querySelectorAll(scope + " img")].filter((i) => i.complete && !i.naturalWidth).map((i) => i.src), checks.noBrokenImagesIn);
      if (broken.length) fails.push(`깨진 이미지 ${broken.length}: ${broken[0]}`);
    }
    if (checks.custom) {
      const r = await p.evaluate(checks.custom);
      if (r && r.fail) fails.push(r.fail);
    }
    const maxErr = checks.maxConsoleErrors ?? Infinity;
    if (errors.length > maxErr) fails.push(`콘솔 에러 ${errors.length}건: ${errors[0]}`);
    if (bad.length) fails.push(`4xx/5xx ${bad.length}건: ${bad[0]}`);
    if (screenshot) await p.screenshot({ path: screenshot });
    return { ok: fails.length === 0, fails, consoleErrors: errors, badResponses: bad };
  } finally { await b.close(); }
}


/**
 * 자주 쓰는 custom 검사 모음.
 * ⚠️ heroNotUnderHeader: `.header` 는 높이 0짜리 래퍼라 기준으로 쓰면 **항상 통과하는 헛검사**가 된다
 *    (2026-08-24에 이걸로 겹침을 놓쳤다). 실제 보이는 건 `.header__wrap`.
 */
const CHECKS = {
  heroNotUnderHeader: () => {
    const ov = document.querySelector(".pvh .ov");
    const hd = document.querySelector(".header__wrap");
    if (!ov || !hd) return { fail: "히어로/헤더 요소 없음" };
    const a = ov.getBoundingClientRect(), b = hd.getBoundingClientRect();
    if (b.height === 0) return { fail: "헤더 높이 0 — 기준 요소 잘못 잡음" };
    return a.top < b.bottom ? { fail: `히어로 문구가 헤더와 겹침(문구 top ${Math.round(a.top)} < 헤더 bottom ${Math.round(b.bottom)})` } : null;
  },
};

module.exports = { CHECKS, session, withSftp, backupFiles, uploadVersioned, uploadFiles, patchIndex, restore, verifyLive, verifyLiveRetry, stamp, CDN };
