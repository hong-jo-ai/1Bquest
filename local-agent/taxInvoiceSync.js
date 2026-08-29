/**
 * 전자세금계산서(현금이체 비용) 자동 수집.
 * shong@harriotwatches.com / plvekorea@gmail.com 메일함의 국세청 전자세금계산서(보안메일,
 * NTS_eTaxInvoice.html)를 받아 Playwright로 사업자번호 입력→복호화→파싱→finance_tax_invoices 적재.
 * 통장 업로드 없이 현금이체 비용을 잡기 위함.
 *
 *   복호화 비번 = 공급받는자 사업자번호: 해리엇와치스 2092770599 / 제이에이치 6632301279.
 *   메일 토큰: shong@=kv google_refresh_token, plvekorea@=kv kakao_gift_gmail_token (refresh).
 *
 * 실행:  node taxInvoiceSync.js          ← 새 메일 수집·적재 (launchd/트리거)
 *        node taxInvoiceSync.js --dry    ← 적재 없이 파싱 결과만 출력(검증)
 *        node taxInvoiceSync.js --days 60
 */
require("dotenv").config({ override: true });
const fs = require("fs"), path = require("path"), os = require("os");
const { chromium } = require("playwright");
const DASH = path.resolve(__dirname, "..");
function le(p) { try { for (const l of fs.readFileSync(p, "utf8").split("\n")) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (!m) continue; let v = m[2].trim().replace(/^["']|["']$/g, ""); if (!(m[1] in process.env)) process.env[m[1]] = v; } } catch {} }
le(path.join(DASH, ".env.supabase")); le(path.join(DASH, ".env.local")); le(path.join(__dirname, ".env"));
const { createClient } = require(path.join(DASH, "node_modules/@supabase/supabase-js"));

const DRY = process.argv.includes("--dry");
const DAYS = (() => { const i = process.argv.indexOf("--days"); return i > 0 ? Number(process.argv[i + 1]) : 75; })();
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
const sb = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const SEEN_KEY = "tax_invoice_seen"; // 처리한 gmail msgId 집합

// 우리 사업자번호(복호화 비번 = 공급받는자 사업자번호). 매입/매출 방향 판별에도 사용.
const PASSWORDS = ["6632301279", "2092770599"];
const OUR_REGS = new Set(PASSWORDS); // 정규화(숫자만) 형태
// ⚠️ 메일함을 빠뜨리면 그 계정으로 온 계산서는 영영 안 잡힌다.
//    harriotwatches@gmail 은 승화프린팅 등 해리엇 초기 거래처가 아직 쓰는 주소인데
//    2026-08-24까지 감시 대상이 아니었다(사장님 지적).
const MAILBOXES = [
  { label: "plvekorea", kvKey: "kakao_gift_gmail_token" },
  { label: "shong", kvKey: "google_refresh_token" },
  { label: "harriotwatches", csAccount: "harriotwatches@gmail.com" },
];

async function tg(msg) {
  await require("./telegramRelay").relayText(msg);
}

// mb = { kvKey } (kv_store) 또는 { csAccount } (cs_accounts.credentials.refresh_token)
async function accessToken(mb) {
  let refresh;
  if (mb.csAccount) {
    const { data } = await sb().from("cs_accounts").select("credentials").eq("channel", "gmail").eq("display_name", mb.csAccount).maybeSingle();
    refresh = data && data.credentials && data.credentials.refresh_token;
    if (!refresh) throw new Error(`cs_accounts ${mb.csAccount} 토큰 없음`);
  } else {
    const { data } = await sb().from("kv_store").select("data").eq("key", mb.kvKey).maybeSingle();
    refresh = data && data.data;
    if (typeof refresh === "object" && refresh) refresh = refresh.refresh_token;
    if (!refresh) throw new Error(`${mb.kvKey} 토큰 없음`);
  }
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, refresh_token: String(refresh), grant_type: "refresh_token" }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`토큰 갱신 실패: ${JSON.stringify(j).slice(0, 120)}`);
  return j.access_token;
}
async function gJson(tok, p) { const r = await fetch(`${GMAIL}${p}`, { headers: { Authorization: `Bearer ${tok}` } }); if (!r.ok) throw new Error(`Gmail ${r.status}`); return r.json(); }
function walkAtts(part, acc) { if (!part) return; if (part.filename && part.body && part.body.attachmentId) acc.push({ filename: part.filename, mime: part.mimeType, attId: part.body.attachmentId }); (part.parts || []).forEach((p) => walkAtts(p, acc)); }
const b64u = (s) => Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64");

const num = (s) => Number(String(s == null ? "" : s).replace(/[^\d.-]/g, "")) || 0;

// lib/finance/hometaxParser.ts categorizeInvoice 의 JS 미러 (이메일 수집분 분류)
function catInvoice(partnerName, itemNames) {
  const text = `${partnerName || ""} ${(itemNames || []).join(" ")}`;
  if (/세무|회계법인|회계사무소|기장|세무사/i.test(text)) return "세금";
  if (/카페24|토스페이먼츠|KG이니시스|KCP|네이버파이낸셜|NICE/i.test(text)) return "수수료";
  if (/패키지|박스|포장|인쇄/i.test(text)) return "매입";
  if (/광고|마케팅|페이스북|구글|카카오|네이버광고|tiktok/i.test(text)) return "광고비";
  if (/택배|배송|운송|CJ대한통운|한진택배|로젠|쿠팡로지스/i.test(text)) return "택배비";
  if (/임대|월세|관리비/i.test(text)) return "임대료";
  if (/통신|전화|인터넷|SKT|KT|LGU/i.test(text)) return "통신비";
  if (/aws|cloud|github|vercel|notion|figma|saas|소프트웨어/i.test(text)) return "소프트웨어";
  if (/위탁|정산|반품|매출/i.test(text)) return "매출";
  return "매입";
}

// 복호화된 NTS 세금계산서 텍스트 → 구조화
function parseNts(text) {
  const t = text.replace(/ /g, " ").replace(/[ \t]+/g, " ");
  const approval = (t.match(/승인번호\s*([\d]{8}-[\d]{8}-[\dA-Za-z]{8})/) || t.match(/승인번호\s*([\d-]{15,})/) || [])[1] || "";
  const regs = [...t.matchAll(/(\d{3}-\d{2}-\d{5})/g)].map((m) => m[1]);
  const supplierReg = regs[0] || "", buyerReg = regs[1] || "";
  const names = [...t.matchAll(/상호\s*\(?법인명\)?\s*([^\n]+?)\s*성명\s*([^\n]+?)(?=\s*상호|\s*사업장|\n|$)/g)].map((m) => [m[1].trim(), m[2].trim()]);
  const supplierName = names[0] ? names[0][0] : "";
  const supplierRep = names[0] ? names[0][1] : "";
  const dm = t.match(/작성일자[\s\S]{0,40}?(\d{4})\/(\d{1,2})\/(\d{1,2})\s+([\d,]+)\s+([\d,]+)/);
  const writeDate = dm ? `${dm[1]}-${String(dm[2]).padStart(2, "0")}-${String(dm[3]).padStart(2, "0")}` : null;
  const supply = dm ? num(dm[4]) : 0;
  const tax = dm ? num(dm[5]) : 0;
  const total = num((t.match(/합계금액\s*([\d,]+)/) || [])[1]) || supply + tax;
  // 품목명들: "월 일 품목 ..." 헤더 뒤 데이터행의 3번째 토큰들
  const items = [];
  const itemBlock = (t.split(/월\s*일\s*품목[\s\S]*?비고/)[1] || "").split(/합계금액/)[0] || "";
  for (const line of itemBlock.split("\n")) {
    const m = line.match(/^\s*(\d{1,2})\s+(\d{1,2})\s+(.+?)\s+([\d,]*)\s+([\d,]*)\s*$/);
    if (m && m[3] && /\S/.test(m[3])) items.push({ name: m[3].trim(), supply: num(m[4]), tax: num(m[5]) });
  }
  return { approval, supplierReg, supplierName, supplierRep, buyerReg, writeDate, supply, tax, total, items };
}

// Playwright로 보안메일 복호화 → 본문 텍스트 (비번 자동 시도)
async function decrypt(ctx, html) {
  const tmp = path.join(os.tmpdir(), `nts_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.html`);
  fs.writeFileSync(tmp, html);
  const page = await ctx.newPage();
  try {
    await page.goto(`file://${tmp}`, { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(800);
    for (const pw of PASSWORDS) {
      const inp = await page.$("#idPcPwd");
      if (!inp) break;
      await inp.fill(pw).catch(() => {});
      const btns = await page.$$("button, input[type=button], input[type=submit]");
      for (const b of btns) { const tt = (await b.innerText().catch(() => "")) || (await b.getAttribute("value").catch(() => "")) || ""; if (/확인/.test(tt)) { await b.click().catch(() => {}); break; } }
      await page.waitForTimeout(1500);
      const txt = await page.evaluate(() => { for (const f of document.querySelectorAll("iframe")) { try { const t = f.contentDocument?.body?.innerText || ""; if (/승인번호|전자세금계산서/.test(t)) return t; } catch {} return ""; } return ""; });
      if (txt && /승인번호/.test(txt)) return txt;
      // 실패시 새로고침 후 다른 비번
      await page.reload({ waitUntil: "networkidle" }).catch(() => {});
      await page.waitForTimeout(600);
    }
    return "";
  } finally { await page.close().catch(() => {}); try { fs.unlinkSync(tmp); } catch {} }
}

async function findBusinessId(db, buyerReg) {
  const { data } = await db.from("finance_businesses").select("id,registration_number,is_default");
  const norm = (s) => String(s || "").replace(/\D/g, "");
  const match = (data || []).find((b) => norm(b.registration_number) === norm(buyerReg));
  if (match) return { id: match.id, matched: true };
  const def = (data || []).find((b) => b.is_default) || (data || [])[0];
  return { id: def ? def.id : null, matched: false };
}


// ── 발행대행사(바로빌·빌36524) 수집 ─────────────────────────────────
// 국세청 홈택스 직접발행 메일만 보던 구조라 대행사 발행분이 통째로 누락되던 문제(2026-08-24).
const AGENCIES = [
  { key: "barobill", from: "baro@barobill.co.kr", needsBrowser: true },
  { key: "wehago",   from: "webmaster@bill36524.com", needsBrowser: false },
];
// 상호 → 사업자번호 (대행사 메일에 등록번호가 없을 때 폴백)
const NAME_TO_REG = { "해리엇와치스": "2092770599", "제이에이치": "6632301279" };

/** Gmail payload에서 본문 텍스트 추출 (text/plain 우선, 없으면 html 태그 제거) */
function bodyText(payload) {
  let plain = "", html = "";
  (function walk(part) {
    if (!part) return;
    const d = part.body && part.body.data;
    if (d && part.mimeType === "text/plain") plain += b64u(d).toString("utf8");
    if (d && part.mimeType === "text/html") html += b64u(d).toString("utf8");
    (part.parts || []).forEach(walk);
  })(payload);
  if (plain.trim()) return plain;
  return html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ")
             .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}

/** 태그 제거 전 원본(plain+html). href 안에 든 조회링크를 뽑을 때 필요 — 바로빌 메일은 HTML 전용이다. */
function rawBody(payload) {
  let out = "";
  (function walk(part) {
    if (!part) return;
    const d = part.body && part.body.data;
    if (d && /^text\//.test(part.mimeType || "")) out += b64u(d).toString("utf8");
    (part.parts || []).forEach(walk);
  })(payload);
  return out;
}

/** 바로빌 조회 페이지를 사업자번호로 열어 본문 텍스트 반환 */
async function openBarobill(ctx, url) {
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 45000 }).catch(() => {});
    for (const pw of PASSWORDS) {
      const inp = await page.$("#CCorpNum");
      if (!inp) break;
      await inp.fill(pw).catch(() => {});
      await page.click("a:has-text('입력')").catch(async () => { await page.press("#CCorpNum", "Enter").catch(() => {}); });
      await page.waitForTimeout(3000);
      const txt = await page.evaluate(() => document.body.innerText).catch(() => "");
      if (/국세청승인번호/.test(txt)) return txt;
      await page.goto(url, { waitUntil: "networkidle", timeout: 45000 }).catch(() => {});
      await page.waitForTimeout(600);
    }
    return "";
  } finally { await page.close().catch(() => {}); }
}

/** 바로빌 조회 페이지 텍스트 → 구조화 (NTS와 레이아웃이 달라 별도 파서) */
function parseBarobill(text) {
  const t = text.replace(/\u00a0/g, " ");
  const approval = (t.match(/국세청승인번호\s*:?\s*([0-9a-zA-Z]{16,})/) || [])[1] || "";
  const regs = [...t.matchAll(/(\d{3}-\d{2}-\d{5})/g)].map((m) => m[1]);
  const supplierReg = regs[0] || "", buyerReg = regs[1] || "";
  // "상호\t(주)더블유컨셉코리아\t성\n명\t이지은" 형태 — 상호 뒤 첫 토큰
  const nameMatches = [...t.matchAll(/상호\s+([^\t\n]+?)\s*(?:성\s*\n?\s*명)\s+([^\t\n]+)/g)];
  const supplierName = nameMatches[0] ? nameMatches[0][1].trim() : "";
  const supplierRep = nameMatches[0] ? nameMatches[0][2].trim() : "";
  const dm = t.match(/작성일자\s+공급가액\s+세액\s*\n\s*(\d{4})-(\d{2})-(\d{2})\s+([\d,]+)\s+([\d,]+)/);
  const writeDate = dm ? `${dm[1]}-${dm[2]}-${dm[3]}` : null;
  const supply = dm ? num(dm[4]) : 0;
  const tax = dm ? num(dm[5]) : 0;
  const total = num((t.match(/합계금액[\s\S]{0,120}?\n\s*([\d,]{4,})/) || [])[1]) || supply + tax;
  const items = [];
  const block = (t.split(/월\s+일\s+품목[^\n]*\n/)[1] || "").split(/합계금액/)[0] || "";
  for (const line of block.split("\n")) {
    const m = line.match(/^\s*(\d{1,2})\s+(\d{1,2})\s+(\S[^\t]*?)\s+([\d,]+)\s+([\d,]+)\s*$/);
    if (m) items.push({ name: m[3].trim(), supply: num(m[4]), tax: num(m[5]) });
  }
  return { approval, supplierReg, supplierName, supplierRep, buyerReg, writeDate, supply, tax, total, items };
}

/** 빌36524(WEHAGO) 도착알림 메일 본문 → 구조화. 금액이 본문에 있어 브라우저 불필요. */
function parseWehago(text) {
  const t = text.replace(/\u00a0/g, " ").replace(/\|/g, " ").replace(/[ \t]+/g, " ");
  const pick = (re) => { const m = t.match(re); return m ? m[1].trim() : ""; };
  const mgmtNo = pick(/관리번호\s+(\S+)/);
  const writeDate = pick(/작성일자\s+(\d{4}-\d{2}-\d{2})/) || null;
  const supply = num(pick(/공급가액\s+([\d,]+)\s*원/));
  const tax = num(pick(/부가세액\s+([\d,]+)\s*원/));
  const itemName = pick(/품목\s+(.+?)\s+공급가액/) || pick(/품목\s+(.+)/);
  const supplierName = pick(/발신자 정보[\s\S]{0,80}?상호\s+(.+?)\s+담당자/);
  const buyerName = pick(/수신자 정보[\s\S]{0,80}?상호\s+(.+?)\s+담당자/);
  // 조회링크 base64 = "관리번호&공급받는자사업자번호"
  let buyerReg = "";
  const link = (text.match(/eTaxMail\/([A-Za-z0-9+/=]+)/) || [])[1];
  if (link) { try { buyerReg = (Buffer.from(link, "base64").toString("utf8").split("&")[1] || "").trim(); } catch {} }
  if (!buyerReg) buyerReg = NAME_TO_REG[buyerName] || "";
  return {
    approval: mgmtNo ? `WEHAGO-${mgmtNo}` : "", supplierReg: "", supplierName, supplierRep: "",
    buyerReg, writeDate, supply, tax, total: supply + tax,
    items: itemName ? [{ name: itemName, supply, tax }] : [],
  };
}

/** 승인번호가 서로 다른 경로로 들어와 같은 계산서가 두 번 쌓이는 것 방지 */
async function isDuplicate(db, businessId, inv) {
  if (!businessId || !inv.writeDate || !inv.total) return false;
  const { data } = await db.from("finance_tax_invoices")
    .select("id,approval_no,partner_name")
    .eq("business_id", businessId).eq("write_date", inv.writeDate).eq("total_amount", inv.total);
  if (!data || !data.length) return false;
  const key = (s) => String(s || "").replace(/[\s()（）주식회사㈜]/g, "");
  return data.some((r) => r.approval_no !== inv.approval && (!inv.supplierName || key(r.partner_name) === key(inv.supplierName)));
}

async function main() {
  const db = sb();
  const { data: seenRow } = await db.from("kv_store").select("data").eq("key", SEEN_KEY).maybeSingle();
  const seen = new Set((seenRow && seenRow.data && seenRow.data.ids) || []);
  const ctx = await chromium.launchPersistentContext(path.join(__dirname, ".tax-profile"), { channel: "chrome", headless: true, viewport: { width: 1240, height: 1754 } });

  let stored = 0, parsed = 0, warned = [];
  const summary = [];
  try {
    for (const mb of MAILBOXES) {
      let tok;
      try { tok = await accessToken(mb); } catch (e) { log(`${mb.label} 토큰 실패: ${e.message}`); continue; }
      const q = `from:hometax.go.kr 전자세금계산서 has:attachment newer_than:${DAYS}d`;
      const list = await gJson(tok, `/messages?q=${encodeURIComponent(q)}&maxResults=60`).catch(() => ({}));
      const msgs = list.messages || [];
      log(`${mb.label}: 국세청 세금계산서 ${msgs.length}건`);
      for (const m of msgs) {
        if (seen.has(m.id) && !DRY) continue;
        const full = await gJson(tok, `/messages/${m.id}?format=full`);
        const atts = []; walkAtts(full.payload, atts);
        const html = atts.find((a) => /NTS_eTaxInvoice|\.html$/i.test(a.filename));
        if (!html) { seen.add(m.id); continue; }
        const ad = await gJson(tok, `/messages/${m.id}/attachments/${html.attId}`);
        const text = await decrypt(ctx, b64u(ad.data).toString("utf8"));
        if (!text) { log(`  복호화 실패(비번 불일치?) msg ${m.id.slice(-6)}`); continue; }
        const inv = parseNts(text);
        if (!inv.approval) { log(`  파싱 실패 msg ${m.id.slice(-6)}`); continue; }
        const norm = (s) => String(s || "").replace(/\D/g, "");
        // 우리가 공급받는자여야 매입(비용). 공급자=우리면 매출이므로 비용 아님 → 스킵.
        if (!OUR_REGS.has(norm(inv.buyerReg))) {
          log(`  매출/무관 스킵: ${inv.supplierName} → ${inv.buyerReg} (₩${inv.total.toLocaleString()})`);
          seen.add(m.id);
          continue;
        }
        parsed++;
        const biz = await findBusinessId(db, inv.buyerReg);
        if (!biz.matched) warned.push(inv.buyerReg);
        summary.push(`${inv.writeDate} ${inv.supplierName} ₩${inv.total.toLocaleString()} (${inv.items.map(i => i.name).join(",").slice(0, 30)})`);
        if (DRY) { log(`  [dry] ${JSON.stringify(inv)}`); seen.add(m.id); continue; }
        if (!biz.id) { log("  기본 사업자 없음 — 적재 스킵"); continue; }
        const { data: up, error } = await db.from("finance_tax_invoices").upsert({
          business_id: biz.id, invoice_type: "purchase", approval_no: inv.approval,
          write_date: inv.writeDate, partner_reg_no: inv.supplierReg, partner_name: inv.supplierName, partner_rep: inv.supplierRep,
          supply_amount: inv.supply, tax_amount: inv.tax, total_amount: inv.total,
          category: catInvoice(inv.supplierName, (inv.items || []).map((i) => i.name)), category_source: "email",
          raw: { source: "email_nts", mailbox: mb.label, buyerReg: inv.buyerReg, items: inv.items, businessMatched: biz.matched },
        }, { onConflict: "business_id,approval_no", ignoreDuplicates: true }).select("id");
        if (error) { log(`  적재 오류: ${error.message}`); continue; }
        if (up && up.length) {
          stored++;
          for (let k = 0; k < inv.items.length; k++) {
            const it = inv.items[k];
            try { await db.from("finance_tax_invoice_items").insert({ invoice_id: up[0].id, item_seq: k + 1, item_name: it.name, supply_amount: it.supply, tax_amount: it.tax }); } catch {}
          }
        }
        seen.add(m.id);
      }
    }

    // ── 2차: 발행대행사(바로빌·빌36524) 발행분 ──────────────────────
    for (const mb of MAILBOXES) {
      let tok;
      try { tok = await accessToken(mb); } catch (e) { log(`${mb.label} 토큰 실패(대행사): ${e.message}`); continue; }
      for (const ag of AGENCIES) {
        const q = `from:${ag.from} newer_than:${DAYS}d`;
        const list = await gJson(tok, `/messages?q=${encodeURIComponent(q)}&maxResults=60`).catch(() => ({}));
        const msgs = list.messages || [];
        log(`${mb.label}/${ag.key}: ${msgs.length}건`);
        for (const m of msgs) {
          if (seen.has(m.id) && !DRY) continue;
          const full = await gJson(tok, `/messages/${m.id}?format=full`);
          const body = bodyText(full.payload);
          let inv;
          if (ag.key === "barobill") {
            const url = (rawBody(full.payload).match(/https:\/\/www\.barobill\.co\.kr\/_email\/\?MD=[A-Za-z0-9%_-]+/) || [])[0];
            if (!url) { log(`  ${ag.key}: 조회링크 없음 msg ${m.id.slice(-6)}`); seen.add(m.id); continue; }
            const txt = await openBarobill(ctx, url);
            if (!txt) { log(`  ${ag.key}: 조회 실패(사업자번호 불일치/링크만료) msg ${m.id.slice(-6)}`); continue; }
            inv = parseBarobill(txt);
          } else {
            inv = parseWehago(body);
          }
          if (!inv.approval || !inv.writeDate || !inv.total) { log(`  ${ag.key}: 파싱 실패 msg ${m.id.slice(-6)}`); continue; }
          const norm = (x) => String(x || "").replace(/\D/g, "");
          if (!OUR_REGS.has(norm(inv.buyerReg))) {
            log(`  ${ag.key} 매출/무관 스킵: ${inv.supplierName} → ${inv.buyerReg} (₩${inv.total.toLocaleString()})`);
            seen.add(m.id); continue;
          }
          parsed++;
          const biz = await findBusinessId(db, inv.buyerReg);
          if (!biz.matched) warned.push(inv.buyerReg);
          if (await isDuplicate(db, biz.id, inv)) {
            log(`  ${ag.key} 중복 스킵(다른 경로로 이미 적재): ${inv.supplierName} ${inv.writeDate} ₩${inv.total.toLocaleString()}`);
            seen.add(m.id); continue;
          }
          summary.push(`${inv.writeDate} ${inv.supplierName} ₩${inv.total.toLocaleString()} (${inv.items.map((i) => i.name).join(",").slice(0, 30)}) [${ag.key}]`);
          if (DRY) { log(`  [dry/${ag.key}] ${JSON.stringify(inv)}`); seen.add(m.id); continue; }
          if (!biz.id) { log("  기본 사업자 없음 — 적재 스킵"); continue; }
          const { data: up, error } = await db.from("finance_tax_invoices").upsert({
            business_id: biz.id, invoice_type: "purchase", approval_no: inv.approval,
            write_date: inv.writeDate, partner_reg_no: inv.supplierReg || null, partner_name: inv.supplierName, partner_rep: inv.supplierRep || null,
            supply_amount: inv.supply, tax_amount: inv.tax, total_amount: inv.total,
            category: catInvoice(inv.supplierName, (inv.items || []).map((i) => i.name)), category_source: "email",
            raw: { source: `email_${ag.key}`, mailbox: mb.label, buyerReg: inv.buyerReg, items: inv.items, businessMatched: biz.matched },
          }, { onConflict: "business_id,approval_no", ignoreDuplicates: true }).select("id");
          if (error) { log(`  ${ag.key} 적재 오류: ${error.message}`); continue; }
          if (up && up.length) {
            stored++;
            for (let k = 0; k < inv.items.length; k++) {
              const it = inv.items[k];
              try { await db.from("finance_tax_invoice_items").insert({ invoice_id: up[0].id, item_seq: k + 1, item_name: it.name, supply_amount: it.supply, tax_amount: it.tax }); } catch {}
            }
          }
          seen.add(m.id);
        }
      }
    }
  } finally { await ctx.close().catch(() => {}); }

  if (!DRY) await db.from("kv_store").upsert({ key: SEEN_KEY, data: { ids: [...seen].slice(-2000) }, updated_at: new Date().toISOString() }, { onConflict: "key" });
  log(`완료: 파싱 ${parsed} / 신규적재 ${stored}${DRY ? " (dry-run, 적재안함)" : ""}`);
  if (summary.length) log("내역:\n" + summary.join("\n"));
  const uniqWarn = [...new Set(warned)];
  if (!DRY && stored) await tg(`🧾 전자세금계산서 수집: 신규 ${stored}건\n${summary.slice(0, 8).join("\n")}${uniqWarn.length ? `\n⚠️ 미등록 사업자(${uniqWarn.join(",")}) 발견 — 기본 사업자에 적재됨` : ""}`);
}

main().catch((e) => { console.error("ERR", e.message); process.exit(1); });
