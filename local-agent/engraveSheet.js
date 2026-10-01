/**
 * 각인 작업표 PDF (폴바이스 + 해리엇 국문몰) — EzCad2 에 문구를 **복사해서 붙여넣는** 용도.
 *
 * 왜 필요한가: 각인은 새기면 되돌릴 수 없다. 주문이 몰리는 날 송장의 "(각인:…)" 을 눈으로 보고
 * 다시 타이핑하면 오타·줄바꿈·서체 실수가 난다(사장님 2026-09-30: "실수가 없게끔 각인작업용 pdf").
 * 평일 09:00 · 12:40 · 15:20 자동 생성(launchd com.paulvice.engrave-sheet) → 공유드라이브 `다운로드/각인작업/각인_YYYY-MM-DD.pdf`
 * (하루 한 파일을 덮어쓴다. 직전 회차 이후 새로 들어온 건은 NEW 표시).
 *
 * 작업표 규칙(사장님이 쓰면서 정한 것 — 바꾸기 전에 이유를 볼 것):
 *   ① 문구는 **한 줄에 한 칸**. 여러 줄을 한 번에 드래그하면 줄바꿈된 문구만 복사된다.
 *      줄 번호("1줄")는 텍스트가 아니라 **도형**으로 그린다 — 텍스트로 찍었더니 같이 복사돼 번거로웠다.
 *   ② **고객 화면 기준 줄바꿈.** 2026-09-30 전 미리보기는 고객이 친 Enter 만 ⏎ 로 넘겨,
 *      화면에서 자동으로 넘어간 줄이 주문서에 없었다(박상진: 주문서 1줄 / 화면 3줄).
 *      그래서 라이브 미리보기에 같은 문구·서체·높이를 넣고 보이는 줄을 다시 읽는다 → 다르면 "줄바꿈 정정".
 *   ③ **고객이 신청한 그대로 새긴다.** 영문 서체(TNR·Arial)+한글 같은 조합을 경고하지 않는다 —
 *      미리보기에 그렇게 보였으면 그게 약속이다. 공백 2칸도 고치지 않는다.
 *   ④ 빨간 경고는 문구가 불완전하거나(높이 없음·옛 형식·배송메시지에서 뽑음) 보내면 안 되는 건(보류)만.
 *
 * 문구 출처 우선순위는 buildPostOffice(송장)와 같다:
 *   kv manual_engravings("<브랜드>:<주문>" → "<주문>") > 주문서 각인칸 > 배송메시지.
 *
 * 실행: node local-agent/engraveSheet.js                 오늘 파일 생성·갱신
 *       node local-agent/engraveSheet.js --open          생성 후 열기
 *       node local-agent/engraveSheet.js --orders a,b    상태 무관 그 주문만(배송중으로 넘긴 뒤 재출력) → 별도 파일
 *       node local-agent/engraveSheet.js --auto          launchd 용(휴무일 스킵·하트비트·새 건 텔레그램)
 *       --no-screen                                      화면 줄바꿈 재현 생략
 * 주문·카페24 는 읽기만 한다. 쓰는 곳은 kv `engrave_sheet_seen`(NEW 판정용)뿐.
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
const { createClient } = require(path.join(DASH, "node_modules/@supabase/supabase-js"));

const ARGV = process.argv.slice(2);
const AUTO = ARGV.includes("--auto");
// --orders a,b,c : 상태와 무관하게 그 주문만(이미 배송중으로 넘긴 뒤 다시 뽑을 때)
const ONLY = (() => { const i = ARGV.indexOf("--orders"); return i >= 0 ? new Set(String(ARGV[i + 1] || "").split(",").map((x) => x.trim()).filter(Boolean)) : null; })();
const kst = (d = new Date()) => d.toLocaleString("sv-SE", { timeZone: "Asia/Seoul" });
const DRIVE = "/Users/mac/Library/CloudStorage/GoogleDrive-shong@harriotwatches.com/공유 드라이브/다운로드/각인작업";
const OUT_DIR = fs.existsSync(path.dirname(DRIVE)) ? DRIVE : require("os").tmpdir();
const SEEN_KEY = "engrave_sheet_seen";

/**
 * 몰별 설정. preview = 각인 미리보기가 붙은 상품(화면 줄바꿈을 재현할 수 있는 상품).
 * 미리보기 없는 상품(폴바이스 오드리·미니엘, 해리엇 설월 외)은 고객이 친 그대로가 곧 화면이다.
 */
const MALLS = [
  {
    seller: "카페24", brand: "폴바이스", defMm: "2.3",
    preview: { url: "https://icaruse2000.cafe24.com/product/detail.html?product_no=195", pre: "pvEng", products: new Set(["195", "196", "263", "264", "265"]) },
  },
  {
    seller: "해리엇", brand: "해리엇", defMm: "2.5",
    preview: { url: "https://harriotkorea.cafe24.com/product/detail.html?product_no=136", pre: "hrtEng", products: new Set(["136"]) },
  },
];

const F = {
  kr: ["/System/Library/Fonts/AppleSDGothicNeo.ttc", "AppleSDGothicNeo-Regular"],
  krB: ["/System/Library/Fonts/AppleSDGothicNeo.ttc", "AppleSDGothicNeo-Bold"],
  uni: ["/Library/Fonts/Arial Unicode.ttf"],
  "Times New Roman": ["/System/Library/Fonts/Supplemental/Times New Roman.ttf"],
  Arial: ["/System/Library/Fonts/Supplemental/Arial.ttf"],
  나눔고딕: [fs.existsSync("/Library/Fonts/NanumGothic-Regular.ttf") ? "/Library/Fonts/NanumGothic-Regular.ttf" : path.join(require("os").homedir(), "Library/Fonts/NanumGothic-Regular.ttf")],
  // 이 맥에 없는 서체는 화면 표시만 비슷한 것으로 대신한다(각인기는 자기 서체로 찍는다)
  나눔명조: ["/System/Library/Fonts/Supplemental/AppleMyungjo.ttf"],
  "나눔손글씨 펜": [path.join(require("os").homedir(), "Library/Fonts/NanumPen.otf")],
};
const FONT_ALIAS = { "nanum gothic": "나눔고딕", "nanum myeongjo": "나눔명조", "times": "Times New Roman", "nanum pen script": "나눔손글씨 펜" };
const KNOWN_FONTS = "나눔고딕|나눔명조|나눔손글씨 펜|Arial|Times New Roman|Century Gothic|Sign Painter|한글 필기체";

/** "문구 ⏎ 문구  [서체 · 높이 2.5mm]" → { lines, font, mm, legacy } */
function parseEngraving(raw) {
  let s = String(raw || "").trim();
  let font = "", mm = "", legacy = false;
  let m = s.match(/^(.*?)\s*\[([^\]]*)\]\s*$/s);
  if (m) {
    s = m[1];
    font = m[2].split("·").map((x) => x.trim())[0] || "";
    const h = m[2].match(/([\d.]+)\s*mm/);
    if (h) mm = h[1];
  } else if ((m = s.match(new RegExp(`^(.*?)\\s*\\((${KNOWN_FONTS})[^)]*\\)\\s*$`, "is")))) {
    s = m[1]; font = m[2];
  }
  font = FONT_ALIAS[font.toLowerCase()] || font;
  const lines = s.split(/\s*⏎\s*/).map((x) => x.trim()).filter(Boolean);
  if (lines.length === 1 && /\s\/\s/.test(lines[0])) legacy = true; // "… / …" 는 옛 형식의 줄바꿈일 수 있다
  return { lines, font, mm, legacy };
}

/**
 * 고객이 서체·높이를 고르지 않은 해리엇 주문의 기본값(사장님 지정) — 묻지 않고 이 값으로 새긴다.
 *   설월 = Times New Roman (2026-09-18)
 *   가양 = 서체 옵션을 제공하지 않는 모델이라 Times New Roman · 높이 2.1mm (2026-10-01)
 * 여기 없는 모델은 서체 미정이면 각인 전에 묻는다(warningsFor). 밴드 상품명의 "(…설월 호환)" 에 걸리지 않게 앞머리만 본다.
 */
const HARRIOT_DEFAULTS = [
  { match: /^설월/, font: "Times New Roman" },
  { match: /^가양/, font: "Times New Roman", mm: "2.1" },
];
function applyDefaults(job) {
  if (job.brand !== "해리엇") return;
  const d = HARRIOT_DEFAULTS.find((x) => x.match.test(job.prod));
  if (!d) return;
  if (!job.font) { job.font = d.font; job.fontDefault = true; }
  if (!job.mm && d.mm) { job.mm = d.mm; job.mmDefault = true; }
}

function warningsFor(job) {
  const w = [];
  // 서체·높이는 미리보기 상품만 주문서에 실려 온다. 해리엇은 서체 미정이면 각인 전에 묻는 게 규칙(shipping.md §3).
  if (!job.font && (job.hasPreview || job.brand === "해리엇")) w.push("서체 미지정 — 확인 후 진행");
  if (!job.mm && job.hasPreview) w.push(`글자 높이 미지정 — 기본 ${job.defMm}mm`);
  if (job.lines.some((l) => /\S {2,}\S/.test(l))) w.push("공백 2칸 연속 — 고객 입력 그대로 새길 것(한 칸으로 줄이지 말 것)");
  if (job.legacy) w.push("옛 형식 — ' / ' 가 줄바꿈인지 문구인지 불분명");
  if (job.qty >= 2) w.push(`수량 ${job.qty} — 각인칸은 하나. 두 점 다 새기는지 고객 확인`);
  if (job.held) w.push(`발송 보류 중(${job.held}) — 각인하지 말 것`);
  if (job.source === "배송메시지") w.push("주문서 칸이 비어 배송메시지에서 뽑은 문구 — 원문을 보고 확정");
  if (/^확인요/.test(job.raw)) w.push("배송메시지에 각인 언급이 있는데 문구를 못 뽑았다 — 고객 확인 전 각인 금지");
  if (job.ambiguousManual) w.push("수기 각인이 몰 구분 없는 키로 등록됨 — 두 몰에 같은 주문번호가 있다. 어느 몰 건인지 확인");
  return w;
}

async function fetchOrders(mall) {
  const m = CAFE24_MALLS.find((x) => x.seller === mall.seller);
  const token = await cafe24Token(m);
  const base = `https://${m.mallId()}.cafe24api.com`;
  const ymd = (d) => d.toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  const start = ymd(new Date(Date.now() - 45 * 86400000)), end = ymd(new Date());
  const all = [];
  for (let off = 0; ; off += 100) {
    const qs = new URLSearchParams({ shop_no: "1", start_date: start, end_date: end, limit: "100", offset: String(off), embed: "items,receivers" });
    const res = await fetch(`${base}/api/v2/admin/orders?${qs}`, { headers: { Authorization: `Bearer ${token}` } });
    const d = await res.json();
    if (!res.ok) throw new Error(`${mall.brand} 카페24 주문 조회 실패 ${res.status} ${JSON.stringify(d).slice(0, 200)}`);
    all.push(...(d.orders || []));
    if ((d.orders || []).length < 100) break;
  }
  return all;
}

async function buildJobs() {
  const [manual, holds] = await Promise.all([manualEngravings(), listHolds().catch(() => [])]);
  const orderSets = {}, byMall = {};
  for (const mall of MALLS) {
    byMall[mall.seller] = await fetchOrders(mall);
    orderSets[mall.seller] = new Set(byMall[mall.seller].map((o) => o.order_id));
  }
  const sections = [];
  for (const mall of MALLS) {
    const held = new Map(holds.filter((h) => h.seller === mall.seller).map((h) => [h.order, h.reason || "사유 없음"]));
    const others = MALLS.filter((x) => x !== mall).map((x) => orderSets[x.seller]);
    const jobs = [], plain = [];
    for (const o of byMall[mall.seller]) {
      if (ONLY && !ONLY.has(o.order_id)) continue;
      const r = (o.receivers || [])[0] || {};
      const ship = (o.items || []).filter((it) => ONLY || String(it.status_text || "") === "배송준비중");
      for (const it of ship) {
        const prod = String(it.product_name || "").trim() + (it.option_value ? ` ${it.option_value}` : "");
        const base = {
          brand: mall.brand, seller: mall.seller, defMm: mall.defMm,
          key: `${mall.seller}|${o.order_id}|${it.order_item_code}`,
          order: o.order_id, productNo: String(it.product_no || ""),
          time: String(o.order_date || "").slice(5, 16).replace("T", " "),
          receiver: r.name || "", buyer: o.billing_name || "", prod, qty: Number(it.quantity) || 1,
          msg: String(r.shipping_message || "").trim(), held: held.get(o.order_id) || "",
        };
        base.hasPreview = mall.preview.products.has(base.productNo);
        const optionText = engravingOf(it);
        const canEngrave = engravable(it.product_name);
        const branded = manual[`${mall.brand}:${o.order_id}`];
        const plainKey = manual[o.order_id];
        const manualText = canEngrave ? (branded || plainKey || "") : "";
        const msgText = canEngrave && !optionText ? engravingFromMessage(r.shipping_message) : "";
        const raw = manualText || optionText || msgText;
        if (!raw) { plain.push(base); continue; }
        const source = manualText ? "수기 정정(웹챗·메일)" : optionText ? "주문서 각인칸" : "배송메시지";
        const parsed = parseEngraving(manualText || optionText ? raw : msgText.replace(/\s*※배송메시지:.*$/, ""));
        const job = {
          ...base, raw, source, optionText: manualText ? optionText : "", ...parsed,
          ambiguousManual: !branded && !!plainKey && manualText && others.some((s) => s.has(o.order_id)),
        };
        applyDefaults(job);
        job.warnings = warningsFor(job);
        jobs.push(job);
      }
    }
    const byOrder = (a, b) => a.order.localeCompare(b.order);
    sections.push({ mall, jobs: jobs.sort(byOrder), plain: plain.sort(byOrder) });
  }
  return sections;
}

/**
 * 고객 화면의 줄바꿈 재현 — 라이브 미리보기에 같은 문구·서체·높이를 넣고 보이는 줄을 읽는다.
 * 실패하면 주문서 값 그대로 두고 경고만 단다(각인을 막지는 않는다).
 */
async function screenLines(sections) {
  if (ARGV.includes("--no-screen")) return;
  const todo = sections.filter((s) => s.jobs.some((j) => j.hasPreview));
  if (!todo.length) return;
  let br;
  try {
    const { chromium } = require("./node_modules/playwright");
    br = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
    for (const sec of todo) {
      const { url, pre } = sec.mall.preview;
      const pg = await br.newPage({ viewport: { width: 390, height: 844 } });
      try {
        await pg.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
        await pg.waitForSelector(`#${pre}Btn`, { timeout: 20000 });
        await pg.$eval(`#${pre}Btn`, (e) => e.click());
        for (const j of sec.jobs) {
          if (!j.hasPreview) continue;
          const got = await pg.evaluate(async ({ pre, text, font, mm }) => {
            const ta = document.getElementById(pre + "Txt");
            ta.value = text; ta.dispatchEvent(new Event("input"));
            const btn = [...document.querySelectorAll(`#${pre}Fonts button`)].find((b) => b.firstChild && b.firstChild.textContent.trim() === font);
            if (btn) btn.click();
            const sz = document.getElementById(pre + "Size"); sz.value = mm; sz.dispatchEvent(new Event("input"));
            await document.fonts.ready; await new Promise((r) => setTimeout(r, 150));
            ta.dispatchEvent(new Event("input"));
            const out = document.getElementById(pre + "Out"), node = out.firstChild;
            if (!node) return null;
            const lh = parseFloat(getComputedStyle(out).fontSize) || 1, r = document.createRange();
            const lines = []; let cur = "", last = null;
            for (let i = 0; i < node.data.length; i++) {
              const ch = node.data[i];
              if (ch === "\n") { lines.push(cur); cur = ""; last = null; continue; }
              r.setStart(node, i); r.setEnd(node, i + 1);
              const rc = r.getClientRects(), top = rc.length ? rc[rc.length - 1].top : null;
              if (top !== null && last !== null && top - last > lh * 0.5) { lines.push(cur); cur = ""; }
              if (top !== null) last = top;
              cur += ch;
            }
            lines.push(cur);
            return { lines: lines.map((x) => x.trim()).filter(Boolean), found: !!btn };
          }, { pre, text: j.lines.join("\n"), font: j.font, mm: j.mm || j.defMm });
          if (!got) continue;
          if (!got.found) { j.warnings.push(`미리보기에 '${j.font || "?"}' 서체 버튼이 없어 화면 줄바꿈을 확인 못 함 — 사이트에서 직접 확인`); continue; }
          if (got.lines.join("\u0000") !== j.lines.join("\u0000")) {
            j.orderLines = j.lines;
            j.lines = got.lines;
            if (!j.lines.some((l) => /\S {2,}\S/.test(l))) j.warnings = j.warnings.filter((w) => !w.startsWith("공백 2칸"));
            j.warnings.unshift(`줄바꿈 정정 — 주문서엔 ${j.orderLines.length}줄로 왔지만 고객 화면엔 ${got.lines.length}줄로 보였다. 위 칸(화면 기준)대로 새길 것`);
          }
        }
      } catch (e) {
        console.log(`${sec.mall.brand} 화면 줄바꿈 확인 실패: ${e.message}`);
        for (const j of sec.jobs) if (j.hasPreview) j.warnings.push("화면 줄바꿈 확인 실패 — 사이트 미리보기에서 직접 확인 후 새길 것");
      } finally { await pg.close().catch(() => {}); }
    }
  } catch (e) {
    console.log(`화면 줄바꿈 확인 실패: ${e.message}`);
    for (const s of todo) for (const j of s.jobs) if (j.hasPreview) j.warnings.push("화면 줄바꿈 확인 실패 — 사이트 미리보기에서 직접 확인 후 새길 것");
  } finally { if (br) await br.close().catch(() => {}); }
}

/** NEW 판정 — 직전 회차 작업표에 없던 건. kv 에 처음 본 시각을 남긴다(10일 지나면 정리). */
async function markSeen(sections) {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  let seen = {};
  try { const { data } = await sb.from("kv_store").select("data").eq("key", SEEN_KEY).maybeSingle(); seen = (data && data.data) || {}; } catch {}
  const now = new Date().toISOString(), cutoff = Date.now() - 10 * 86400000;
  for (const s of sections) for (const j of s.jobs) {
    if (!seen[j.key]) { seen[j.key] = now; j.isNew = true; }
    j.firstSeen = kst(new Date(seen[j.key])).slice(11, 16);
  }
  if (ONLY) return; // 재출력은 NEW 판정을 건드리지 않는다
  for (const k of Object.keys(seen)) if (Date.parse(seen[k]) < cutoff) delete seen[k];
  try { await sb.from("kv_store").upsert({ key: SEEN_KEY, data: seen, updated_at: now }, { onConflict: "key" }); } catch (e) { console.log(`NEW 기록 실패(무시): ${e.message}`); }
}

// ── PDF ──
const fkCache = {};
function fkFont(key) {
  const [file, post] = F[key] || [];
  if (!file || !fs.existsSync(file)) return null;
  if (!fkCache[key]) { const f = fontkit.openSync(file); fkCache[key] = f.fonts ? (f.fonts.find((x) => x.postscriptName === post) || f.fonts[0]) : f; }
  return fkCache[key];
}
function hasGlyphs(key, text) {
  const f = fkFont(key);
  return !!f && [...text].every((ch) => ch === " " || f.hasGlyphForCodePoint(ch.codePointAt(0)));
}
/**
 * 복사되지 않는 글자 — 글리프를 **도형(path)** 으로 그린다. 텍스트가 아니라서 드래그 복사에 안 딸려온다.
 * 줄 번호("1줄")를 텍스트로 찍었더니 여러 줄을 한 번에 긁으면 "2줄 3줄" 까지 복사돼
 * EzCad 에 붙이기 번거로웠다(사장님 2026-09-30). 눈에는 보이고 복사에는 안 잡히게.
 */
function drawAsShape(doc, str, x, y, size, color) {
  const font = fkFont("kr"), run = font.layout(str), sc = size / font.unitsPerEm;
  let cx = x;
  doc.save();
  run.glyphs.forEach((g, i) => {
    const d = g.path.scale(sc, -sc).translate(cx, y + size * 0.85).toSVG();
    if (d) doc.path(d).fill(color);
    cx += run.positions[i].xAdvance * sc;
  });
  doc.restore();
}

function render(sections, file) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 36, info: { Title: "각인 작업표" } });
    const out = fs.createWriteStream(file);
    doc.pipe(out);
    for (const [k, v] of Object.entries(F)) if (v[0] && fs.existsSync(v[0])) doc.registerFont(k, ...v);
    const W = 523, L = 36;
    const ensure = (h) => { if (doc.y + h > 800) doc.addPage(); };

    const now = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "long", timeStyle: "short" });
    const all = sections.flatMap((s) => s.jobs);
    doc.font("krB").fontSize(17).text("각인 작업표 — 폴바이스 · 해리엇 국문몰");
    doc.font("kr").fontSize(9.5).fillColor("#555")
      .text(`${now} · 각인 ${all.length}건(새로 ${all.filter((j) => j.isNew).length}) · 확인 필요 ${all.filter((j) => j.warnings.length).length}건 · `
        + sections.map((s) => `${s.mall.brand} 각인 ${s.jobs.length} / 각인 없음 ${s.plain.length}`).join(" · "))
      .text("회색 칸을 한꺼번에 드래그해 복사하면 줄바꿈된 문구만 복사됩니다(줄 번호는 복사 안 됨). 빨간 경고가 있는 건은 해소한 뒤에 새길 것.");
    doc.fillColor("#000").moveDown(0.6);

    let no = 0;
    for (const sec of sections) {
      ensure(60);
      doc.rect(L, doc.y, W, 22).fill("#111");
      doc.fillColor("#fff").font("krB").fontSize(12).text(`${sec.mall.brand}  —  각인 ${sec.jobs.length}건`, L + 8, doc.y + 5);
      doc.fillColor("#000").moveDown(0.9);
      if (!sec.jobs.length) doc.font("kr").fontSize(10).fillColor("#555").text("각인 건 없음", L).fillColor("#000").moveDown(0.5);

      for (const j of sec.jobs) {
        no++;
        const est = 70 + j.lines.length * 30 + j.warnings.length * 26 + (j.optionText ? 14 : 0) + (j.orderLines ? 14 : 0);
        ensure(est);
        const top = doc.y;
        doc.rect(L, top, W, 1.2).fill(j.warnings.length ? "#c00" : "#000");
        doc.fillColor("#000").y = top + 6;
        if (j.isNew) { doc.roundedRect(L + W - 44, top + 5, 44, 15, 3).fill("#0a58ca"); doc.fillColor("#fff").font("krB").fontSize(9).text("NEW", L + W - 44, top + 8, { width: 44, align: "center" }); doc.fillColor("#000"); doc.y = top + 6; }
        doc.font("krB").fontSize(12).text(`□  #${no}   ${j.order}   ·   ${j.receiver}${j.buyer && j.buyer !== j.receiver ? ` (주문 ${j.buyer})` : ""}`, L, top + 6, { width: W - 50 });
        doc.font("kr").fontSize(9.5).fillColor("#555").text(`${j.prod} ×${j.qty}  ·  주문 ${j.time}  ·  작업표 첫 등장 ${j.firstSeen || "-"}  ·  출처: ${j.source}`, L);
        doc.moveDown(0.25);
        doc.fillColor("#000").font("krB").fontSize(13)
          .text(`서체  ${j.font ? j.font + (j.fontDefault ? " (기본)" : "") : (j.hasPreview || j.brand === "해리엇" ? "미지정" : "주문서에 없음")}      높이  ${j.mm ? j.mm + " mm" + (j.mmDefault ? " (기본)" : "") : (j.hasPreview ? "미지정" : "-")}      ${j.lines.length}줄`, L);
        doc.moveDown(0.2);

        j.lines.forEach((ln, n) => {
          const face = j.font && hasGlyphs(j.font, ln) ? j.font : hasGlyphs("kr", ln) ? "kr" : "uni";
          const y = doc.y;
          doc.rect(L + 34, y, W - 34, 26).fill("#eeeeee");
          drawAsShape(doc, `${n + 1}줄`, L + 4, y + 8, 9, "#888");
          doc.fillColor("#000").font(face).fontSize(16).text(ln, L + 42, y + 4, { width: W - 50, lineBreak: false });
          doc.y = y + 30;
        });

        if (j.orderLines) doc.font("kr").fontSize(9).fillColor("#555").text(`주문서에 온 값(이대로 새기지 않음): ${j.orderLines.join(" / ")}`, L);
        if (j.optionText) doc.font("kr").fontSize(9).fillColor("#555").text(`주문서 원문(새기지 않음): ${j.optionText.replace(/\s*⏎\s*/g, " / ")}`, L);
        if (j.source === "배송메시지" || j.warnings.some((w) => w.includes("배송메시지"))) doc.font("kr").fontSize(9).fillColor("#555").text(`배송메시지 원문: ${j.msg}`, L);
        for (const w of j.warnings) doc.font("krB").fontSize(10).fillColor("#c00").text(`※ ${w}`, L);
        doc.fillColor("#000").moveDown(0.8);
      }
    }

    for (const sec of sections) {
      if (!sec.plain.length) continue;
      ensure(40 + Math.min(sec.plain.length, 10) * 14);
      doc.rect(L, doc.y, W, 1.2).fill("#000");
      doc.fillColor("#000").moveDown(0.4);
      doc.font("krB").fontSize(11).text(`${sec.mall.brand} 각인 없음 — ${sec.plain.length}건 (주문서 칸 비어 있음, 배송메시지에도 각인 언급 없음)`, L);
      doc.font("kr").fontSize(9);
      for (const p of sec.plain) { ensure(14); doc.text(`□  ${p.order}  ${p.receiver}  ·  ${p.prod} ×${p.qty}${p.held ? `  보류(${p.held})` : ""}${p.msg ? `  ·  메시지: ${p.msg.slice(0, 40)}` : ""}`, L); }
      doc.moveDown(0.6);
    }

    doc.end();
    out.on("finish", resolve);
    out.on("error", reject);
  });
}

async function main() {
  if (AUTO) require("./parcelHolidays").checkOrExit("engraveSheet(각인 작업표)");
  const sections = await buildJobs();
  await screenLines(sections);
  await markSeen(sections);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const day = kst().slice(0, 10);
  const file = path.join(OUT_DIR, ONLY ? `각인_${day}_재출력_${kst().slice(11, 16).replace(":", "")}.pdf` : `각인_${day}.pdf`);
  await render(sections, file);

  const all = sections.flatMap((s) => s.jobs), fresh = all.filter((j) => j.isNew);
  console.log(`[${kst()}] 각인 ${all.length}건(새로 ${fresh.length}) · 확인 필요 ${all.filter((j) => j.warnings.length).length}건`);
  for (const j of all) console.log(`  ${j.isNew ? "NEW " : "    "}${j.brand} ${j.order} [${j.font || "?"}${j.fontDefault ? "(기본)" : ""} ${j.mm || "?"}mm${j.mmDefault ? "(기본)" : ""}] ${j.lines.join(" / ")}${j.warnings.length ? "  ⚠ " + j.warnings.join(" | ") : ""}`);
  console.log(file);
  if (ARGV.includes("--open")) execFileSync("open", [file]);

  if (AUTO) {
    await require("./heartbeat").beat("engrave-sheet", { jobs: all.length, fresh: fresh.length });
    if (fresh.length) {
      const warn = fresh.filter((j) => j.warnings.length).length;
      const msg = `✍️ 각인 작업표 갱신 — 새 각인 ${fresh.length}건`
        + ` (${sections.map((s) => `${s.mall.brand} ${s.jobs.filter((j) => j.isNew).length}`).join(" · ")})`
        + (warn ? `\n🔴 확인 필요 ${warn}건` : "")
        + `\n공유드라이브 다운로드/각인작업/${path.basename(file)}`;
      try { await require("./telegramRelay").relayText(msg); } catch (e) { console.log(`텔레그램 실패(무시): ${e.message}`); }
    }
  }
}

if (require.main === module) main().catch(async (e) => {
  console.error("ERR", e);
  if (AUTO) { try { await require("./notifyFail").notifyFail("각인 작업표", e.message); } catch {} }
  process.exit(1);
});
module.exports = { parseEngraving, buildJobs };
