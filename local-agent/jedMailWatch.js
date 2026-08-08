/**
 * 제드아이티씨(박대원) 메일 감시 → 텔레그램 즉시 알림.
 *
 * 배경(2026-08-08): 면세점 미수금 20,032,563원 상호대사가 끝나고 8/15까지 지급계획 회신을
 *   요구한 상태. 회신이 오면 바로 알아야 하는데, plvekorea@gmail.com 은 평소 안 보는
 *   계정이라 놓치기 쉽다. (7/31 명세서 회신도 8/6에 와서 8/8에야 확인됨.)
 *
 * 대상 = plvekorea 메일함에 diameter3615@hanmail.net 로부터 새로 도착한 메일.
 *   커서(kv `jed_mail_cursor`)보다 새 메일만 알린다. 첫 실행은 알림 없이 커서만 잡는다
 *   (과거 메일 폭탄 방지).
 *
 * ⚠️ MCP 커넥터(gmail)는 훅 타임아웃으로 못 쓴다 → KV 리프레시 토큰으로 Gmail API 직접 호출.
 *    KV row 의 data 는 평문 refresh_token 문자열이다(객체 아님).
 *
 * 실행:  node jedMailWatch.js         ← 1회 (launchd StartInterval 600)
 *        node jedMailWatch.js --dry   ← 조회만, 알림·커서갱신 안 함
 *        node jedMailWatch.js --reset ← 커서 초기화(다음 실행이 다시 기준점만 잡음)
 */
const fs = require("fs");
const path = require("path");
const DASH = path.resolve(__dirname, "..");
function le(p){try{for(const l of fs.readFileSync(p,"utf8").split("\n")){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);if(!m)continue;const v=m[2].trim().replace(/^["']|["']$/g,"");if(!(m[1] in process.env))process.env[m[1]]=v;}}catch{}}
le(path.join(DASH,".env.supabase")); le(path.join(DASH,".env.local")); le(path.join(__dirname,".env"));

const { sendTelegram, notifyFail } = require("./notifyFail");
const { beat } = require("./heartbeat");

const DRY = process.argv.includes("--dry");
const RESET = process.argv.includes("--reset");
const WATCH = "diameter3615@hanmail.net";     // 박대원 대표 — 결제·미수금 소통 창구
const TOKEN_KEY = "kakao_gift_gmail_token";   // plvekorea@gmail.com (평문 refresh_token)
const CURSOR_KEY = "jed_mail_cursor";
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);

const SB = process.env.SUPABASE_URL;
const SH = { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` };

async function kvGet(key) {
  const r = await fetch(`${SB}/rest/v1/kv_store?key=eq.${encodeURIComponent(key)}&select=data`, { headers: SH, signal: AbortSignal.timeout(15000) });
  const rows = await r.json();
  return rows?.[0]?.data;
}
async function kvSet(key, data) {
  const now = new Date().toISOString();
  await fetch(`${SB}/rest/v1/kv_store?on_conflict=key`, {
    method: "POST",
    headers: { ...SH, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ key, data, updated_at: now }),
    signal: AbortSignal.timeout(15000),
  });
}

async function accessToken() {
  const raw = await kvGet(TOKEN_KEY);
  const refresh = typeof raw === "string" ? raw : raw && raw.refresh_token;
  if (!refresh) throw new Error(`KV ${TOKEN_KEY} 없음/형식불명`);
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refresh, grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(20000),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`토큰 갱신 실패: ${JSON.stringify(j).slice(0, 200)}`);
  return j.access_token;
}

const decode = (d) => Buffer.from(d, "base64url").toString("utf8");
function plainBody(part, out = []) {
  if (part.mimeType === "text/plain" && part.body?.data) out.push(decode(part.body.data));
  (part.parts || []).forEach((c) => plainBody(c, out));
  return out;
}
function htmlToText(h) {
  return h.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n").trim();
}
const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

(async () => {
  try {
    if (RESET) { await kvSet(CURSOR_KEY, { lastInternalDate: null, seen: [] }); log("커서 초기화 완료"); return; }

    const at = await accessToken();
    const AT = { Authorization: `Bearer ${at}` };
    const q = encodeURIComponent(`from:${WATCH} newer_than:30d`);
    const listRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=20`, { headers: AT, signal: AbortSignal.timeout(20000) });
    const list = await listRes.json();
    if (list.error) throw new Error(`Gmail list 실패: ${JSON.stringify(list.error).slice(0, 200)}`);
    const ids = (list.messages || []).map((m) => m.id);
    log(`대상 메일 ${ids.length}건 조회`);

    const cur = (await kvGet(CURSOR_KEY)) || {};
    const seen = new Set(cur.seen || []);
    const first = !cur.lastInternalDate && !(cur.seen || []).length;

    const fresh = [];
    let maxInternal = Number(cur.lastInternalDate || 0);
    for (const id of ids) {
      if (seen.has(id)) continue;
      const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, { headers: AT, signal: AbortSignal.timeout(20000) });
      const m = await r.json();
      const internal = Number(m.internalDate || 0);
      if (internal > maxInternal) maxInternal = internal;
      if (!first && internal <= Number(cur.lastInternalDate || 0)) { seen.add(id); continue; }
      const H = Object.fromEntries((m.payload?.headers || []).map((x) => [x.name.toLowerCase(), x.value]));
      let body = plainBody(m.payload).join("\n").trim();
      if (!body) {
        const htmls = [];
        (function walk(p) { if (p.mimeType === "text/html" && p.body?.data) htmls.push(decode(p.body.data)); (p.parts || []).forEach(walk); })(m.payload);
        body = htmlToText(htmls.join("\n"));
      }
      body = body.split(/-{5,}\s*원본 메일\s*-{5,}/)[0].trim();   // 인용문 제거
      fresh.push({ id, date: H["date"], subject: H["subject"], from: H["from"], body, attach: (m.payload?.parts || []).filter((p) => p.filename).map((p) => p.filename) });
      seen.add(id);
    }

    if (first) {
      log(`최초 실행 — 기준점만 설정(알림 없음). 기존 ${ids.length}건 스킵`);
    } else if (fresh.length) {
      for (const f of fresh) {
        const body = f.body.length > 1200 ? f.body.slice(0, 1200) + "\n…(생략)" : f.body;
        const msg =
          `📩 <b>제드아이티씨 박대원 대표 메일 도착</b>\n` +
          `<b>제목</b> ${esc(f.subject)}\n<b>수신</b> ${esc(f.date)}\n` +
          (f.attach.length ? `<b>첨부</b> ${esc(f.attach.join(", "))}\n` : "") +
          `\n${esc(body)}\n\n` +
          `— plvekorea 메일함. 클로드에게 "제드 메일 왔어" 하면 회신 초안 준비합니다.`;
        await sendTelegram(msg, { parseMode: "HTML" });
        log(`알림 발송: ${f.subject}`);
      }
    } else {
      log("새 메일 없음");
    }

    if (!DRY) await kvSet(CURSOR_KEY, { lastInternalDate: String(maxInternal), seen: [...seen].slice(-100) });
    await beat("jed-mail-watch", { checked: ids.length, notified: first ? 0 : fresh.length });
  } catch (e) {
    log(`실패: ${(e && e.message) || e}`);
    try { await notifyFail("제드 메일 감시", (e && e.message) || String(e)); } catch {}
    process.exitCode = 1;
  }
})();
