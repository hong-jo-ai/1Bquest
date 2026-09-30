/**
 * 해리엇 국문몰 각인 작업표 PDF — EzCad2 에 문구를 **복사해서 붙여넣는** 용도.
 *
 * 왜 필요한가: 각인은 새기면 되돌릴 수 없다. 주문이 몰리는 날 송장의 "(각인:…)" 을 눈으로 보고
 * 다시 타이핑하면 오타·줄바꿈·서체 실수가 난다(사장님 2026-09-30: "실수가 없게끔 각인작업용 pdf").
 * 그래서 문구를 **줄 단위로 한 칸씩** 찍어 그대로 복사할 수 있게 하고, 서체·글자높이를 크게 보여준다.
 *
 * 문구 출처 우선순위는 buildPostOffice(송장)와 같다:
 *   kv manual_engravings("해리엇:<주문>" → "<주문>") > 주문서 각인칸 > 배송메시지.
 *   수기 정정분은 주문서 원문도 같이 찍는다 — 어느 쪽을 새기는지 작업자가 알아야 하므로.
 *
 * 작업 전에 걸러주는 것(빨간 경고):
 *   ⛔ 서체·문구를 "고쳐야 할 것"으로 경고하지 않는다 — **고객이 신청한 그대로 새기는 게 원칙**이다.
 *      영문 서체(TNR·Arial)에 한글을 섞어도 각인 미리보기에 한글로 나왔으면 실제로도 그렇게 새긴다
 *      (사장님 2026-09-30). 여기서 거르는 건 문구가 불완전하거나(높이 없음·옛 형식·배송메시지) 보내면 안 되는 건뿐.
 *   - 공백 2칸 연속 · 서체/높이 미지정 · 옛 형식(⏎ 없는 줄바꿈) · 수량 ≥ 2 · 발송 보류
 *   - 배송메시지에 "각인" 이 있는데 주문서 칸이 비어 있음
 *
 * 실행: node local-agent/harriotEngraveSheet.js          PDF 생성(공유드라이브 다운로드/각인작업/)
 *       node local-agent/harriotEngraveSheet.js --open   생성 후 열기
 * 읽기 전용 — 주문·kv 를 바꾸지 않는다.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const DASH = path.resolve(__dirname, "..");
const PDFDocument = require(path.join(DASH, "node_modules/pdfkit"));
const fontkit = require(path.join(DASH, "node_modules/fontkit"));
const {
  CAFE24_MALLS, cafe24Token, engravingOf, engravable, engravingFromMessage, manualEngravings,
} = require("./buildPostOffice");
const { listHolds } = require("./postParcel/holdOrders");

const ARGV = process.argv.slice(2);
const KST = () => new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).replace(" ", "_").replace(/:/g, "").slice(0, 15);
const DRIVE = "/Users/mac/Library/CloudStorage/GoogleDrive-shong@harriotwatches.com/공유 드라이브/다운로드/각인작업";
const OUT_DIR = fs.existsSync(path.dirname(DRIVE)) ? DRIVE : require("os").tmpdir();

const F = {
  kr: ["/System/Library/Fonts/AppleSDGothicNeo.ttc", "AppleSDGothicNeo-Regular"],
  krB: ["/System/Library/Fonts/AppleSDGothicNeo.ttc", "AppleSDGothicNeo-Bold"],
  uni: ["/Library/Fonts/Arial Unicode.ttf"],
  "Times New Roman": ["/System/Library/Fonts/Supplemental/Times New Roman.ttf"],
  Arial: ["/System/Library/Fonts/Supplemental/Arial.ttf"],
  나눔고딕: [fs.existsSync("/Library/Fonts/NanumGothic-Regular.ttf") ? "/Library/Fonts/NanumGothic-Regular.ttf" : path.join(require("os").homedir(), "Library/Fonts/NanumGothic-Regular.ttf")],
  // 나눔명조는 이 맥에 없다 → 화면 표시만 AppleMyungjo 로 대신(각인기는 자기 나눔명조로 찍는다)
  나눔명조: ["/System/Library/Fonts/Supplemental/AppleMyungjo.ttf"],
};
const FONT_ALIAS = { "nanum gothic": "나눔고딕", "nanum myeongjo": "나눔명조", "times": "Times New Roman" };


/** "문구 ⏎ 문구  [서체 · 높이 2.5mm]" → { lines, font, mm, legacy } */
function parseEngraving(raw) {
  let s = String(raw || "").trim();
  let font = "", mm = "", legacy = false;
  let m = s.match(/^(.*?)\s*\[([^\]]*)\]\s*$/s);
  if (m) {
    s = m[1];
    const parts = m[2].split("·").map((x) => x.trim());
    font = parts[0] || "";
    const h = m[2].match(/([\d.]+)\s*mm/);
    if (h) mm = h[1];
  } else if ((m = s.match(/^(.*?)\s*\((나눔고딕|나눔명조|Arial|Times New Roman)[^)]*\)\s*$/is))) {
    s = m[1]; font = m[2];
  }
  font = FONT_ALIAS[font.toLowerCase()] || font;
  const lines = s.split(/\s*⏎\s*/).map((x) => x.trim()).filter(Boolean);
  if (lines.length === 1 && /\s\/\s/.test(lines[0])) legacy = true; // "… / …" 는 옛 형식의 줄바꿈일 수 있다
  return { lines, font, mm, legacy };
}

function warningsFor(job) {
  const w = [];
  if (!job.font) w.push("서체 미지정 — 설월 기본은 국문 나눔명조 / 영문 Times New Roman. 확인 후 진행");
  if (!job.mm) w.push("글자 높이 미지정 — 기본 2.5mm(짧은 문구 2.7 · 긴 문구 2.3~2.5)");
  if (job.lines.some((l) => /\S {2,}\S/.test(l))) w.push("공백 2칸 연속 — 고객 입력 그대로 새길 것(한 칸으로 줄이지 말 것)");
  if (job.legacy) w.push("옛 형식 — ' / ' 가 줄바꿈인지 문구인지 불분명");
  if (job.qty >= 2) w.push(`수량 ${job.qty} — 각인칸은 하나. 두 점 다 새기는지 고객 확인`);
  if (job.held) w.push(`🛑 발송 보류 중(${job.held}) — 각인하지 말 것`);
  if (job.source === "배송메시지") w.push("주문서 칸이 비어 배송메시지에서 뽑은 문구 — 원문을 보고 확정");
  if (/^확인요/.test(job.raw)) w.push("배송메시지에 각인 언급이 있는데 문구를 못 뽑았다 — 고객 확인 전 각인 금지");
  return w;
}

async function fetchOrders() {
  const m = CAFE24_MALLS.find((x) => x.seller === "해리엇");
  const token = await cafe24Token(m);
  const base = `https://${m.mallId()}.cafe24api.com`;
  const ymd = (d) => d.toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  const start = ymd(new Date(Date.now() - 45 * 86400000)), end = ymd(new Date());
  const all = [];
  for (let off = 0; ; off += 100) {
    const qs = new URLSearchParams({ shop_no: "1", start_date: start, end_date: end, limit: "100", offset: String(off), embed: "items,receivers" });
    const res = await fetch(`${base}/api/v2/admin/orders?${qs}`, { headers: { Authorization: `Bearer ${token}` } });
    const d = await res.json();
    if (!res.ok) throw new Error(`카페24 주문 조회 실패 ${res.status} ${JSON.stringify(d).slice(0, 200)}`);
    all.push(...(d.orders || []));
    if ((d.orders || []).length < 100) break;
  }
  return all;
}

async function buildJobs() {
  const [orders, manual, holds] = await Promise.all([fetchOrders(), manualEngravings(), listHolds().catch(() => [])]);
  const held = new Map(holds.filter((h) => h.seller === "해리엇").map((h) => [h.order, h.reason || "사유 없음"]));
  const jobs = [], plain = [];
  for (const o of orders) {
    const r = (o.receivers || [])[0] || {};
    const ship = (o.items || []).filter((it) => String(it.status_text || "") === "배송준비중");
    for (const it of ship) {
      const prod = String(it.product_name || "").trim() + (it.option_value ? ` ${it.option_value}` : "");
      const base = {
        order: o.order_id, time: String(o.order_date || "").slice(5, 16).replace("T", " "),
        receiver: r.name || "", buyer: o.billing_name || "", prod, qty: Number(it.quantity) || 1,
        msg: String(r.shipping_message || "").trim(), held: held.get(o.order_id) || "",
      };
      const optionText = engravingOf(it);
      const canEngrave = engravable(it.product_name);
      const manualText = canEngrave ? (manual[`해리엇:${o.order_id}`] || manual[o.order_id] || "") : "";
      const msgText = canEngrave && !optionText ? engravingFromMessage(r.shipping_message) : "";
      const raw = manualText || optionText || msgText;
      if (!raw) { plain.push(base); continue; }
      const source = manualText ? "수기 정정(웹챗·메일)" : optionText ? "주문서 각인칸" : "배송메시지";
      const job = { ...base, raw, source, optionText: manualText ? optionText : "", ...parseEngraving(msgText && !manualText && !optionText ? msgText.replace(/\s*※배송메시지:.*$/, "") : raw) };
      job.warnings = warningsFor(job);
      jobs.push(job);
    }
  }
  const byOrder = (a, b) => a.order.localeCompare(b.order);
  return { jobs: jobs.sort(byOrder), plain: plain.sort(byOrder) };
}

// ── PDF ──
const fkCache = {};
function hasGlyphs(fontKey, text) {
  const [file, post] = F[fontKey] || [];
  if (!file || !fs.existsSync(file)) return false;
  const k = fontKey;
  if (!fkCache[k]) { const f = fontkit.openSync(file); fkCache[k] = f.fonts ? (f.fonts.find((x) => x.postscriptName === post) || f.fonts[0]) : f; }
  return [...text].every((ch) => ch === " " || fkCache[k].hasGlyphForCodePoint(ch.codePointAt(0)));
}

function render({ jobs, plain }, file) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 36, info: { Title: "해리엇 각인 작업표" } });
    const out = fs.createWriteStream(file);
    doc.pipe(out);
    for (const [k, v] of Object.entries(F)) if (v[0] && fs.existsSync(v[0])) doc.registerFont(k, ...v);
    const W = 523, L = 36;
    const ensure = (h) => { if (doc.y + h > 800) doc.addPage(); };

    const now = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "long", timeStyle: "short" });
    const nWarn = jobs.filter((j) => j.warnings.length).length;
    doc.font("krB").fontSize(17).text("해리엇 국문몰 각인 작업표");
    doc.font("kr").fontSize(9.5).fillColor("#555")
      .text(`${now} · 배송준비중 ${jobs.length + plain.length}건 = 각인 ${jobs.length} + 각인 없음 ${plain.length} · 확인 필요 ${nWarn}건`)
      .text("회색 칸의 문구를 한 줄씩 복사해 EzCad2 에 붙여넣으세요. 서체·높이는 칸 위 굵은 글씨. 빨간 경고가 있는 건은 해소한 뒤에 새길 것.");
    doc.fillColor("#000").moveDown(0.6);

    jobs.forEach((j, i) => {
      const est = 70 + j.lines.length * 30 + j.warnings.length * 14 + (j.optionText ? 14 : 0);
      ensure(est);
      const top = doc.y;
      doc.rect(L, top, W, 1.2).fill(j.warnings.length ? "#c00" : "#000");
      doc.fillColor("#000").y = top + 6;
      doc.font("krB").fontSize(12).text(`□  #${i + 1}   ${j.order}   ·   ${j.receiver}${j.buyer && j.buyer !== j.receiver ? ` (주문 ${j.buyer})` : ""}`, L, doc.y);
      doc.font("kr").fontSize(9.5).fillColor("#555").text(`${j.prod} ×${j.qty}  ·  주문 ${j.time}  ·  출처: ${j.source}`);
      doc.moveDown(0.25);
      doc.fillColor("#000").font("krB").fontSize(13)
        .text(`서체  ${j.font || "미지정"}      높이  ${j.mm ? j.mm + " mm" : "미지정"}      ${j.lines.length}줄`);
      doc.moveDown(0.2);

      j.lines.forEach((ln, n) => {
        const face = hasGlyphs(j.font, ln) ? j.font : hasGlyphs("kr", ln) ? "kr" : "uni";
        const y = doc.y;
        doc.rect(L + 34, y, W - 34, 26).fill("#eeeeee");
        doc.fillColor("#888").font("kr").fontSize(9).text(`${n + 1}줄`, L + 4, y + 8, { width: 28 });
        doc.fillColor("#000").font(face).fontSize(16).text(ln, L + 42, y + 4, { width: W - 50, lineBreak: false });
        doc.y = y + 30;
      });

      if (j.optionText) doc.font("kr").fontSize(9).fillColor("#555").text(`주문서 원문(새기지 않음): ${j.optionText.replace(/\s*⏎\s*/g, " / ")}`, L);
      if (j.source === "배송메시지" || j.warnings.some((w) => w.includes("배송메시지"))) doc.font("kr").fontSize(9).fillColor("#555").text(`배송메시지 원문: ${j.msg}`, L);
      for (const w of j.warnings) doc.font("krB").fontSize(10).fillColor("#c00").text(`※ ${w}`, L);
      doc.fillColor("#000").moveDown(0.8);
    });

    ensure(60 + plain.length * 14);
    doc.rect(L, doc.y, W, 1.2).fill("#000");
    doc.fillColor("#000").moveDown(0.4);
    doc.font("krB").fontSize(12).text(`각인 없음 — ${plain.length}건 (주문서 칸 비어 있음, 배송메시지에도 각인 언급 없음)`, L);
    doc.font("kr").fontSize(9.5);
    for (const p of plain) doc.text(`□  ${p.order}  ${p.receiver}  ·  ${p.prod} ×${p.qty}${p.held ? `  🛑보류(${p.held})` : ""}${p.msg ? `  ·  메시지: ${p.msg.slice(0, 40)}` : ""}`, L);

    doc.end();
    out.on("finish", resolve);
    out.on("error", reject);
  });
}

async function main() {
  const data = await buildJobs();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `해리엇각인_${KST()}.pdf`);
  await render(data, file);
  console.log(`각인 ${data.jobs.length}건 · 각인 없음 ${data.plain.length}건 · 확인 필요 ${data.jobs.filter((j) => j.warnings.length).length}건`);
  for (const j of data.jobs) console.log(`  ${j.order} [${j.font || "?"} ${j.mm || "?"}mm] ${j.lines.join(" / ")}${j.warnings.length ? "  ⚠ " + j.warnings.join(" | ") : ""}`);
  console.log(file);
  if (ARGV.includes("--open")) execFileSync("open", [file]);
}

if (require.main === module) main().catch((e) => { console.error("ERR", e); process.exit(1); });
module.exports = { parseEngraving, buildJobs };
