/**
 * Claude 브리지 확인 게이트 (2단계). PreToolUse 훅(claudeBridgeGuard.sh)이 위험행동 직전 호출.
 * kv(claude_confirm:*)에 대기 적재 + 텔레그램으로 "예/아니오" 질문 → 응답 폴링.
 *   승인 → exit 0 (훅이 허용)  /  거부·타임아웃 → exit 1 (훅이 차단)
 * 사장님 응답은 텔레그램 webhook 의 resolveClaudeConfirm 이 kv status 로 기록.
 */
require("dotenv").config({ override: true });
const fs = require("fs"), path = require("path");
const DASH = path.resolve(__dirname, "..");
function le(p) { try { for (const l of fs.readFileSync(p, "utf8").split("\n")) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (!m) continue; let v = m[2].trim().replace(/^["']|["']$/g, ""); if (!(m[1] in process.env)) process.env[m[1]] = v; } } catch {} }
le(path.join(DASH, ".env.supabase")); le(path.join(DASH, ".env.local")); le(path.join(__dirname, ".env"));
const { createClient } = require(path.join(DASH, "node_modules/@supabase/supabase-js"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TIMEOUT_MS = Number(process.env.CLAUDE_CONFIRM_TIMEOUT_MS || 300000); // 5분

const action = process.argv.slice(2).join(" ").trim() || "(미상)";
const chatId = process.env.CLAUDE_BRIDGE_CHATID || process.env.TELEGRAM_CHAT_ID;

async function tg(msg) {
  const t = process.env.TELEGRAM_BOT_TOKEN; if (!t || !chatId) return;
  await fetch(`https://api.telegram.org/bot${t}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chatId, text: msg.slice(0, 3500) }) }).catch(() => {});
}

(async () => {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const key = "claude_confirm:" + id;
  await sb.from("kv_store").upsert({ key, data: { action, status: "waiting", chatId, createdAt: new Date().toISOString() }, updated_at: new Date().toISOString() }, { onConflict: "key" });
  await tg(`⚠️ Claude가 다음 작업을 실행하려 합니다:\n\n${action.slice(0, 600)}\n\n실행하려면 "예", 취소하려면 "아니오" 를 보내세요. (5분 내 미응답 시 자동 취소)`);
  // 음성으로 받은 지시면 확인질문도 음성노트로(사장님이 바로 듣고 "예/아니오" 답).
  if (process.env.CLAUDE_BRIDGE_VOICE) {
    try { await require("./voice").speak(chatId, `다음 작업을 실행할까요? ${action.slice(0, 200)}. 진행하려면 예, 취소하려면 아니오라고 답해주세요.`); } catch {}
  }

  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(3000);
    const { data } = await sb.from("kv_store").select("data").eq("key", key).maybeSingle();
    const st = data && data.data && data.data.status;
    if (st === "approved") { await sb.from("kv_store").delete().eq("key", key); process.exit(0); }
    if (st === "denied") { await sb.from("kv_store").delete().eq("key", key); process.exit(1); }
  }
  await tg("⏱️ 응답이 없어 작업을 취소했습니다.");
  await sb.from("kv_store").delete().eq("key", key);
  process.exit(1);
})().catch((e) => { console.error("confirm err:", e.message); process.exit(1); }); // 오류 시 안전하게 거부
