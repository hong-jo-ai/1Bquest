/**
 * 페덱스 라벨 인증(Label Certification) 메일 감시 → 텔레그램 즉시 알림.
 *
 * 배경(2026-09-17): Ship API 프로덕션 개방이 FedEx 라벨 인증에 걸려 있다. 제출하면 3영업일
 *   심사인데 결과가 shong@ 로 조용히 들어와서 사장님이 먼저 발견해 알려주는 일이 반복됐다
 *   (9/14 반려·9/16 재반려 둘 다 그랬다). "매일 확인해봐"(사장님 2026-09-17) → 자동화.
 *
 * 대상 = shong@harriotwatches.com 메일함에 label@fedex.com / noreply@fedex.com 으로부터
 *   새로 도착한 메일. 커서(kv `fedex_label_mail_cursor`)보다 새 것만 알린다.
 *   첫 실행은 알림 없이 기준점만 잡는다(과거 메일 폭탄 방지).
 *
 * 제목에 Failed 가 있으면 🔴 반려, 아니면 ✅ 로 구분해 보낸다. 반려 사유가 본문 앞부분에
 *   번호 목록으로 오므로 본문을 넉넉히(1500자) 실어 사장님이 텔레그램만 보고 판단할 수 있게 한다.
 *
 * ⚠️ MCP 커넥터(gmail)는 훅 타임아웃으로 못 쓴다 → KV 리프레시 토큰으로 Gmail API 직접 호출.
 *    KV row 의 data 는 평문 refresh_token 문자열이다(객체 아님).
 *
 * 실행:  node fedexLabelWatch.js         ← 1회 (launchd StartInterval 3600)
 *        node fedexLabelWatch.js --dry   ← 조회만, 알림·커서갱신 안 함
 *        node fedexLabelWatch.js --reset ← 커서 초기화(다음 실행이 다시 기준점만 잡음)
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
const QUERY = "(from:label@fedex.com OR from:noreply@fedex.com) newer_than:30d";
const TOKEN_KEY = "google_refresh_token";          // shong@harriotwatches.com (평문 refresh_token)
const CURSOR_KEY = "fedex_label_mail_cursor";
const CASE_NO = "27468617";
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);

const SB = process.env.SUPABASE_URL;
const SH = { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` };

async function kvGet(key) {
  const r = await fetch(`${SB}/rest/v1/kv_store?key=eq.${encodeURIComponent(key)}&select=data`, { headers: SH, signal: AbortSignal.timeout(15000) });
  const rows = await r.json();
  return rows?.[0]?.data;
}
async function kvSet(key, data) {
  await fetch(`${SB}/rest/v1/kv_store?on_conflict=key`, {
    method: "POST",
    headers: { ...SH, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ key, data, updated_at: new Date().toISOString() }),
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
    const listRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(QUERY)}&maxResults=20`, { headers: AT, signal: AbortSignal.timeout(20000) });
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
      // 회신 인용문 제거 — 페덱스는 우리 원문을 통째로 붙여 보낸다
      body = body.split(/-{5,}\s*Original Message\s*-{5,}/i)[0].trim();
      fresh.push({ id, date: H["date"], subject: H["subject"] || "", from: H["from"], body });
      seen.add(id);
    }

    if (first) {
      log(`최초 실행 — 기준점만 설정(알림 없음). 기존 ${ids.length}건 스킵`);
    } else if (fresh.length) {
      for (const f of fresh) {
        const failed = /fail/i.test(f.subject);
        const passed = /approv|certif(ied|ication complete)|production/i.test(f.subject) && !failed;
        const head = failed ? "🔴 <b>페덱스 라벨 인증 반려</b>" : passed ? "✅ <b>페덱스 라벨 인증 통과</b>" : "📩 <b>페덱스 라벨 인증 메일</b>";
        const body = f.body.length > 1500 ? f.body.slice(0, 1500) + "\n…(생략)" : f.body;
        const msg =
          `${head}\n` +
          `<b>제목</b> ${esc(f.subject)}\n<b>수신</b> ${esc(f.date)}\n\n` +
          `${esc(body)}\n\n` +
          `— shong@ 메일함, 케이스 ${CASE_NO}. 클로드에게 "페덱스 메일 왔어" 하면 이어서 처리합니다.`;
        await sendTelegram(msg, { parseMode: "HTML" });
        log(`알림 발송: ${f.subject}`);
      }
    } else {
      log("새 메일 없음");
    }

    if (!DRY) await kvSet(CURSOR_KEY, { lastInternalDate: String(maxInternal), seen: [...seen].slice(-100) });
    await beat("fedex-label-watch", { checked: ids.length, notified: first ? 0 : fresh.length });
  } catch (e) {
    log(`실패: ${(e && e.message) || e}`);
    try { await notifyFail("페덱스 라벨 인증 메일 감시", (e && e.message) || String(e)); } catch {}
    process.exitCode = 1;
  }
})();
