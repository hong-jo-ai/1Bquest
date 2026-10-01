/**
 * 페덱스 "미지급 관세 및 세금" 경고 메일 감시 → 텔레그램 알림 + 고객에게 납부 안내 메일 자동 발송.
 *
 * 왜 필요한가(2026-10-01): 미국·EU 는 라벨을 수취인 부담(DDU)으로 끊어도 페덱스가 먼저 배달하고 나중에 청구한다.
 *   수취인이 안 내면 **관세 인보이스 발행 60일 뒤 발송인(우리) 계정으로 전가**된다. 페덱스는 30일쯤부터
 *   harriotwatches@gmail.com 으로 경고 메일을 보내는데 아무도 안 읽어 그대로 청구됐다
 *   (Jen Skinner $91.8 → 9/30 142,390원. 2025-12 이후 6명). 9월에 미국행이 20건 나가 같은 일이 몰려올 수 있다.
 *   사장님 지시: "이 메일이 오면 텔레그램으로 알리고 바로 고객에게 안내 메일 발송, 승인 필요 없이".
 *
 * 동작:
 *   1) harriotwatches@gmail.com 에서 noreply@fedex.com 의 "미지급 관세" 메일을 읽어 표를 줄 단위로 뽑는다
 *      (수취인·발송일·관세 인보이스 번호·송장번호·금액).
 *   2) 관세 인보이스 번호마다 **한 번만** 고객에게 메일을 보낸다(kv `fedex_duty_notices`). 같은 인보이스의
 *      2차 경고는 텔레그램으로만 "아직 미납"을 알린다.
 *   3) 고객 이메일 = 카페24 영문몰(shop2) 주문에서 **송장번호 일치**로 찾는다. 못 찾으면 과거 구매자 명단
 *      (review_request_targets · crm_campaign_targets)에서 이름이 정확히 하나로 맞을 때만 쓴다.
 *      끝내 못 찾으면 보내지 않고 텔레그램으로 수동 처리를 요청한다.
 *
 * 안전장치(승인 없이 고객에게 나가는 메일이라):
 *   - 기본은 드라이런. 실제 발송은 `--send`(launchd 가 붙여 실행).
 *   - 한 번 실행에 고객 메일 최대 MAX_MAILS 통. 넘으면 나머지는 다음 실행으로.
 *   - 금액이 0 이하이거나 $1,000 이상이면 보내지 않고 텔레그램으로만(파싱 오류·이상 청구 의심).
 *   - 표를 한 줄도 못 뽑은 경고 메일은 "파싱 실패"로 텔레그램에 원문 앞부분을 보낸다.
 *   - 문안은 2026-07-09 사장님이 승인해 Naji Holmes 에게 보낸 메일 그대로다. 바꿀 땐 사장님 확인.
 *   - 발신 = shong@harriotwatches.com(대외 발신 창구), 제목은 ASCII 만.
 *
 * 실행: node fedexDutyWatch.js           드라이런(무엇을 보낼지 출력만, kv 안 건드림)
 *       node fedexDutyWatch.js --send    실제 발송 + 텔레그램 + kv 기록 (launchd, 1시간마다)
 *       node fedexDutyWatch.js --days 60 조회 기간(기본 20일)
 */
const fs = require("fs");
const path = require("path");
const DASH = path.resolve(__dirname, "..");
for (const p of [`${DASH}/.env.supabase`, `${DASH}/.env.local`, `${__dirname}/.env`]) {
  try { for (const l of fs.readFileSync(p, "utf8").split("\n")) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  } } catch { /* 없으면 무시 */ }
}
const { createClient } = require(`${DASH}/node_modules/@supabase/supabase-js`);
const { relayText } = require("./telegramRelay");
const { beat } = require("./heartbeat");

const ARGV = process.argv.slice(2);
const SEND = ARGV.includes("--send");
const DAYS = ARGV.includes("--days") ? Math.max(1, Number(ARGV[ARGV.indexOf("--days") + 1]) || 20) : 20;
const KV_KEY = "fedex_duty_notices";
const MAX_MAILS = 3;
const WATCH_ACCOUNT = "harriotwatches@gmail.com";
const SENDER_TOKEN_KEY = "google_refresh_token"; // shong@harriotwatches.com
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
const db = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function googleToken(refresh) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, refresh_token: refresh, grant_type: "refresh_token" }),
    signal: AbortSignal.timeout(20000),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`구글 토큰 갱신 실패: ${JSON.stringify(j).slice(0, 160)}`);
  return j.access_token;
}

function mailText(payload) {
  const parts = [];
  (function walk(p) { if (!p) return; if (/^text\/(html|plain)$/.test(p.mimeType || "") && p.body && p.body.data) parts.push(Buffer.from(p.body.data, "base64").toString("utf8")); (p.parts || []).forEach(walk); })(payload);
  return parts.join("\n").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/\s+/g, " ").trim();
}

/**
 * 경고 메일 본문의 표 → 줄 목록. 한 줄 형태(날짜 표기는 메일마다 다르다 — "19/6/2026", "2026. 3. 11."):
 *   *****2184 HARRIOTWATCHES JEN SKINNER 19/6/2026 28/7/2026 37 259326680 873288568398 91.8 US
 */
const DATE = String.raw`\d{1,4}[./]\s?\d{1,2}[./]\s?\d{1,4}\.?`;
const ROW = new RegExp(String.raw`HARRIOTWATCHES\s+(.+?)\s+(${DATE})\s+(${DATE})\s+(\d{1,3})\s+(\d{9})\s+(\d{12})\s+(\d+(?:\.\d+)?)`, "g");
function parseRows(text) {
  const rows = [];
  for (const m of text.matchAll(ROW)) {
    rows.push({ name: m[1].trim(), shipDate: m[2].trim(), invoiceDate: m[3].trim(), age: Number(m[4]), invoiceNo: m[5], tracking: m[6], amount: Number(m[7]) });
  }
  // 우리가 답장한 메일엔 인용문으로 같은 표가 두 번 들어 있다 → 인보이스 번호로 중복 제거
  return [...new Map(rows.map((r) => [r.invoiceNo, r])).values()];
}

/** 카페24 영문몰(shop2) 주문에서 송장번호로 고객을 찾는다. 토큰이 만료돼 있으면 건드리지 않고 null(로컬 refresh 금지). */
async function findByTracking(tracking) {
  const sb = db();
  const malls = [
    { brand: "Harriot", kv: "cafe24_refresh_token:harriot", mallId: process.env.HARRIOT_CAFE24_MALL_ID },
    { brand: "PAULVICE", kv: "cafe24_refresh_token", mallId: process.env.CAFE24_MALL_ID },
  ];
  const ymd = (d) => d.toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  let tokenMissing = false;
  for (const m of malls) {
    const { data } = await sb.from("kv_store").select("data").eq("key", m.kv).maybeSingle();
    const t = data && data.data;
    if (!t || !t.access_token || (t.expires_at || 0) - 60000 < Date.now()) { tokenMissing = true; continue; }
    // 경고는 발송 후 1~4개월 사이에 온다. 카페24 조회는 한 번에 3개월까지라 두 구간으로 나눈다.
    for (const [from, to] of [[170, 86], [85, 0]]) {
      for (let off = 0; ; off += 100) {
        const qs = new URLSearchParams({ shop_no: "2", start_date: ymd(new Date(Date.now() - from * 86400000)), end_date: ymd(new Date(Date.now() - to * 86400000)), limit: "100", offset: String(off), embed: "items,receivers,buyer" });
        const r = await fetch(`https://${m.mallId}.cafe24api.com/api/v2/admin/orders?${qs}`, { headers: { Authorization: `Bearer ${t.access_token}` }, signal: AbortSignal.timeout(30000) });
        const j = await r.json();
        if (!r.ok) { log(`${m.brand} 카페24 조회 실패 ${r.status} ${JSON.stringify(j).slice(0, 120)}`); tokenMissing = true; break; }
        for (const o of j.orders || []) {
          if (!(o.items || []).some((it) => String(it.tracking_no || "").replace(/\D/g, "") === tracking)) continue;
          const email = (o.buyer && o.buyer.email) || o.billing_email || o.buyer_email || "";
          const name = ((o.receivers || [])[0] || {}).name || o.billing_name || "";
          return { email, name, brand: m.brand, order: o.order_id, source: `카페24 ${m.brand} 영문몰 ${o.order_id}` };
        }
        if ((j.orders || []).length < 100) break;
      }
    }
  }
  return tokenMissing ? { retry: true } : null;
}

/** 식스샵 시절 고객 — 과거 구매자 명단에서 이름이 정확히 한 이메일로만 맞을 때. */
async function findByName(name) {
  const sb = db();
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z가-힣]/g, "");
  const want = norm(name);
  if (want.length < 5) return null;
  const emails = new Map();
  const last = name.trim().split(/\s+/).pop();
  const a = await sb.from("review_request_targets").select("email,customer_name,mall").ilike("customer_name", `%${last}%`).limit(50);
  for (const x of a.data || []) if (norm(x.customer_name) === want && x.email) emails.set(x.email.toLowerCase(), { brand: /paulvice/i.test(x.mall || "") ? "PAULVICE" : "Harriot", source: `과거 구매자 명단(${x.mall})` });
  const b = await sb.from("crm_campaign_targets").select("email,name,source").ilike("name", `%${last}%`).limit(50);
  for (const x of b.data || []) if (norm(x.name) === want && x.email && !emails.has(x.email.toLowerCase())) emails.set(x.email.toLowerCase(), { brand: /sixshop_global|harriot/i.test(x.source || "") ? "Harriot" : "PAULVICE", source: `CRM 명단(${x.source})` });
  if (emails.size !== 1) return null;
  const [email, meta] = [...emails.entries()][0];
  return { email, name, ...meta };
}

const titleCase = (s) => String(s || "").toLowerCase().replace(/(^|[\s-])([a-z])/g, (_, a, b) => a + b.toUpperCase());

/** 고객 안내 메일 — 2026-07-09 승인 문안(Naji Holmes). */
function buildMail({ name, tracking, invoiceNo, amount, brand }) {
  const first = titleCase(String(name).trim().split(/\s+/)[0]) || "there";
  const shop = brand === "PAULVICE" ? "PAULVICE" : "Harriot Watches";
  const subject = `Action needed - outstanding customs duties on your ${brand === "PAULVICE" ? "PAULVICE" : "Harriot"} order (FedEx #${tracking})`;
  const body = `Hi ${first},

Thank you again for your order with ${shop}.

We were notified by FedEx that the import duties and taxes on your shipment have not yet been paid. As the recipient, these charges are payable by you to your local customs authority (collected via FedEx). The details are:

  - Tracking number: ${tracking}
  - FedEx invoice number: ${invoiceNo}
  - Amount due: USD $${amount.toFixed(2)}

You can settle this quickly in one of two ways:

  1. Online — go to www.fedex.com/payment, select United States, and enter the invoice number above.
  2. By phone — call FedEx US at 1-888-780-4580 to pay directly over the phone.

Please take care of this as soon as possible, as FedEx will continue to follow up on the unpaid amount until it's settled.

If you've already paid, or if you have any questions about the charge, just reply to this email and we'll be glad to help.

Thank you so much!

Warm regards,
${shop}`;
  return { subject, body, fromName: shop };
}

async function sendMail({ to, subject, body, fromName }) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error(`이메일 형식 이상: ${to}`);
  if (/[^\x20-\x7e]/.test(subject)) throw new Error("제목에 ASCII 가 아닌 글자");
  const { data } = await db().from("kv_store").select("data").eq("key", SENDER_TOKEN_KEY).maybeSingle();
  const refresh = typeof data.data === "string" ? data.data : data.data && data.data.refresh_token;
  const at = await googleToken(refresh);
  const mime = [
    `From: ${fromName} <shong@harriotwatches.com>`, `To: ${to}`, `Subject: ${subject}`,
    "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "",
    Buffer.from(body, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n"),
  ].join("\r\n");
  const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST", headers: { Authorization: `Bearer ${at}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: Buffer.from(mime).toString("base64url") }), signal: AbortSignal.timeout(30000),
  });
  const j = await r.json();
  if (!r.ok || !j.id) throw new Error(`Gmail 발송 실패 ${r.status} ${JSON.stringify(j).slice(0, 160)}`);
  return j.id;
}

/** "19/6/2026" · "2026. 3. 11." → Date. 못 읽으면 null. */
function parseDate(s) {
  const n = String(s).match(/\d+/g).map(Number);
  if (n.length !== 3) return null;
  const [y, mo, d] = n[0] > 31 ? n : [n[2], n[1], n[0]];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return isNaN(dt) ? null : dt;
}

// 문법검사로 require 만 해도 실제 메일이 나가지 않게(fedexLabelWatch 9/30 사고와 같은 가드)
if (require.main !== module) { module.exports = { parseRows, buildMail, sendMail, findByTracking, findByName }; return; }

(async () => {
  try {
    const sb = db();
    const { data: accs } = await sb.from("cs_accounts").select("display_name,credentials").eq("channel", "gmail");
    const acc = (accs || []).find((a) => String(a.display_name).toLowerCase() === WATCH_ACCOUNT);
    if (!acc || !acc.credentials || !acc.credentials.refresh_token) throw new Error(`${WATCH_ACCOUNT} 토큰 없음(cs_accounts)`);
    const AT = { Authorization: `Bearer ${await googleToken(acc.credentials.refresh_token)}` };
    const q = `from:noreply@fedex.com subject:"미지급 관세" newer_than:${DAYS}d`;
    const list = await (await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=30`, { headers: AT, signal: AbortSignal.timeout(20000) })).json();
    if (list.error) throw new Error(`Gmail 검색 실패: ${JSON.stringify(list.error).slice(0, 160)}`);
    const ids = (list.messages || []).map((m) => m.id).reverse(); // 오래된 것부터

    const kv = (await sb.from("kv_store").select("data").eq("key", KV_KEY).maybeSingle()).data;
    const state = (kv && kv.data) || { invoices: {}, mails: [] };
    state.invoices = state.invoices || {}; state.mails = state.mails || [];
    const seenMails = new Set(state.mails);
    let mailed = 0, alerts = 0;

    for (const id of ids) {
      if (seenMails.has(id)) continue;
      const m = await (await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, { headers: AT, signal: AbortSignal.timeout(20000) })).json();
      const text = mailText(m.payload);
      const when = new Date(Number(m.internalDate)).toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 16);
      const rows = parseRows(text);
      if (!rows.length) {
        log(`파싱 실패 ${id} (${when})`);
        if (SEND) { await relayText(`🔴 페덱스 미지급 관세 경고 메일을 읽지 못했습니다(${when}). harriotwatches@gmail.com 에서 직접 확인해 주세요.\n\n${text.slice(0, 500)}`); seenMails.add(id); alerts++; }
        continue;
      }
      let deferred = false;
      for (const r of rows) {
        const inv = state.invoices[r.invoiceNo];
        const due = (() => { const d = parseDate(r.invoiceDate); return d ? new Date(d.getTime() + 60 * 86400000).toISOString().slice(0, 10) : "?"; })();
        const head = `${titleCase(r.name)} · $${r.amount} · 송장 ${r.tracking} · 관세 인보이스 ${r.invoiceNo} · 경과 ${r.age}일(우리에게 넘어오는 날 ≈ ${due})`;
        if (inv && inv.mailedAt) {
          log(`재경고(이미 안내함 ${inv.mailedAt.slice(0, 10)}): ${head}`);
          if (SEND) { await relayText(`⚠️ 페덱스 관세 아직 미납 — ${head}\n고객(${inv.email})에게는 ${inv.mailedAt.slice(0, 10)} 안내 메일을 보냈습니다. 그대로면 우리 계정으로 청구됩니다.`); alerts++; }
          continue;
        }
        if (inv && inv.status === "manual") { log(`수동 처리 대기 건(재알림 안 함): ${head}`); continue; }
        if (!(r.amount > 0 && r.amount < 1000)) {
          log(`금액 이상 — 발송 안 함: ${head}`);
          if (SEND) { state.invoices[r.invoiceNo] = { ...r, status: "manual", firstSeen: new Date().toISOString() }; await relayText(`🔴 페덱스 미지급 관세 — 금액이 이상해 고객 메일을 보내지 않았습니다.\n${head}`); alerts++; }
          continue;
        }
        let who = await findByTracking(r.tracking);
        if (!who || who.retry || !who.email) {
          const byName = await findByName(r.name);
          if (byName) who = byName;
          else if (who && who.retry) {
            const tries = ((inv && inv.tries) || 0) + 1;
            if (tries < 4) { log(`카페24 토큰 만료로 고객 조회 보류(${tries}/3): ${head}`); if (SEND) state.invoices[r.invoiceNo] = { ...r, tries, firstSeen: (inv && inv.firstSeen) || new Date().toISOString() }; deferred = true; continue; }
            who = null;
          }
        }
        if (!who || !who.email) {
          log(`고객 이메일 못 찾음 — 수동: ${head}`);
          if (SEND) { state.invoices[r.invoiceNo] = { ...r, status: "manual", firstSeen: new Date().toISOString() }; await relayText(`🔴 페덱스 미지급 관세 — 고객 이메일을 못 찾아 안내 메일을 보내지 못했습니다. 수동 처리 필요.\n${head}`); alerts++; }
          continue;
        }
        if (mailed >= MAX_MAILS) { log(`한 번에 ${MAX_MAILS}통 상한 — 다음 실행으로 미룸: ${head}`); deferred = true; continue; }
        const mail = buildMail({ name: who.name || r.name, tracking: r.tracking, invoiceNo: r.invoiceNo, amount: r.amount, brand: who.brand });
        log(`${SEND ? "발송" : "[드라이런] 발송 예정"} → ${who.email} (${who.source}) | ${mail.subject}`);
        if (!SEND) { console.log(mail.body + "\n"); continue; }
        const sentId = await sendMail({ to: who.email, ...mail });
        mailed++;
        state.invoices[r.invoiceNo] = { ...r, email: who.email, source: who.source, mailedAt: new Date().toISOString(), sentId, firstSeen: (inv && inv.firstSeen) || new Date().toISOString() };
        // 메일이 나간 즉시 기록 — 뒤에서 죽어도 같은 고객에게 두 번 가지 않게
        await sb.from("kv_store").upsert({ key: KV_KEY, data: state, updated_at: new Date().toISOString() }, { onConflict: "key" });
        await relayText(`📮 페덱스 미지급 관세 경고 → 고객에게 납부 안내 메일을 보냈습니다.\n${head}\n수신: ${who.email} (${who.source})\n발신: shong@ · 제목 "${mail.subject}"`);
        alerts++;
      }
      if (SEND && !deferred) seenMails.add(id);
    }

    if (SEND) {
      state.mails = [...seenMails].slice(-200);
      await sb.from("kv_store").upsert({ key: KV_KEY, data: state, updated_at: new Date().toISOString() }, { onConflict: "key" });
      await beat("fedex-duty-watch", { checked: ids.length, mailed, alerts });
    }
    log(`완료 — 경고 메일 ${ids.length}건 조회 · 고객 메일 ${mailed}통 · 텔레그램 ${alerts}건${SEND ? "" : " (드라이런)"}`);
  } catch (e) {
    log(`실패: ${(e && e.message) || e}`);
    if (SEND) { try { await require("./notifyFail").notifyFail("페덱스 미지급 관세 감시", (e && e.message) || String(e)); } catch { /* 알림 실패는 무시 */ } }
    process.exitCode = 1;
  }
})();
