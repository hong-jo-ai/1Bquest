/**
 * 카카오선물하기 반품·교환 요청 메일 → 우체국 회수 접수 → 피오르드에 반송장 회신 → 텔레그램 알림.
 *
 * 사장님 지시(2026-10-02): "김송이(카카오선물하기)에서 반품 또는 교환 요청 메일 오면 바로 확인하고
 *   택배회수하고 답장 보내줘. 텔레그램으로 알려주고." — 이 메일 한 종류에 한한 **상시 승인**이다(문구 확인 없이 회신).
 *
 * 배경: 카카오선물은 피오르드가 대행하고, 반품이 들어오면 song@fjord.kr 가 plvekorea@gmail.com 으로
 *   "…반품 요청의 건…" 메일을 보낸다. 회수는 우리가 직접 접수해야 하는 채널이다(shipping.md §4).
 *   10/1 고민정 건은 하루 넘게 답이 없어 피오르드가 재촉 메일을 보냈다.
 *
 * 동작(10분마다):
 *   1) plvekorea@ 에서 song@fjord.kr 의 제목에 반품/교환이 들어간 메일을 읽고 본문의 `*항목 : 값` 블록을 뽑는다.
 *   2) 그 주문이 우리가 출고한 카카오선물 건인지 pp_shipments 로 확인한다(주문번호 일치). 아니면 손대지 않고 알린다.
 *   3) registerReturn — 착불 회수(서초 공급지 도착). 결과가 **2,200원·7890 대역**이 아니면 선불 사고라 회신하지 않고 알린다.
 *   4) 같은 스레드에 반송장 번호를 회신(참조 그대로)하고 텔레그램으로 알린다.
 *   교환은 회수까지만 한다 — 새 제품 재발송은 물건을 확인한 뒤 사람이 `-EX` 로 보낸다(알림에 적는다).
 *
 * 안전장치: 주문번호당 한 번만(kv `kakao_gift_returns`) · 한 번 실행에 최대 3건 · 항목을 못 뽑으면 접수하지 않고 알림 ·
 *   기본은 드라이런(`--send` 가 있어야 실제 접수·회신).
 *
 * 실행: node kakaoGiftReturnWatch.js          드라이런(무엇을 할지 출력만)
 *       node kakaoGiftReturnWatch.js --send   실제 접수·회신·알림 (launchd, 10분마다)
 */
const fs = require("fs");
const path = require("path");
const DASH = path.resolve(__dirname, "..");
require("dotenv").config({ path: path.join(__dirname, ".env"), override: true });
for (const p of [`${DASH}/.env.supabase`, `${DASH}/.env.local`]) {
  try { for (const l of fs.readFileSync(p, "utf8").split("\n")) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  } } catch { /* 없으면 무시 */ }
}
const { createClient } = require(`${DASH}/node_modules/@supabase/supabase-js`);
const { relayText } = require("./telegramRelay");
const { beat } = require("./heartbeat");

const SEND = process.argv.includes("--send");
const KV_KEY = "kakao_gift_returns";
const TOKEN_KEY = "kakao_gift_gmail_token"; // plvekorea@gmail.com
const FROM = "song@fjord.kr";
const CHANNEL = "카카오선물하기";
const MAX_PER_RUN = 3;
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);

const hdr = (payload, name) => ((payload.headers || []).find((h) => h.name.toLowerCase() === name.toLowerCase()) || {}).value || "";
function bodyText(payload) {
  const plain = [], html = [];
  (function walk(p) { if (!p) return; const d = p.body && p.body.data ? Buffer.from(p.body.data, "base64").toString("utf8") : ""; if (p.mimeType === "text/plain" && d) plain.push(d); if (p.mimeType === "text/html" && d) html.push(d); (p.parts || []).forEach(walk); })(payload);
  if (plain.length) return plain.join("\n");
  return html.join("\n").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr)>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");
}

/** 메일 본문의 `*항목 : 값` 블록 → 요청 내용. 재촉 메일은 원문을 인용하므로 인용 표시(>)를 떼고 첫 블록을 쓴다. */
function parseRequest(subject, text) {
  const t = text.split("\n").map((l) => l.replace(/^[>\s|]+/, "").trim()).join("\n");
  const get = (label) => { const m = t.match(new RegExp(`\\*\\s*${label}\\s*[:;：]\\s*(.+)`)); return m ? m[1].trim() : ""; };
  const kind = /교환/.test(subject) && !/반품/.test(subject) ? "교환" : "반품";
  const order = (get("주문번호").match(/\d{6,}/) || [""])[0];
  const where = get("고객 수거지 정보") || get("고객 정보");
  const w = where.match(/\((\d{5})\)\s*(.+?)\s*[ㅣ|]\s*(.+?)\s*[ㅣ|]\s*([\d\-]{9,})/);
  const prod = get("상품명").replace(/^\d+\s*\/\s*[^/]+\/\s*/, ""); // "12062384/폴바이스/상품명" → 상품명
  return {
    kind, order, prod, option: get("옵션명"), qty: (get("수량").match(/\d+/) || ["1"])[0],
    origInvoice: (get("송장번호").match(/\d{10,}/) || [""])[0],
    reason: get(`${kind} 요청 사유`) || get("요청 사유"), detail: get("상세 사유"),
    zip: w ? w[1] : "", addr: w ? w[2].trim() : "", name: w ? w[3].trim() : "", mobile: w ? w[4].trim() : "",
  };
}

if (require.main !== module) { module.exports = { parseRequest }; return; }

(async () => {
  try {
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data: tk } = await sb.from("kv_store").select("data").eq("key", TOKEN_KEY).maybeSingle();
    const refresh = typeof tk.data === "string" ? tk.data : tk.data.refresh_token;
    const tj = await (await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, refresh_token: refresh, grant_type: "refresh_token" }), signal: AbortSignal.timeout(20000) })).json();
    if (!tj.access_token) throw new Error(`구글 토큰 갱신 실패: ${JSON.stringify(tj).slice(0, 160)}`);
    const H = { Authorization: `Bearer ${tj.access_token}`, "Content-Type": "application/json" };

    const q = `from:${FROM} subject:(반품 OR 교환) newer_than:7d`;
    const list = await (await fetch(`${GMAIL}/messages?q=${encodeURIComponent(q)}&maxResults=20`, { headers: H, signal: AbortSignal.timeout(20000) })).json();
    if (list.error) throw new Error(`Gmail 검색 실패: ${JSON.stringify(list.error).slice(0, 160)}`);
    const ids = (list.messages || []).map((m) => m.id).reverse(); // 오래된 것부터

    const kv = (await sb.from("kv_store").select("data").eq("key", KV_KEY).maybeSingle()).data;
    const state = (kv && kv.data) || {};
    state.orders = state.orders || {}; state.mails = state.mails || [];
    const seen = new Set(state.mails);
    const save = async () => { state.mails = [...seen].slice(-300); const r = await sb.from("kv_store").upsert({ key: KV_KEY, data: state, updated_at: new Date().toISOString() }, { onConflict: "key" }); if (r.error) throw new Error(`kv 저장 실패: ${r.error.message}`); };
    let handled = 0;

    for (const id of ids) {
      if (seen.has(id)) continue;
      const msg = await (await fetch(`${GMAIL}/messages/${id}?format=full`, { headers: H, signal: AbortSignal.timeout(20000) })).json();
      const subject = hdr(msg.payload, "Subject");
      const req = parseRequest(subject, bodyText(msg.payload));
      const tag = `${req.kind} ${req.order || "?"} ${req.name || "?"}`;

      if (req.order && state.orders[req.order]) { log(`이미 처리한 주문(재촉·후속 메일) — ${tag}`); if (SEND) seen.add(id); continue; }
      if (!req.order || !req.zip || !req.addr || !req.name || !req.mobile) {
        log(`항목을 못 뽑음 — 접수 안 함: "${subject}" → ${JSON.stringify(req)}`);
        if (SEND) { await relayText(`🔴 카카오선물 ${req.kind} 요청 메일을 읽지 못해 회수 접수를 하지 못했습니다. plvekorea@ 에서 직접 확인해 주세요.\n제목: ${subject}`); seen.add(id); }
        continue;
      }
      // 우리가 실제로 출고한 카카오선물 주문인지
      const { data: orig } = await sb.from("pp_shipments").select("regi_no,recipient_name,product_name,tracking_state").eq("order_number", req.order).eq("channel", CHANNEL).eq("req_type", "1").maybeSingle();
      if (!orig) {
        log(`출고 기록 없는 주문 — 접수 안 함: ${tag}`);
        if (SEND) { await relayText(`🔴 카카오선물 ${req.kind} 요청이 왔는데 출고 기록에 없는 주문이라 회수 접수를 하지 않았습니다.\n주문 ${req.order} · ${req.name} · ${req.prod}\n제목: ${subject}`); seen.add(id); }
        continue;
      }
      if (handled >= MAX_PER_RUN) { log(`한 번에 ${MAX_PER_RUN}건 상한 — 다음 실행으로: ${tag}`); continue; }

      const prodLine = `${req.prod}${req.option ? ` (${req.option})` : ""} — ${req.kind} 회수`;
      log(`${SEND ? "처리" : "[드라이런] 처리 예정"}: ${tag} | ${req.addr} (${req.zip}) ${req.mobile} | ${prodLine} ×${req.qty} | 원송장 ${orig.regi_no}(${orig.tracking_state || "-"}) | 사유 ${req.reason}`);
      if (!SEND) continue;
      handled++;

      // 회수 접수(착불). 이미 접수돼 있으면 그 송장을 돌려준다(멱등).
      const { registerReturn } = require("./postParcel/register");
      const r = await registerReturn({ order: req.order, seller: CHANNEL, name: req.name, mobile: req.mobile, addr: req.addr, zip: req.zip, prod: prodLine, qty: req.qty });
      let price = String(r.price || "");
      if (!price) { const { data: row } = await sb.from("pp_shipments").select("price").eq("order_number", req.order).eq("channel", CHANNEL).eq("req_type", "2").maybeSingle(); price = String((row && row.price) || ""); }
      const collect = /^7890/.test(String(r.regiNo || "")) && Number(price) === 2200;
      if (!r.regiNo || !collect) {
        state.orders[req.order] = { kind: req.kind, name: req.name, regiNo: r.regiNo || "", price, status: "manual", at: new Date().toISOString(), mailId: id };
        seen.add(id); await save();
        await relayText(`🔴 카카오선물 ${req.kind} 회수 접수 이상 — 회신하지 않았습니다.\n주문 ${req.order} · ${req.name}\n송장 ${r.regiNo || "없음"} · 요금 ${price || "?"}원 (정상은 7890 대역·2,200원 착불)\n선불로 나갔으면 취소 후 재접수가 필요합니다.`);
        log(`접수 이상 — ${tag} 송장 ${r.regiNo} 요금 ${price}`);
        continue;
      }
      state.orders[req.order] = { kind: req.kind, name: req.name, regiNo: r.regiNo, price, at: new Date().toISOString(), mailId: id, existing: !!r.skipped };
      seen.add(id); await save(); // 접수 직후 기록 — 뒤에서 죽어도 두 번 접수·회신하지 않게

      // 같은 스레드에 반송장 회신
      const reSubject = /^re:/i.test(subject) ? subject : `Re: ${subject}`;
      const body = `안녕하세요, 폴바이스입니다.\n\n${req.name} 고객님 ${req.kind} 건 회수 접수했습니다.\n\n- 주문번호: ${req.order}\n- 반송장: 우체국택배 ${r.regiNo}\n- 수거지: (${req.zip}) ${req.addr}\n\n우체국 기사님이 방문 수거할 예정입니다.\n\n감사합니다.\n폴바이스 드림`;
      const enc = (s) => `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;
      // 참조는 주소만 뽑아 쓴다(한글 표시이름을 헤더에 그대로 넣으면 깨진다). 우리 주소는 뺀다.
      const ccList = [...new Set((hdr(msg.payload, "Cc").match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi) || []).map((x) => x.toLowerCase()))].filter((x) => x !== "plvekorea@gmail.com" && x !== FROM);
      const mid = hdr(msg.payload, "Message-ID");
      const mime = [`From: PLVE <plvekorea@gmail.com>`, `To: ${FROM}`, ...(ccList.length ? [`Cc: ${ccList.join(", ")}`] : []), `Subject: ${enc(reSubject)}`, ...(mid ? [`In-Reply-To: ${mid}`, `References: ${mid}`] : []), "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", Buffer.from(body, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n")].join("\r\n");
      const sr = await fetch(`${GMAIL}/messages/send`, { method: "POST", headers: H, body: JSON.stringify({ raw: Buffer.from(mime).toString("base64url"), threadId: msg.threadId }), signal: AbortSignal.timeout(30000) });
      const sj = await sr.json();
      const replied = sr.ok && sj.id;
      state.orders[req.order].repliedAt = replied ? new Date().toISOString() : null;
      state.orders[req.order].replyId = sj.id || null;
      await save();
      log(replied ? `회신 발송 ${sj.id} — ${tag} 반송장 ${r.regiNo}` : `회신 실패 ${sr.status} ${JSON.stringify(sj).slice(0, 160)}`);
      await relayText(
        `📦 카카오선물 ${req.kind} 요청 처리\n${req.name} · 주문 ${req.order}\n${req.prod}${req.option ? ` (${req.option})` : ""} ×${req.qty}\n사유: ${req.reason || "-"}${req.detail && req.detail !== "없음" ? ` / ${req.detail}` : ""}\n` +
        `🚚 회수 접수 ${r.regiNo} (착불 ${price}원${r.skipped ? ", 기존 접수" : ""})\n` +
        (replied ? `✉️ 피오르드에 반송장 회신 완료` : `🔴 피오르드 회신 실패 — 직접 답장 필요`) +
        (req.kind === "교환" ? `\n⚠️ 교환 건입니다 — 물건이 돌아오면 새 제품을 ${req.order}-EX 로 재발송해야 합니다.` : ""),
      );
    }

    if (SEND) { await save(); await beat("kakaogift-return-watch", { checked: ids.length, handled }); }
    log(`완료 — 메일 ${ids.length}건 조회 · 처리 ${handled}건${SEND ? "" : " (드라이런)"}`);
  } catch (e) {
    log(`실패: ${(e && e.message) || e}`);
    if (SEND) { try { await require("./notifyFail").notifyFail("카카오선물 반품·교환 메일 감시", (e && e.message) || String(e)); } catch { /* 무시 */ } }
    process.exitCode = 1;
  }
})();
