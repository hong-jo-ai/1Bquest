/**
 * 조선몰(디즈먼트) 일일 발주서 → 우체국 접수 → 송장 기입 회신 초안.
 *
 * 흐름: shong@ 메일에서 오늘자 `[디즈먼트] YYYYMMDD 발주서` 첨부(xlsx) 수신
 *       → 파싱 → registerSingle(seller="조선몰") 접수 → 원본 엑셀의 택배사/송장 열 기입
 *       → **회신 초안**(같은 스레드) 생성 + 텔레그램 요약.
 *
 * ⚠️ 자동 발송하지 않는다. 송장 회신 = "오늘 출고했다"는 약속이라, 실제 출고를 확인한
 *    사람이 눌러야 한다. 초안까지만 만들고 사장님이 보낸다.
 * ⚠️ 마감이 **오후 5시**(업무마감 5시 30분)다. 회신이 늦으면 당월 정산에서 빠진다.
 * ⚠️ 우편번호가 엑셀 서식 탓에 `080-18`, `054-10` 처럼 하이픈이 끼어 온다 → 숫자만 남긴다.
 * ⚠️ **각인 주문**은 배송메세지에 섞여 온다. 배송메시지에선 떼어내되(집배원에게 갈 문구가 아니다)
 *    **품목명에 `(각인:값)` 으로 실어 송장에 찍히게 한다** — 송장을 먼저 뽑아 그걸 보고
 *    각인 작업을 하므로, 송장에 없으면 각인이 누락된다.
 *
 * 실행: node chosunmallPoSync.js          (드라이런 — 접수·초안 안 만듦)
 *       node chosunmallPoSync.js --send   (실접수 + 회신 초안 생성)
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
const XLSX = require(path.join(DASH, "node_modules/xlsx"));
const { registerSingle } = require("./postParcel/register");
const { sendTelegram } = require("./notifyFail");
const { beat } = require("./heartbeat");

const SELLER = "조선몰";
const VENDOR = "cs@thevividcon.com";
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

// 발주서 열 배치(2026-09-01 실측). 헤더명으로 잡되, 못 찾으면 이 인덱스로 폴백한다.
const COL = {
  order: 0, poDate: 1, product: 2, code: 3, option: 4, kind: 5, qty: 6,
  courier: 7, tracking: 8, name: 9, zip: 10, addr: 11, tel: 12, mobile: 13,
  buyer: 14, buyerMobile: 15, msg: 16,
};

async function gmailToken() {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data } = await sb.from("kv_store").select("data").eq("key", "google_refresh_token").maybeSingle();
  const rt = typeof data.data === "string" ? data.data : (data.data.refresh_token || data.data);
  const j = await (await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: rt, grant_type: "refresh_token",
    }),
  })).json();
  if (!j.access_token) throw new Error(`Gmail 토큰 실패: ${JSON.stringify(j).slice(0, 160)}`);
  return j.access_token;
}

/** 가장 최근 발주서 메일 + 첨부 xlsx. */
async function fetchLatestPo(H) {
  const q = encodeURIComponent(`from:${VENDOR} subject:발주서 has:attachment newer_than:3d`);
  const list = await (await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=5`, { headers: H })).json();
  for (const ref of list.messages ?? []) {
    const m = await (await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${ref.id}?format=full`, { headers: H })).json();
    const hdr = (n) => (m.payload.headers || []).find((h) => h.name === n)?.value || "";
    const subject = hdr("Subject");
    const parts = [];
    (function walk(p) { if (p.filename && p.body?.attachmentId) parts.push(p); (p.parts || []).forEach(walk); })(m.payload);
    const xlsx = parts.find((p) => /\.xlsx$/i.test(p.filename));
    if (!xlsx) continue;
    const a = await (await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${ref.id}/attachments/${xlsx.body.attachmentId}`, { headers: H })).json();
    return {
      messageId: ref.id, threadId: m.threadId, subject,
      messageIdHeader: hdr("Message-ID"), references: hdr("References"),
      fileName: xlsx.filename,
      buffer: Buffer.from(a.data.replace(/-/g, "+").replace(/_/g, "/"), "base64"),
      date: new Date(Number(m.internalDate)),
    };
  }
  return null;
}

const digits = (v) => String(v ?? "").replace(/\D/g, "");

// 고객이 안 고른 기본 문구가 그대로 실려 온다 — 집배원에게 보낼 말이 아니다.
const PLACEHOLDER_MSG = /^(--.*선택.*--|정보\s*없음|없음|선택안함|-)$/;

/**
 * 배송메세지에서 각인 문구를 떼어낸다. 집배원에게 갈 문구가 아니다.
 *
 * 각인이 오는 형태가 **세 가지**다(2026-09-01 실측). 한 발주서 안에 섞여 온다.
 *  ① `[추가옵션] 각인 문구 입력=Good Job`
 *  ② `[추가옵션] additional_options=각인 문구 입력=JFOREVER`  ← 접두가 하나 더 붙는다
 *  ③ 배송메세지에 직접 — "각인요청 - 다이얼 9시 방면 문구 : … - 시계뒷면: 이상구"
 * 하나라도 못 잡으면 각인 요청이 배송메시지로 흘러가 **각인 없이 출고된다.**
 * 그래서 `각인 문구 입력=` 을 문자열 어디서든 찾는다(접두 무관).
 */
function splitMessage(raw, option) {
  const s = String(raw ?? "").trim();
  const tagged = s.match(/각인\s*문구\s*입력\s*=\s*(.*)$/);
  let engraving = tagged ? tagged[1].trim() : "";
  let msg = s.replace(/\[추가옵션\][\s\S]*$/, "").trim();

  // 옵션에 "각인 추가" 라고 적혀 있으면 각인 건이다 — 문구를 어디서든 찾아야 한다.
  const wantsEngraving = /각인\s*추가/.test(String(option ?? ""));
  if (!engraving && /각인/.test(msg)) {
    engraving = msg;   // 배송메세지 자체가 각인 요청문인 경우
    msg = "";
  }
  if (PLACEHOLDER_MSG.test(msg)) msg = "";
  return { msg, engraving, engravingMissing: wantsEngraving && !engraving };
}

/**
 * 각인 문구가 색상별로 갈려 오는 경우를 쪼갠다.
 *   "실버각인 - K.HAN.SUK  로즈골드 각인 - shinseop"  → 실버행엔 K.HAN.SUK, 로즈골드행엔 shinseop
 * 한 주문에 색상이 섞여 있으면 고객이 이렇게 한 칸에 몰아 쓴다(2026-09-02 강한석 건).
 * 그대로 두면 송장 4장에 같은 문구가 찍혀 어느 걸 새길지 알 수 없다.
 */
function engravingForColor(engraving, color) {
  const text = String(engraving ?? "");
  if (!color || !text) return text;
  // "<색상>...각인...- 값" 조각들을 찾는다. 색상 토큰이 2개 이상일 때만 쪼갠다.
  const seg = [...text.matchAll(/(로즈골드|실버|선레이|골드)\s*각인\s*[-:]?\s*([^\n]*?)(?=(?:로즈골드|실버|선레이|골드)\s*각인|$)/g)]
    .map((m) => ({ color: m[1], value: m[2].trim() }))
    .filter((x) => x.value);
  if (seg.length < 2) return text;
  const hit = seg.find((x) => color.includes(x.color) || x.color.includes(color));
  return hit ? hit.value : text;
}

/**
 * 옵션 열에서 색상을 뽑는다. **키 이름이 라인마다 다르다**(2026-09-03 실측).
 *   · 서해 — `색상=실버, 각인선택=각인 안함`
 *   · 성산 — `옵션 선택=성산 로즈골드`      ← 라인명이 값 앞에 붙어 온다
 * `색상=` 만 보던 탓에 성산은 색이 통째로 빠져, 송장 품목명이 "해리엇 성산 시리즈 시계"로
 * 나가고(포장할 때 무슨 색인지 알 수 없다) 매출 적재도 색을 못 읽어 **재고가 안 빠졌다**
 * (2026-09-03 서기원 20260902-0002783). 어제 고친 조선몰 재고 누락과 같은 계열의 다른 구멍.
 *
 * 각인 옵션(`각인선택=각인 추가`)은 건너뛴다 — 색상이 아니다.
 * 라인명이 붙어 오는 형태는 **상품명에 이미 있는 단어를 빼서** 남는 말만 쓴다.
 * 통째로 남기는 이유: "성산 실버 여성용" 처럼 색 뒤에 사양이 더 붙는 상품이 있어
 * 색상 토큰만 뽑으면 "여성용"이 사라져 엉뚱한 SKU 에서 빠진다.
 */
function colorOf(option, product) {
  const prod = String(product ?? "");
  for (const seg of String(option ?? "").split(",")) {
    const eq = seg.indexOf("=");
    if (eq < 0) continue;
    const key = seg.slice(0, eq).trim();
    const val = seg.slice(eq + 1).trim();
    if (!val || /각인/.test(key) || /각인/.test(val)) continue;
    if (/색상|컬러/.test(key)) return val;
    const rest = val.split(/\s+/).filter((w) => !prod.includes(w)).join(" ").trim();
    if (rest) return rest;
  }
  return "";
}

function parsePo(buffer) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheetName = wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: "", raw: false });
  const head = (rows[0] || []).map((h) => String(h).replace(/\s+/g, ""));
  const at = (key, fallback) => {
    const i = head.indexOf(key);
    return i >= 0 ? i : fallback;
  };
  const idx = {
    order: at("주문번호", COL.order), product: at("주문상품명", COL.product),
    option: at("옵션", COL.option), qty: at("수량", COL.qty),
    courier: at("택배사명", COL.courier), tracking: at("송장번호", COL.tracking),
    name: at("수령인", COL.name), zip: at("우편번호", COL.zip), addr: at("주소", COL.addr),
    tel: at("전화번호", COL.tel), mobile: at("핸드폰", COL.mobile), msg: at("배송메세지", COL.msg),
  };

  const orders = [];
  for (let r = 1; r < rows.length; r++) {
    const c = rows[r] || [];
    const order = String(c[idx.order] ?? "").trim();
    if (!/^\d{8}-\d+$/.test(order)) continue;
    const option = String(c[idx.option] ?? "");
    const { msg, engraving, engravingMissing } = splitMessage(c[idx.msg], option);
    const color = colorOf(option, c[idx.product]);
    orders.push({
      rowIndex: r,
      order,
      seller: SELLER,
      name: String(c[idx.name] ?? "").trim(),
      // 주문자명에 "_전화주문_카" 같은 꼬리표가 붙는 경우가 있어 수령인만 쓴다.
      mobile: digits(c[idx.mobile]) || digits(c[idx.tel]),
      // 엑셀 서식이 우편번호를 `080-18` 로 망가뜨린다 → 숫자만.
      zip: digits(c[idx.zip]),
      addr: String(c[idx.addr] ?? "").trim(),
      // ⚠️ 각인 문구는 **품목명에 실어야 한다.** 사장님은 송장을 먼저 뽑고, 거기 적힌 대로
      //    시계를 챙겨 각인 작업을 한다 → 송장에 안 찍히면 각인을 못 한다(2026-09-01 지적).
      //    카페24 건은 buildPostOffice 가 이미 `(각인:값)` 으로 붙이고 있었는데 조선몰만 빠졌다.
      color,
      prod: [String(c[idx.product] ?? "").trim(), color].filter(Boolean).join(" - ")
        + (engraving ? ` (각인:${engravingForColor(engraving, color)})` : ""),
      qty: String(c[idx.qty] ?? "1").trim() || "1",
      // 각인은 **배송메시지에도** 싣는다. 품목명은 길면 송장에서 잘려
      // "다이얼 9시 방면 문구 : …" 같은 긴 지시가 통째로 사라진다(사장님 제안 2026-09-01).
      // 배송요청이 먼저다 — 집배원이 볼 문구를 각인이 밀어내면 안 된다.
      msg: [msg, engraving ? `[각인] ${engravingForColor(engraving, color)}` : ""].filter(Boolean).join(" "),
      engraving: engravingForColor(engraving, color),
      engravingMissing,
    });
  }
  // ⚠️ 한 주문에 여러 상품이면 행이 여러 개로 온다(강한석 4개). 접수 dedup 은
  //    order_number+channel 기준이라 **묶지 않으면 첫 행만 접수되고 나머지는 조용히 누락**된다.
  //    같은 주문 = 같은 주소 = 한 소포이므로 하나로 합친다.
  const merged = [];
  const byOrder = new Map();
  for (const o of orders) {
    const cur = byOrder.get(o.order);
    if (!cur) { byOrder.set(o.order, { ...o, lines: [o.prod], rowIndexes: [o.rowIndex] }); merged.push(byOrder.get(o.order)); continue; }
    cur.lines.push(o.prod);
    cur.rowIndexes.push(o.rowIndex);
    cur.qty = String(Number(cur.qty) + Number(o.qty || 1));
    if (!cur.msg && o.msg) cur.msg = o.msg;
    if (o.engraving) cur.engraving = [cur.engraving, o.engraving].filter(Boolean).join(" / ");
    if (o.engravingMissing) cur.engravingMissing = true;
  }
  for (const o of merged) {
    if (o.lines.length > 1) {
      // 품목명에 전부 나열 — 송장을 보고 챙기므로 몇 개가 무슨 각인인지 다 보여야 한다.
      o.prod = o.lines.map((l, i) => `${i + 1}) ${l.replace(/^\[단독최저가\]\s*/, "")}`).join(" + ");
      o.msg = [o.msg.replace(/\s*\[각인\][\s\S]*$/, "").trim(), `[각인] ${o.engraving}`].filter(Boolean).join(" ");
    }
  }
  return { wb, sheetName, rows, idx, orders: merged };
}

/** 접수 결과를 원본 엑셀의 택배사/송장 열에 기입해 새 버퍼로 만든다. */
function fillTracking(parsed, results) {
  const { wb, sheetName, idx } = parsed;
  const ws = wb.Sheets[sheetName];
  const byOrder = new Map(results.map((r) => [r.order, r.regiNo]));
  for (const o of parsed.orders) {
    const regi = byOrder.get(o.order);
    if (!regi) continue;
    const set = (col, val) => {
      const ref = XLSX.utils.encode_cell({ r: o.rowIndex, c: col });
      ws[ref] = { t: "s", v: String(val) };
    };
    set(idx.courier, "우체국택배");
    set(idx.tracking, regi);
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

async function createReplyDraft(H, po, results, buffer) {
  const b64 = (b) => b.toString("base64").replace(/(.{76})/g, "$1\r\n");
  const enc = (s) => "=?UTF-8?B?" + Buffer.from(s, "utf8").toString("base64") + "?=";
  const lines = results.map((r) => `- ${r.order} ${r.name} / 우체국택배 ${r.regiNo}`).join("<br>");
  const html =
    `<div style="font-family:'Apple SD Gothic Neo',sans-serif;font-size:14px;line-height:1.7">` +
    `<p>안녕하세요, 해리엇와치스입니다.</p>` +
    `<p>${po.subject.match(/\d{8}/)?.[0] ?? ""} 발주 ${results.length}건 금일 출고 완료했습니다.<br>` +
    `발주 파일에 송장번호 기입하여 첨부드립니다.</p><p>${lines}</p>` +
    `<p>감사합니다.</p></div>`;

  const B = "cm_" + Math.abs(Date.now() % 1e9).toString(36);
  let mime = [
    `To: ${VENDOR}`,
    `From: shong@harriotwatches.com`,
    `Subject: ${enc(`Re: ${po.subject} - 송장 회신 (해리엇와치스)`)}`,
    po.messageIdHeader ? `In-Reply-To: ${po.messageIdHeader}` : "",
    po.messageIdHeader ? `References: ${[po.references, po.messageIdHeader].filter(Boolean).join(" ")}` : "",
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${B}"`,
  ].filter(Boolean).join("\r\n") + "\r\n\r\n";
  mime += `--${B}\r\nContent-Type: text/html; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(Buffer.from(html, "utf8"))}\r\n`;
  mime += `--${B}\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet; name="${enc(po.fileName)}"\r\n` +
          `Content-Disposition: attachment; filename="${enc(po.fileName)}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(buffer)}\r\n`;
  mime += `--${B}--`;

  const raw = Buffer.from(mime, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
    method: "POST", headers: { ...H, "Content-Type": "application/json" },
    body: JSON.stringify({ message: { raw, threadId: po.threadId } }),
  });
  const j = await res.json();
  if (!j.id) throw new Error(`회신 초안 실패: ${JSON.stringify(j).slice(0, 200)}`);
  return j.id;
}

(async () => {
  const send = process.argv.includes("--send");
  require("./parcelHolidays").checkOrExit("조선몰 발주 접수");

  const H = { Authorization: `Bearer ${await gmailToken()}` };
  const po = await fetchLatestPo(H);
  if (!po) { log("발주서 메일 없음 — 종료"); await beat("chosunmall-po-sync", { orders: 0 }); return; }
  log(`발주서: ${po.subject} (${po.fileName}, ${po.date.toISOString().slice(0, 10)})`);

  const parsed = parsePo(po.buffer);
  log(`발주 ${parsed.orders.length}건 (dry=${!send})`);
  const engraved = parsed.orders.filter((o) => o.engraving);

  const results = [];
  const failed = [];
  for (const o of parsed.orders) {
    console.log(`\n[${o.order}] ${o.name} ${o.mobile} / ${o.zip} ${o.addr}`);
    console.log(`   ${o.prod} ×${o.qty}${o.msg ? ` · "${o.msg}"` : ""}${o.engraving ? `\n   ✍️ 각인: ${o.engraving}` : ""}`);
    if (!o.zip || !o.addr || !o.mobile) { failed.push(`${o.order} ${o.name}: 주소·연락처 누락`); console.log("   ✗ 필수값 누락 — 건너뜀"); continue; }
    // 각인 주문인데 문구를 못 찾았다 = 새길 내용을 모른 채 라벨만 뽑는 상황. 사람이 봐야 한다.
    if (o.engravingMissing) { failed.push(`${o.order} ${o.name}: 각인 주문인데 문구를 못 찾음 — 발주서 직접 확인`); console.log("   ✗ 각인 문구 없음 — 건너뜀"); continue; }
    if (!send) { console.log("   DRY RUN"); continue; }
    try {
      const r = await registerSingle(o, { reqType: "1" });
      console.log(`   → 송장 ${r.regiNo} / ${r.regipoNm} / ${r.price}원${r.skipped ? " (이미접수)" : ""}`);
      results.push({ order: o.order, name: o.name, regiNo: r.regiNo });
    } catch (e) {
      failed.push(`${o.order} ${o.name}: ${e.message}`);
      console.log(`   ✗ ${e.message}`);
    }
  }

  let draftId = null;
  if (send && results.length) {
    draftId = await createReplyDraft(H, po, results, fillTracking(parsed, results)).catch((e) => {
      failed.push(`회신 초안: ${e.message}`); return null;
    });
    if (draftId) log(`회신 초안 생성됨 (${draftId})`);
  }

  if (send) {
    const msg =
      `📦 <b>조선몰 발주 ${parsed.orders.length}건</b> — 접수 ${results.length}건\n` +
      results.map((r) => `· ${r.order} ${r.name} / ${r.regiNo}`).join("\n") +
      (engraved.length ? `\n\n✍️ <b>각인 ${engraved.length}건 — 새기고 출고하세요</b>\n` +
        engraved.map((o) => `· ${o.name}: <b>${o.engraving}</b>`).join("\n") : "") +
      (failed.length ? `\n\n🔴 실패 ${failed.length}건\n${failed.join("\n")}` : "") +
      `\n\n${draftId ? "회신 초안이 shong@ 임시보관함에 있습니다." : "⚠️ 회신 초안 미생성"}` +
      `\n<b>마감 오후 5시</b> — 출고 확인 후 초안을 보내주세요.`;
    await sendTelegram(msg, { tag: "chosunmall-po" });
  }

  // 접수가 끝나면 대시보드 매출도 같이 올린다 — 조선몰은 카페24를 안 타서
  // 이걸 안 하면 매출이 통째로 대시보드에서 빠진다(사장님 지적 2026-09-01).
  if (send && results.length) {
    try {
      const { execFileSync } = require("child_process");
      const out = execFileSync(process.execPath, ["chosunmallRevenue.js", "--send"], { cwd: __dirname, encoding: "utf8" });
      log(`매출 적재: ${out.trim().split("\n").slice(-1)[0]}`);
    } catch (e) {
      log(`⚠️ 매출 적재 실패(접수는 정상): ${e.message.slice(0, 120)}`);
    }
  }

  await beat("chosunmall-po-sync", { orders: parsed.orders.length, registered: results.length });
  log("=== 완료 ===");
  process.exit(0);
})().catch(async (e) => {
  console.error("ERR", e);
  try { await sendTelegram(`🔴 조선몰 발주 처리 실패\n${e.message || e}`, { tag: "chosunmall-po" }); } catch {}
  process.exit(1);
});
