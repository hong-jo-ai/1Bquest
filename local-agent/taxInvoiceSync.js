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
const MAILBOXES = [
  { label: "plvekorea", kvKey: "kakao_gift_gmail_token" },
  { label: "shong", kvKey: "google_refresh_token" },
];

async function tg(msg) {
  const t = process.env.TELEGRAM_BOT_TOKEN, c = process.env.TELEGRAM_CHAT_ID;
  if (!t || !c) return;
  await fetch(`https://api.telegram.org/bot${t}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: c, text: msg }) }).catch(() => {});
}

async function accessToken(kvKey) {
  const { data } = await sb().from("kv_store").select("data").eq("key", kvKey).maybeSingle();
  const refresh = data && data.data;
  if (!refresh) throw new Error(`${kvKey} 토큰 없음`);
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
      try { tok = await accessToken(mb.kvKey); } catch (e) { log(`${mb.label} 토큰 실패: ${e.message}`); continue; }
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
  } finally { await ctx.close().catch(() => {}); }

  if (!DRY) await db.from("kv_store").upsert({ key: SEEN_KEY, data: { ids: [...seen].slice(-2000) }, updated_at: new Date().toISOString() }, { onConflict: "key" });
  log(`완료: 파싱 ${parsed} / 신규적재 ${stored}${DRY ? " (dry-run, 적재안함)" : ""}`);
  if (summary.length) log("내역:\n" + summary.join("\n"));
  const uniqWarn = [...new Set(warned)];
  if (!DRY && stored) await tg(`🧾 전자세금계산서 수집: 신규 ${stored}건\n${summary.slice(0, 8).join("\n")}${uniqWarn.length ? `\n⚠️ 미등록 사업자(${uniqWarn.join(",")}) 발견 — 기본 사업자에 적재됨` : ""}`);
}

main().catch((e) => { console.error("ERR", e.message); process.exit(1); });
