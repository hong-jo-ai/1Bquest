/**
 * 텔레그램 전송 공용 헬퍼 — 아이맥 직결(api.telegram.org) 실패 시 Vercel 릴레이로 폴백.
 *
 * 아이맥→텔레그램 직결이 시간대에 따라 자주 ETIMEDOUT(이메일/구글API는 정상). 직결을 먼저
 * 시도하고, 실패하면 대시보드 `/api/marketplace/telegram-relay`(x-agent-token)로 보내
 * Vercel 이 대신 전송한다(Vercel→텔레그램은 안정적).
 *
 * 필요 env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, PAULWISE_MCP_TOKEN, (선택)DASHBOARD_URL.
 * 모든 함수는 throw 하지 않고 성공 여부(boolean)만 반환한다.
 */
const fs = require("fs");
const path = require("path");

function base() {
  return (process.env.DASHBOARD_URL || "https://paulvice-dashboard.vercel.app").replace(/\/$/, "");
}

async function relayPost(payload) {
  try {
    const res = await fetch(`${base()}/api/marketplace/telegram-relay`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-agent-token": process.env.PAULWISE_MCP_TOKEN || "" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60000),
    });
    return res.ok;
  } catch (_) {
    return false;
  }
}

/** 텍스트 전송: 직결 1회 → 실패 시 Vercel 릴레이. chatId 미지정 시 기본 채팅. */
async function relayText(text, chatId) {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  const c = chatId || process.env.TELEGRAM_CHAT_ID;
  if (!t || !c) return false;
  const msg = String(text == null ? "" : text).slice(0, 4000);
  try {
    const res = await fetch(`https://api.telegram.org/bot${t}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: c, text: msg }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) return true;
  } catch (_) {}
  return relayPost({ text: msg, chatId: c });
}

/** 파일(문서) 전송: 직결 tries 회 → 실패 시 Vercel 릴레이. filename 으로 표시 파일명(NFC) 지정. */
async function relayDocument(filePath, caption, filename, tries = 3) {
  const t = process.env.TELEGRAM_BOT_TOKEN, c = process.env.TELEGRAM_CHAT_ID;
  if (!t || !c) return false;
  let buf;
  try { buf = fs.readFileSync(filePath); } catch { return false; }
  const name = filename || path.basename(filePath);
  for (let i = 1; i <= tries; i++) {
    try {
      const form = new FormData();
      form.append("chat_id", c);
      if (caption) form.append("caption", caption);
      form.append("document", new Blob([buf]), name);
      const res = await fetch(`https://api.telegram.org/bot${t}/sendDocument`, {
        method: "POST", body: form, signal: AbortSignal.timeout(45000),
      });
      if (res.ok) return true;
    } catch (_) {}
    if (i < tries) await new Promise((r) => setTimeout(r, 4000));
  }
  return relayPost({ caption, filename: name, fileBase64: buf.toString("base64") });
}

module.exports = { relayText, relayDocument };
