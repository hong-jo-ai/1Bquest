/**
 * 모리↔Claude Code 브리지 (1단계 PoC).
 * 텔레그램으로 받은 지시를 큐(kv_store claude_task:*)에서 꺼내 헤드리스 Claude Code(`claude -p`)로
 * 무인 수행하고 결과를 텔레그램으로 보고. 구독 인증(.credentials.json) 사용 → 별도 API키 불필요.
 *
 * 안전(Phase1=읽기전용): claudeBridge.settings.json 의 PreToolUse 가드(claudeBridgeGuard.sh)가
 *   발송·배포·삭제·쓰기·동기화 실행을 차단. 모델은 비용상 Sonnet 기본.
 *
 * 실행:
 *   node claudeBridge.js "이번주 매출 요약해줘"   ← 단건 테스트(결과 stdout+텔레그램)
 *   node claudeBridge.js                          ← 큐 폴링(launchd 상주)
 */
require("dotenv").config({ override: true });
const fs = require("fs"), path = require("path");
const { execFileSync } = require("child_process");
const DASH = path.resolve(__dirname, "..");
function le(p) { try { for (const l of fs.readFileSync(p, "utf8").split("\n")) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (!m) continue; let v = m[2].trim().replace(/^["']|["']$/g, ""); if (!(m[1] in process.env)) process.env[m[1]] = v; } } catch {} }
le(path.join(DASH, ".env.supabase")); le(path.join(DASH, ".env.local")); le(path.join(__dirname, ".env"));
const { createClient } = require(path.join(DASH, "node_modules/@supabase/supabase-js"));
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);

const CLAUDE = process.env.CLAUDE_BIN || "/Users/mac/.local/bin/claude";
const MODEL = process.env.CLAUDE_BRIDGE_MODEL || "sonnet";
const SETTINGS = path.join(__dirname, "claudeBridge.settings.json");
const POLL_MS = 5000;
const KEY_PREFIX = "claude_task:";
const SAFETY = [
  "당신은 사장님이 텔레그램으로 보낸 지시를 무인으로 수행하는 비서입니다(원격, 터미널 앞에 사람 없음).",
  "지금은 1단계 안전모드: 읽기·조회·분석·요약만 합니다.",
  "파일 수정/발송/배포/삭제/DB쓰기/동기화 실행 등 되돌릴 수 없거나 외부로 나가는 행동은 절대 하지 말고, 필요하면 '무엇을 해야 하는지'만 보고하세요.",
  "DB는 SELECT 조회만 하세요. 가드가 위험 명령을 차단하면 우회하지 말고 보고만 하세요.",
  "결과는 한국어로 간결하게(텔레그램에서 읽기 좋게) 정리해 마지막에 명확히 답하세요.",
].join(" ");

const sb = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tg(msg, chatId) {
  const t = process.env.TELEGRAM_BOT_TOKEN, c = chatId || process.env.TELEGRAM_CHAT_ID;
  if (!t || !c) { log("텔레그램 미설정 — 전송 생략"); return; }
  await fetch(`https://api.telegram.org/bot${t}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: c, text: msg.slice(0, 4000) }) }).catch((e) => log("텔레그램 실패: " + e.message));
}

// 헤드리스 Claude Code 실행 (Sonnet · 가드훅 · 읽기전용 툴). resume 로 대화 연속 가능.
function runTask(instruction, resumeId) {
  const args = ["-p", instruction, "--model", MODEL, "--output-format", "json", "--settings", SETTINGS,
    "--allowedTools", "Read,Grep,Glob,Bash", "--append-system-prompt", SAFETY];
  if (resumeId) args.push("--resume", resumeId);
  const out = execFileSync(CLAUDE, args, { cwd: DASH, encoding: "utf8", maxBuffer: 64 << 20, timeout: 300000 });
  const j = JSON.parse(out);
  return { result: j.result || "(결과 없음)", cost: j.total_cost_usd || 0, sessionId: j.session_id, isError: !!j.is_error, denials: (j.permission_denials || []).length };
}

async function processTask(id, task) {
  const client = sb();
  log(`▶ 작업 [${id}]: ${task.instruction.slice(0, 60)}`);
  try {
    const r = runTask(task.instruction, task.resumeId);
    const foot = `\n\n— 🤖 비용 $${r.cost.toFixed(3)}${r.denials ? ` · 차단 ${r.denials}건(안전)` : ""}`;
    await tg(r.result + foot, task.chatId);
    await client.from("kv_store").upsert({ key: KEY_PREFIX + id, data: { ...task, status: "done", result: r.result, cost: r.cost, sessionId: r.sessionId, updatedAt: new Date().toISOString() }, updated_at: new Date().toISOString() }, { onConflict: "key" });
    log(`◀ 완료 [${id}] $${r.cost.toFixed(3)}`);
  } catch (e) {
    const msg = (e.stderr || e.stdout || e.message || String(e)).toString().slice(-500);
    log(`✗ 실패 [${id}]: ${msg}`);
    await tg(`⚠️ 작업 실패: ${task.instruction.slice(0, 40)}\n${msg.slice(0, 300)}`, task.chatId);
    await client.from("kv_store").upsert({ key: KEY_PREFIX + id, data: { ...task, status: "error", error: msg, updatedAt: new Date().toISOString() }, updated_at: new Date().toISOString() }, { onConflict: "key" });
  }
}

async function pollOnce() {
  const client = sb();
  const { data } = await client.from("kv_store").select("key,data").like("key", KEY_PREFIX + "%");
  const pending = (data || []).filter((r) => r.data && r.data.status === "pending").sort((a, b) => String(a.data.createdAt).localeCompare(String(b.data.createdAt)));
  for (const row of pending) await processTask(row.key.slice(KEY_PREFIX.length), row.data);
}

(async () => {
  const arg = process.argv.slice(2).join(" ").trim();
  if (arg) {
    // 단건 테스트
    log(`단건 실행: ${arg}`);
    await processTask("test-" + Date.now(), { instruction: arg, chatId: process.env.TELEGRAM_CHAT_ID, status: "pending", createdAt: new Date().toISOString() });
    return;
  }
  log(`claudeBridge 시작 (model ${MODEL}, poll ${POLL_MS / 1000}s)`);
  for (;;) { try { await pollOnce(); } catch (e) { log("poll 예외: " + e.message); } await sleep(POLL_MS); }
})().catch((e) => { console.error("ERR", e); process.exit(1); });
