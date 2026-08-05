// 주문수집/출고 실패 시 텔레그램 알림 (배송 누락 방지)
// 사용: const { notifyFail } = require("./notifyFail"); await notifyFail("무신사 주문수집", err.message);
// 아이맥→api.telegram.org 직결이 자주 ETIMEDOUT → 직결 2회 실패 시 Vercel 릴레이 폴백(안정적).

/**
 * 텔레그램 전송 공통 경로 — 직결 재시도 후 Vercel 릴레이 폴백.
 * 성공하면 true, 두 경로 모두 실패하면 false (throw 하지 않는다).
 * opts: { parseMode, tries, timeoutMs, tag }
 *
 * 왜 공통화했나: pvReminder 가 맨 fetch 한 번만 쓰다가 `fetch failed` 로 리마인더를 통째
 * 유실했다(8/5 조선몰 건). 직결 불안정은 이미 알려진 문제라 전송 경로를 하나로 모은다.
 */
async function sendTelegram(text, opts = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  const tag = opts.tag || "sendTelegram";
  if (!token || !chat) { console.log(`[${tag}] 텔레그램 env 없음 — 스킵`); return false; }
  const parseMode = opts.parseMode;
  const tries = opts.tries ?? 3;
  const timeoutMs = opts.timeoutMs ?? 15000;

  // 1) 직결 시도 (지수 백오프 — 기기 절전 해제 직후 네트워크 미준비 구간을 넘긴다)
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chat, text, disable_web_page_preview: true,
          ...(parseMode ? { parse_mode: parseMode } : {}),
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (r.ok) { console.log(`[${tag}] 직결 전송 성공(${i + 1}회차)`); return true; }
      console.log(`[${tag}] 직결 HTTP ${r.status}: ${(await r.text().catch(() => "")).slice(0, 200)}`);
    } catch (e) {
      console.log(`[${tag}] 직결 예외(${i + 1}회차): ${(e && (e.cause && e.cause.code || e.message)) || e}`);
    }
    if (i < tries - 1) await new Promise(r => setTimeout(r, 3000 * (i + 1)));
  }

  // 2) Vercel 릴레이 폴백
  try {
    const base = (process.env.DASHBOARD_URL || "https://paulvice-dashboard.vercel.app").replace(/\/$/, "");
    const r = await fetch(`${base}/api/marketplace/telegram-relay`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-agent-token": process.env.PAULWISE_MCP_TOKEN || "" },
      body: JSON.stringify({ text, ...(parseMode ? { parseMode } : {}) }),
      signal: AbortSignal.timeout(30000),
    });
    if (r.ok) { console.log(`[${tag}] 릴레이 전송 성공`); return true; }
    console.log(`[${tag}] 릴레이 실패 HTTP ${r.status}: ${(await r.text().catch(() => "")).slice(0, 200)}`);
  } catch (e) { console.log(`[${tag}] 릴레이 예외: ${(e && (e.cause && e.cause.code || e.message)) || e}`); }

  console.log(`[${tag}] 텔레그램 전송 최종 실패`);
  return false;
}

async function notifyFail(title, detail) {
  const text = `⚠️ [수집/출고 실패] ${title}\n${(detail || "").toString().slice(0, 400)}\n\n👉 수동 확인 필요 (배송 누락 주의)`;
  return sendTelegram(text, { tries: 2, tag: "notifyFail" });
}

module.exports = { notifyFail, sendTelegram };
