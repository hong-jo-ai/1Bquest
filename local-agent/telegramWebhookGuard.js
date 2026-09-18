/**
 * 텔레그램 webhook 설정 점검·자동복구 — 확인카드 버튼이 조용히 죽는 것을 막는다.
 *
 * 왜 필요한가: 2026-09-18, `setWebhook` 의 `allowed_updates` 에서 **`callback_query` 가 빠져**
 * 텔레그램이 버튼 누름을 서버로 아예 전달하지 않았다. 서버 코드·버튼·인가는 전부 정상이었고
 * 로그에도 에러가 없어서(요청 자체가 안 온다) 어디를 봐도 안 나왔다. 사장님이 나비스트 입고
 * 확인카드를 두 번 눌렀는데 재고가 안 들어가서야 드러났다.
 *
 * ⚠️ 나비스트만이 아니다 — navist·pasho·mads·asnotify(AS 발송완료)·skin(배포 승인) 전 카드가
 * 같이 죽는다. "승인해야 발송"인 것들이 승인 자체가 불가능해진다.
 *
 * 하는 일: getWebhookInfo 로 url·allowed_updates·last_error 를 확인하고,
 *   - `callback_query` 가 빠졌으면 **자동으로 setWebhook 재설정**(secret_token 유지) 후 알림
 *   - url 이 다르거나 last_error 가 있으면 알림만(임의 변경하지 않는다)
 *
 * 🔴 secret_token 은 반드시 함께 실어야 한다. 라우트가 TELEGRAM_WEBHOOK_SECRET 과 헤더를
 * 대조해 불일치면 **모든 수신을 401 로 차단**한다. 그래서 재설정 전에 "현재 secret 으로
 * 프로덕션이 200 을 주는지"를 먼저 확인하고, 아니면 복구를 포기하고 알림만 보낸다(페일세이프).
 *
 * 실행: node local-agent/telegramWebhookGuard.js [--dry]
 * launchd: com.paulvice.telegram-webhook-guard (매일 09:10) · 워치독 heartbeat:telegram-webhook-guard
 */
const fs = require("fs"), path = require("path");
const DASH = path.resolve(__dirname, "..");
// ⚠️ 빈 값은 건너뛴다 — .env.local 의 TELEGRAM_BOT_TOKEN 이 빈칸이던 탓에 토큰이 죽어
//    "Failed to parse URL" 이 났고 네트워크 문제로 오해했다(2026-09-18).
for (const p of [`${DASH}/.env.local`, `${DASH}/.env.supabase`, `${__dirname}/.env`]) {
  try { for (const l of fs.readFileSync(p, "utf8").split("\n")) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (!m) continue;
    const v = m[2].trim().replace(/^["']|["']$/g, "");
    if (v && !(m[1] in process.env)) process.env[m[1]] = v;
  } } catch { /* 없으면 무시 */ }
}
const { relayText } = require("./telegramRelay");
const { beat } = require("./heartbeat");

const DRY = process.argv.includes("--dry");
const WEBHOOK_URL = process.env.TELEGRAM_WEBHOOK_URL
  || "https://paulvice-dashboard.vercel.app/api/telegram/webhook";
const NEEDED = ["message", "edited_message", "callback_query"];
const log = (m) => console.log(`[${new Date().toISOString()}] [tg-guard] ${m}`);

/**
 * 아이맥→api.telegram.org 호출. node fetch 를 먼저 쓰되 **실패하면 curl 로 넘어간다.**
 *
 * 🔑 이 폴백이 이 스크립트의 핵심이다. 아이맥에서 node(undici) 직결은 자주 실패하고,
 * 그 오류가 `Failed to parse URL from https://api.telegram.org/bot...` 로 나와서 토큰이나 URL 이
 * 깨진 것처럼 보인다. 아니다 — 같은 토큰으로 curl 은 바로 성공한다(2026-09-18 실측).
 * 실제로 이 가드의 첫 실행이 node fetch 4회 재시도에도 전부 실패했고 curl 로는 통했다.
 */
const { execFile } = require("child_process");

function curlJson(url, body) {
  return new Promise((resolve, reject) => {
    const args = ["-s", "--max-time", "25"];
    if (body) args.push("-X", "POST", "-H", "Content-Type: application/json", "--data-binary", "@-");
    args.push(url);
    const p = execFile("curl", args, { maxBuffer: 4 << 20 }, (err, stdout) => {
      if (err) return reject(new Error(`curl 실패: ${err.message.slice(0, 80)}`));
      try { resolve(JSON.parse(stdout)); }
      catch { reject(new Error(`curl 응답 파싱 실패: ${String(stdout).slice(0, 80)}`)); }
    });
    if (body) { p.stdin.write(JSON.stringify(body)); p.stdin.end(); }
  });
}

async function tg(method, body) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN 없음");
  const url = `https://api.telegram.org/bot${token}/${method}`;
  let last = "";
  for (let i = 1; i <= 2; i++) {
    try {
      const r = await fetch(url, {
        method: body ? "POST" : "GET",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15000),
      });
      return await r.json();
    } catch (e) { last = e.message; await new Promise((r) => setTimeout(r, 1500)); }
  }
  log(`node fetch 실패(${last.slice(0, 50)}) → curl 로 재시도`);
  for (let i = 1; i <= 3; i++) {
    try { return await curlJson(url, body); }
    catch (e) { last = e.message; await new Promise((r) => setTimeout(r, 2000)); }
  }
  throw new Error(`${method} 실패(fetch·curl 모두): ${last.slice(0, 80)}`);
}

/** 재설정 전 안전 확인: 이 secret 으로 프로덕션이 실제로 200 을 주는가. */
async function secretWorks(secret) {
  try {
    const r = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-telegram-bot-api-secret-token": secret },
      body: "{}", signal: AbortSignal.timeout(20000),
    });
    return r.status === 200;
  } catch { return false; }
}

(async () => {
  const info = (await tg("getWebhookInfo")).result || {};
  const allowed = info.allowed_updates || [];
  const missing = NEEDED.filter((k) => !allowed.includes(k));
  log(`url=${info.url} allowed=${JSON.stringify(allowed)} pending=${info.pending_update_count} err=${info.last_error_message || "-"}`);

  const notes = [];
  if (info.url && info.url !== WEBHOOK_URL) notes.push(`⚠️ webhook URL 이 예상과 다름: ${info.url}`);
  if (info.last_error_message) notes.push(`⚠️ 최근 오류: ${info.last_error_message}`);

  if (!missing.length) {
    log("정상 — callback_query 포함");
    if (notes.length) await relayText(`🤖 텔레그램 webhook 점검\n${notes.join("\n")}`).catch(() => {});
    await beat("telegram-webhook-guard", { ok: true, allowed });
    return;
  }

  log(`🔴 누락: ${missing.join(", ")} — 확인카드 버튼이 죽어 있다`);
  if (DRY) { log("(--dry: 복구 안 함)"); return; }

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) {
    await relayText("🔴 텔레그램 확인카드 버튼이 죽어 있습니다(allowed_updates 에 callback_query 없음).\nTELEGRAM_WEBHOOK_SECRET 이 없어 자동복구를 못 했습니다 — 수동 조치 필요.").catch(() => {});
    await beat("telegram-webhook-guard", { ok: false, reason: "no_secret" });
    process.exit(1);
  }
  // secret 이 프로덕션과 다르면 재설정 순간 모든 수신이 401 로 막힌다 → 복구 포기하고 알림만.
  if (!(await secretWorks(secret))) {
    await relayText("🔴 텔레그램 확인카드 버튼이 죽어 있는데 자동복구를 중단했습니다.\n로컬 secret 이 프로덕션과 달라서, 이대로 setWebhook 하면 모든 수신이 막힙니다. 수동 확인이 필요합니다.").catch(() => {});
    await beat("telegram-webhook-guard", { ok: false, reason: "secret_mismatch" });
    process.exit(1);
  }

  const res = await tg("setWebhook", {
    url: WEBHOOK_URL, secret_token: secret, allowed_updates: NEEDED, max_connections: 10,
  });
  const after = (await tg("getWebhookInfo")).result || {};
  const fixed = (after.allowed_updates || []).includes("callback_query");
  log(`setWebhook ok=${res.ok} → ${fixed ? "복구됨" : "여전히 누락"}`);
  await relayText(
    fixed
      ? `✅ 텔레그램 확인카드 버튼 자동복구\nallowed_updates 에 callback_query 가 빠져 있어 다시 넣었습니다.\n(빠져 있는 동안 나비스트·파쇼·광고·AS발송·배포 승인 버튼이 전부 먹통이었습니다)`
      : `🔴 텔레그램 webhook 자동복구 실패 — 수동 조치 필요\n${JSON.stringify(res).slice(0, 200)}`
  ).catch(() => {});
  await beat("telegram-webhook-guard", { ok: fixed, repaired: true });
  if (!fixed) process.exit(1);
})().catch(async (e) => {
  log(`❌ ${e.message}`);
  try { await relayText(`🔴 텔레그램 webhook 점검 실패\n${e.message}`); } catch { /* 알림 실패는 삼킨다 */ }
  process.exit(1);
});
