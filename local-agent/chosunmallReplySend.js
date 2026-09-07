/**
 * 조선몰(디즈먼트) 송장 회신 **자동 발송** — 평일 15:00.
 *
 * 10:30 에 chosunmallPoSync.js 가 접수하고 회신 **초안**까지 만들어 두면,
 * 이 스크립트가 오후 3시에 그 초안을 발송한다.
 *
 * 왜 사람이 안 누르고 자동인가: 초안이 임시보관함에서 묵다가 마감(17시)을
 * 넘길 뻔한 일이 있었다(2026-09-07, 5분 전 발송). 회신이 늦으면 당월 정산에서
 * 빠진다. 사장님 지시로 자동 발송으로 전환(2026-09-07).
 *
 * ⚠️ 다만 송장 회신은 "오늘 출고했다"는 약속이다. 그래서 **접수 실물을 대조하고**
 *    나간다 — 초안 본문의 송장번호가 오늘 실제로 접수된 조선몰 송장과 하나라도
 *    어긋나면 발송을 멈추고 텔레그램으로 알린다. 대조를 통과할 때만 보낸다.
 *
 * 멱등: 발송하면 초안이 사라지므로 다시 돌아도 "초안 없음"으로 조용히 끝난다.
 *
 * 실행: node chosunmallReplySend.js          (드라이런 — 대조만 하고 안 보냄)
 *       node chosunmallReplySend.js --send   (실발송)
 */
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env"), override: true });

const DASH = path.resolve(__dirname, "..");
function le(p) {
  try {
    for (const l of fs.readFileSync(p, "utf8").split("\n")) {
      const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch { /* 없는 파일 무시 */ }
}
le(path.join(DASH, ".env.supabase")); le(path.join(DASH, ".env.local"));

const { createClient } = require(path.join(DASH, "node_modules/@supabase/supabase-js"));
const { sendTelegram } = require("./notifyFail");
const { beat } = require("./heartbeat");

const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
const sb = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

/** KST 기준 오늘 YYYYMMDD — 발주서 제목의 날짜와 맞춰야 한다. */
function todayKst() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}

async function gmailToken() {
  const { data } = await sb().from("kv_store").select("data").eq("key", "google_refresh_token").maybeSingle();
  const rt = typeof data.data === "string" ? data.data : (data.data.refresh_token || data.data);
  const j = await (await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: rt, grant_type: "refresh_token",
    }),
  })).json();
  if (!j.access_token) throw new Error(`Gmail 토큰 실패: ${JSON.stringify(j).slice(0, 160)}`);
  return j.access_token;
}

/** 오늘자 회신 초안 찾기 — 제목에 `YYYYMMDD 발주서` 가 든 DRAFT. */
async function findDraft(H, ymd) {
  const list = await (await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts?maxResults=50", { headers: H })).json();
  for (const d of list.drafts || []) {
    const full = await (await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/drafts/${d.id}?format=full`, { headers: H })).json();
    const subject = (full.message?.payload?.headers || []).find((h) => h.name === "Subject")?.value || "";
    if (subject.includes(`${ymd} 발주서`)) return { id: d.id, subject, message: full.message };
  }
  return null;
}

/** 초안 본문(html part)에서 송장번호 13자리를 뽑는다. */
function trackingNosOf(message) {
  const parts = [message.payload, ...(message.payload?.parts || [])];
  let text = "";
  for (const p of parts) {
    if (p?.body?.data && /text\//.test(p.mimeType || "")) {
      text += Buffer.from(p.body.data, "base64").toString("utf8");
    }
  }
  return [...new Set(text.match(/\b\d{13}\b/g) || [])];
}

async function main() {
  require("./parcelHolidays").checkOrExit("조선몰 송장 회신");
  const send = process.argv.includes("--send");
  const ymd = todayKst();
  const H = { Authorization: `Bearer ${await gmailToken()}`, "Content-Type": "application/json" };

  const draft = await findDraft(H, ymd);
  if (!draft) {
    // 발주가 없었거나 이미 보냈다 — 둘 다 정상. 조용히 끝낸다.
    log(`${ymd} 회신 초안 없음 — 종료(발주 없음 또는 이미 발송)`);
    await beat("chosunmall-reply-send", { sent: 0, reason: "no_draft" });
    return;
  }

  // ── 대조: 초안의 송장번호가 오늘 실제 접수분과 맞는가
  const drafted = trackingNosOf(draft.message);
  const since = new Date(Date.now() - 20 * 3600 * 1000).toISOString();
  const { data: rows } = await sb().from("pp_shipments")
    .select("regi_no,order_number,recipient_name").eq("channel", "조선몰").gte("created_at", since);
  const actual = new Set((rows || []).map((r) => String(r.regi_no)));
  const missing = drafted.filter((t) => !actual.has(t));

  log(`초안 "${draft.subject}" · 송장 ${drafted.length}건 · 오늘 접수 ${actual.size}건 · 미확인 ${missing.length}건`);

  if (!drafted.length || missing.length) {
    const msg = `⚠️ 조선몰 송장 회신 자동발송 중단\n\n` +
      `초안: ${draft.subject}\n` +
      (drafted.length ? `접수기록에 없는 송장 ${missing.length}건: ${missing.join(", ")}` : `초안에서 송장번호를 못 찾음`) +
      `\n\n직접 확인 후 임시보관함에서 보내주세요. (마감 17시)`;
    log("대조 실패 — 발송 중단");
    await sendTelegram(msg);
    await beat("chosunmall-reply-send", { sent: 0, reason: "mismatch", missing: missing.length });
    return;
  }

  if (!send) { log("드라이런 — 대조 통과. --send 로 실발송"); return; }

  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts/send", {
    method: "POST", headers: H, body: JSON.stringify({ id: draft.id }),
  });
  const out = await res.json();
  if (!res.ok) throw new Error(`발송 실패 [${res.status}]: ${JSON.stringify(out).slice(0, 200)}`);

  log(`발송 완료 messageId=${out.id}`);
  await sendTelegram(`📮 조선몰 송장 회신 발송 완료 — ${drafted.length}건\n${draft.subject}`);
  await beat("chosunmall-reply-send", { sent: drafted.length });
}

main().catch(async (e) => {
  log(`실패: ${e.message}`);
  await sendTelegram(`🔴 조선몰 송장 회신 자동발송 실패\n${e.message}\n\n임시보관함에서 직접 보내주세요. (마감 17시)`).catch(() => {});
  process.exit(1);
});
