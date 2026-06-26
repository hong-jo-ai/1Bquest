// 주문수집/출고 실패 시 텔레그램 알림 (배송 누락 방지)
// 사용: const { notifyFail } = require("./notifyFail"); await notifyFail("무신사 주문수집", err.message);
// 아이맥→api.telegram.org 직결이 자주 ETIMEDOUT → 직결 2회 실패 시 Vercel 릴레이 폴백(안정적).
async function notifyFail(title, detail) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) { console.log("[notifyFail] 텔레그램 env 없음 — 스킵"); return; }
  const text = `⚠️ [수집/출고 실패] ${title}\n${(detail || "").toString().slice(0, 400)}\n\n👉 수동 확인 필요 (배송 누락 주의)`;

  // 1) 직결 시도(2회)
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
        signal: AbortSignal.timeout(15000),
      });
      if (r.ok) { console.log("[notifyFail] 직결 전송 성공"); return; }
    } catch (e) { /* retry */ }
    await new Promise(r => setTimeout(r, 3000));
  }

  // 2) Vercel 릴레이 폴백
  try {
    const base = (process.env.DASHBOARD_URL || "https://paulvice-dashboard.vercel.app").replace(/\/$/, "");
    const r = await fetch(`${base}/api/marketplace/telegram-relay`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-agent-token": process.env.PAULWISE_MCP_TOKEN || "" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(30000),
    });
    if (r.ok) { console.log("[notifyFail] 릴레이 전송 성공"); return; }
    console.log(`[notifyFail] 릴레이 실패 HTTP ${r.status}: ${(await r.text().catch(() => "")).slice(0, 200)}`);
  } catch (e) { console.log(`[notifyFail] 릴레이 예외: ${(e && (e.cause && e.cause.code || e.message)) || e}`); }
  console.log("[notifyFail] 텔레그램 전송 최종 실패");
}
module.exports = { notifyFail };
