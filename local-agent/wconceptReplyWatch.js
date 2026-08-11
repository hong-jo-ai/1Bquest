/**
 * W컨셉 추시연 MD 회신 감시(일회성). 30분 크론(com.paulvice.wconcept-reply-watch)이 호출.
 * plvekorea 메일함 스레드에 sy.chu@wconcept.co.kr 발신 메시지(=회신)가 생기면
 * 텔레그램 알림 후 자기 launchd 정리. 회신 전엔 조용히 종료.
 */
const fs = require("fs");
const { execSync } = require("child_process");
const DASH = "/Users/mac/sungjo_ai/paulwise-dashboard";
function le(p) { const o = {}; try { for (const l of fs.readFileSync(p, "utf8").split("\n")) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (!m) continue; let v = m[2].trim().replace(/^["']|["']$/g, ""); if (!(m[1] in process.env)) process.env[m[1]] = v; } } catch {} }
le(DASH + "/.env.supabase"); le(DASH + "/.env.local"); le(DASH + "/local-agent/.env");

const THREAD = "19fc5d1731ef91b5";
const MD = "sy.chu@wconcept.co.kr";
// 우리가 마지막으로 보낸 메시지(2026-08-11 "전체 쿠폰 미적용" 확답). 이보다 뒤에 온
// MD 메시지만 새 회신으로 본다 — 8/3 회신이 스레드에 남아 있어 기준선이 없으면 즉시 오탐.
const BASELINE_ID = "19fef9d0fe4c40a0";
const LABEL = "com.paulvice.wconcept-reply-watch";

(async () => {
  const SB = process.env.SUPABASE_URL, K = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r = await fetch(`${SB}/rest/v1/kv_store?key=eq.kakao_gift_gmail_token&select=data`, { headers: { apikey: K, Authorization: `Bearer ${K}` } });
  const tk = (await r.json())[0]?.data; const refresh = typeof tk === "string" ? tk : tk?.refresh_token;
  if (!refresh) { console.error("no token"); process.exit(1); }
  const tj = await (await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, refresh_token: refresh, grant_type: "refresh_token" }) })).json();
  if (!tj.access_token) { console.error("token refresh fail"); process.exit(1); }
  const token = tj.access_token;
  const th = await (await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${THREAD}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`, { headers: { Authorization: `Bearer ${token}` } })).json();
  const msgs = th.messages || [];
  const base = msgs.find((m) => m.id === BASELINE_ID);
  const after = Number(base?.internalDate || 0);
  const reply = msgs.find((m) => {
    const from = (m.payload?.headers || []).find((h) => h.name === "From")?.value || "";
    return from.includes(MD) && Number(m.internalDate || 0) > after;
  });
  if (!reply) { console.log("아직 회신 없음"); process.exit(0); }
  // 회신 도착 → 텔레그램 알림
  const snippet = (reply.snippet || "").slice(0, 300);
  const text = `📬 <b>W컨셉 추시연 MD 회신 도착</b>\n(에끌라 오벌 307951780 — <b>전체 쿠폰 미적용</b> 요청 건, 8/13까지 반영 요청)\n\n${snippet}\n\n→ 최저가 정리되면 허앤쉬 조현희 팀장에게 회신. 공구 오픈 8/14.`;
  const t = process.env.TELEGRAM_BOT_TOKEN, c = process.env.TELEGRAM_CHAT_ID;
  const tr = await fetch(`https://api.telegram.org/bot${t}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: c, text, parse_mode: "HTML" }) });
  if (!tr.ok) { console.error("telegram fail", tr.status); process.exit(1); } // 실패 시 자기삭제 안 함(다음 주기 재시도)
  try { execSync(`launchctl bootout gui/$(id -u)/${LABEL} 2>/dev/null; rm -f ~/Library/LaunchAgents/${LABEL}.plist`, { shell: "/bin/zsh" }); } catch {}
  console.log("회신 알림 발송·감시 종료");
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
