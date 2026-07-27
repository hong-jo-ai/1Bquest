// 일회성 리마인더 (2026-07-16 10:00) — 면세점 7/15 입금 확인 + 미회수 시 미수금 클레임 진행
// launchd com.paulvice.dutyfree-claim-reminder 가 호출. 발송 후 스스로 잡을 제거(일회성).
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// .env 로드
try {
  for (const line of fs.readFileSync(path.join(__dirname, ".env"), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
} catch (e) {}

const TEXT =
  "⏰ 면세점 미수금 — 7/15 입금 확인\n\n" +
  "어제(7/15) 제드아이티씨에서 폴바이스 4·5월 정산 4,605,534원이 입금됐는지 확인해주세요.\n\n" +
  "✅ 들어왔으면 → 이번 건은 보류 (약속 지킴)\n" +
  "❌ 안 들어왔으면 → 준비된 미수금 명세서(1,579만원)+공문을 박대원 대표께 발송 + 내용증명 준비\n\n" +
  "공문·명세서 초안은 shong@ 초안함에 대기 중입니다.\n" +
  "'클로드 면세점 입금됐어' 또는 '면세점 안 들어왔어, 진행해' 라고 알려주세요.";

async function send() {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (token && chat) {
    for (let i = 0; i < 2; i++) {
      try {
        const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chat, text: TEXT, disable_web_page_preview: true }),
          signal: AbortSignal.timeout(15000),
        });
        if (r.ok) { console.log("[dutyfreeReminder] 직결 전송 성공"); return true; }
      } catch (e) { /* retry */ }
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  // Vercel 릴레이 폴백
  try {
    const base = (process.env.DASHBOARD_URL || "https://paulvice-dashboard.vercel.app").replace(/\/$/, "");
    const r = await fetch(`${base}/api/marketplace/telegram-relay`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-agent-token": process.env.PAULWISE_MCP_TOKEN || "" },
      body: JSON.stringify({ text: TEXT }),
      signal: AbortSignal.timeout(30000),
    });
    if (r.ok) { console.log("[dutyfreeReminder] 릴레이 전송 성공"); return true; }
  } catch (e) { console.log("[dutyfreeReminder] 릴레이 예외:", e && e.message); }
  return false;
}

(async () => {
  await send();
  // 일회성: 잡 언로드 + plist 삭제 (다음 해에 다시 울리지 않도록)
  try {
    const uid = process.getuid();
    const label = "com.paulvice.dutyfree-claim-reminder";
    const plist = path.join(process.env.HOME, "Library/LaunchAgents", label + ".plist");
    try { execSync(`launchctl bootout gui/${uid}/${label}`, { stdio: "ignore" }); } catch (e) {}
    try { fs.unlinkSync(plist); } catch (e) {}
    console.log("[dutyfreeReminder] 일회성 잡 자기제거 완료");
  } catch (e) { console.log("[dutyfreeReminder] 자기제거 실패:", e && e.message); }
})();
