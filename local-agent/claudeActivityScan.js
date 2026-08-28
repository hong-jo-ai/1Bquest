/**
 * 클로드 코드 세션 스캐너 — /today 보드의 "진행 중인 일" 원천.
 *
 *   node claudeActivityScan.js [--days 21] [--dry]
 *
 * ~/.claude/projects/<프로젝트>/<세션>.jsonl 을 훑어 세션마다 제목과 마지막으로 만진 시각을
 * 뽑아 kv_store(today:cc_activity)에 적재한다. 분류·묶음은 서버(lib/today/activity.ts)가 한다 —
 * 규칙을 한 군데만 두려고 여기서는 원본만 넘긴다.
 *
 * 이 파일들은 로컬 맥에만 있어서 배포된 대시보드가 직접 읽을 수 없다. 그래서 스캐너가 필요하다.
 */
const fs = require("fs"), path = require("path"), os = require("os");
const { beat } = require("./heartbeat");

const DASH = "/Users/mac/sungjo_ai/paulwise-dashboard";
function loadEnv(p){ try { for (const l of fs.readFileSync(p,"utf8").split("\n")){ const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if(!m)continue; let v=m[2].trim().replace(/^["']|["']$/g,""); if(!(m[1] in process.env)) process.env[m[1]]=v; } } catch {} }
loadEnv(path.join(DASH,".env.local")); loadEnv(path.join(DASH,".env.supabase")); loadEnv(path.join(DASH,"local-agent/.env"));

// 맥북·아이맥 양쪽에서 도니까 호스트별 키로 적재한다. 같은 키를 쓰면 서로 덮어써서
// 한쪽 머신의 세션이 보드에서 사라진다. 병합은 서버(lib/today/activity.ts)가 한다.
const HOST = (os.hostname().split(".")[0] || "unknown").toLowerCase().replace(/[^a-z0-9-]/g, "") || "unknown";
const KEY        = `today:cc_activity:${HOST}`;
const LEGACY_KEY = "today:cc_activity"; // 호스트 분리 전 키 — 남아 있으면 중복이라 지운다
const ROOT = path.join(os.homedir(), ".claude", "projects");

const args = process.argv.slice(2);
const DRY  = args.includes("--dry");
const DAYS = Number((args[args.indexOf("--days") + 1] || "").replace(/\D/g, "")) || 21;

/** ai-title 은 세션 내내 갱신되므로 마지막 것이 가장 정확하다. */
function aiTitle(file) {
  let title = null;
  for (const line of readLines(file)) {
    if (!line.includes('"ai-title"')) continue;
    try {
      const o = JSON.parse(line);
      if (o.type === "ai-title" && o.aiTitle) title = o.aiTitle;
    } catch {}
  }
  return title;
}

/** ai-title 이 없는 세션의 폴백 — 첫 실제 사용자 발화. 훅·시스템 주입은 건너뛴다. */
function firstUserText(file, maxLines = 400) {
  let i = 0;
  for (const line of readLines(file)) {
    if (++i > maxLines) break;
    if (!line.includes('"type":"user"')) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (o.type !== "user" || o.isSidechain) continue;
    let c = o.message && o.message.content;
    if (Array.isArray(c)) c = c.filter((b) => b && b.type === "text").map((b) => b.text).join(" ");
    if (typeof c !== "string") continue;
    const t = c.trim();
    if (!t || t.startsWith("<") || t.startsWith("Caveat:") || t.slice(0, 200).includes("system-reminder")) continue;
    return t.replace(/\s+/g, " ").slice(0, 140);
  }
  return null;
}

/** 11MB 짜리 세션도 있어서 통째로 안 올리고 청크로 흘려 읽는다. */
function* readLines(file) {
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(1 << 20);
    let rest = "", n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      const parts = (rest + buf.subarray(0, n).toString("utf8")).split("\n");
      rest = parts.pop();
      for (const p of parts) if (p) yield p;
    }
    if (rest) yield rest;
  } finally { fs.closeSync(fd); }
}

function scan() {
  const cutoff = Date.now() - DAYS * 86400_000;
  const out = [];
  let dirs = [];
  try { dirs = fs.readdirSync(ROOT, { withFileTypes: true }).filter((d) => d.isDirectory()); }
  catch (e) { throw new Error(`세션 디렉토리를 못 읽음: ${ROOT} (${e.message})`); }

  for (const d of dirs) {
    const dir = path.join(ROOT, d.name);
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".jsonl")) continue;
      const file = path.join(dir, f);
      const st = fs.statSync(file);
      if (st.mtimeMs < cutoff) continue;

      const t = aiTitle(file);
      const title = t || firstUserText(file);
      if (!title) continue; // 제목도 발화도 못 뽑은 세션은 보드에 띄울 게 없다

      out.push({
        projectDir: d.name,
        sessionId:  f.replace(/\.jsonl$/, ""),
        touchedAt:  new Date(st.mtimeMs).toISOString(),
        title,
        titled:     Boolean(t),
      });
    }
  }
  return out.sort((a, b) => b.touchedAt.localeCompare(a.touchedAt));
}

(async () => {
  const started = Date.now();
  const sessions = scan();
  const payload = { scannedAt: new Date().toISOString(), host: HOST, sessions };

  console.log(`세션 ${sessions.length}건 (최근 ${DAYS}일) · ${Date.now() - started}ms`);
  for (const s of sessions.slice(0, 10)) {
    console.log(`  ${s.touchedAt.slice(5, 16).replace("T", " ")} ${s.titled ? " " : "~"} ${s.projectDir.replace("-Users-mac-sungjo-ai", "~")}  ${s.title.slice(0, 50)}`);
  }
  if (sessions.length > 10) console.log(`  … 외 ${sessions.length - 10}건`);

  if (DRY) { console.log("--dry: 적재 생략"); return; }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 없음");
  }
  const { createClient } = require(path.join(DASH, "node_modules/@supabase/supabase-js"));
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { error } = await db
    .from("kv_store")
    .upsert({ key: KEY, data: payload, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(`kv_store 적재 실패: ${error.message}`);
  await db.from("kv_store").delete().eq("key", LEGACY_KEY); // 구 키 정리(있을 때만)
  console.log(`적재 완료 → ${KEY}`);
  await beat("claude-activity-scan", { sessions: sessions.length, days: DAYS, host: HOST });
})().catch((e) => { console.error("[claudeActivityScan]", e.message); process.exit(1); });
