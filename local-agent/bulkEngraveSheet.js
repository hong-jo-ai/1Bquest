/**
 * 단체(대량) 주문용 각인 작업표 PDF — 고객이 보낸 각인 명단 엑셀을 EzCad2 에 **복사해 붙여넣는** 용도.
 *
 * 왜 따로 있나: 일일 작업표(engraveSheet.js)는 카페24 주문서의 각인칸을 읽는다. 단체주문은 카페24 를 안 타고
 *   명단이 엑셀로 온다(번호 · 이름 · 영문이름 · 각인). 수십 개를 같은 틀로 새기므로 한 장에 다 보이는 표가 낫다.
 *
 * 작업표 규칙(일일 작업표와 같다 — 바꾸기 전에 이유를 볼 것):
 *   ① **복사되는 글자는 각인 문구뿐.** 번호·이름·머리글·안내문은 전부 도형으로 그린다 → 줄을 통째로 긁어도 문구만 잡힌다.
 *   ② 문구는 **줄마다 한 칸**. 줄바꿈이 있는 문구는 1줄·2줄 칸을 따로 둔다.
 *   ③ **받은 명단 그대로.** 띄어쓰기·마침표·대소문자를 고치지 않는다("S . J . LEE" 의 공백도 그대로).
 *   ④ 번호는 패키지 구분 라벨(NN / 총수)과 같다 — 새긴 시계를 그 번호 패키지에 넣는다.
 *   ⑤ 문구가 서로 같은 건은 빨갛게 알린다(사람이 다른데 문구가 같으면 패키지가 바뀌기 쉽다).
 *
 * 실행: node bulkEngraveSheet.js <명단.xlsx> --title "(주)대찬테크 설월 40개" [--out <파일.pdf>] [--ref <시안 이미지.png>] [--note "뒷면 상단 DCT 로고 + 아래 문구"] [--open]
 *   명단 엑셀: 머리글 아래로 번호 · 이름 · 영문이름 · 각인(셀 안 줄바꿈 = 각인 줄바꿈). 번호가 숫자가 아닌 줄은 건너뛴다.
 *   --out 을 안 주면 공유드라이브 `다운로드/각인작업/각인_단체_<제목>.pdf`.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const DASH = path.resolve(__dirname, "..");
const PDFDocument = require(path.join(DASH, "node_modules/pdfkit"));
const fontkit = require(path.join(DASH, "node_modules/fontkit"));
const XLSX = require(path.join(DASH, "node_modules/xlsx"));

const ARGV = process.argv.slice(2);
const opt = (name) => { const i = ARGV.indexOf("--" + name); return i >= 0 ? ARGV[i + 1] : ""; };
const SRC = ARGV.find((a) => /\.xlsx?$/i.test(a));
const TITLE = opt("title") || (SRC ? path.basename(SRC).replace(/\.xlsx?$/i, "") : "");
const NOTE = opt("note");
const REF = opt("ref");
const OUT_DIR = "/Users/mac/Library/CloudStorage/GoogleDrive-shong@harriotwatches.com/공유 드라이브/다운로드/각인작업";
const OUT = opt("out") || path.join(OUT_DIR, `각인_단체_${TITLE.replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, "_")}.pdf`);
const nfc = (v) => (v === null || v === undefined ? "" : String(v).normalize("NFC"));

const F = {
  kr: ["/System/Library/Fonts/AppleSDGothicNeo.ttc", "AppleSDGothicNeo-Regular"],
  krB: ["/System/Library/Fonts/AppleSDGothicNeo.ttc", "AppleSDGothicNeo-Bold"],
  uni: ["/Library/Fonts/Arial Unicode.ttf"],
};
const fk = {};
function fkFont(key) {
  if (!fk[key]) { const [file, post] = F[key]; const f = fontkit.openSync(file); fk[key] = f.fonts ? (f.fonts.find((x) => x.postscriptName === post) || f.fonts[0]) : f; }
  return fk[key];
}
const widthOf = (str, size, key = "kr") => { const f = fkFont(key); return (f.layout(str).advanceWidth * size) / f.unitsPerEm; };
/** 복사되지 않는 글자 — 글리프를 도형으로 그린다(engraveSheet.drawAsShape 와 같은 원리). align: left|right|center */
function shape(doc, str, x, y, size, color = "#000", key = "kr", align = "left", boxW = 0) {
  const font = fkFont(key), run = font.layout(String(str)), sc = size / font.unitsPerEm;
  const w = (run.advanceWidth * size) / font.unitsPerEm;
  let cx = align === "right" ? x + boxW - w : align === "center" ? x + (boxW - w) / 2 : x;
  doc.save();
  run.glyphs.forEach((g, i) => { const d = g.path.scale(sc, -sc).translate(cx, y + size * 0.85).toSVG(); if (d) doc.path(d).fill(color); cx += run.positions[i].xAdvance * sc; });
  doc.restore();
}

function readRoster(file) {
  const wb = XLSX.readFile(file);
  const A = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: "" });
  const rows = [];
  for (const r of A) {
    const cells = r.map(nfc);
    const no = Number(cells[0]);
    if (!cells[0] || !Number.isFinite(no) || no <= 0) continue; // 머리글·빈 줄
    // 셀 안 줄바꿈이 각인 줄바꿈이다. 줄 앞뒤 공백만 떼고 안쪽은 건드리지 않는다.
    const lines = cells[3].split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    rows.push({ no, name: cells[1].trim(), eng: cells[2].trim(), lines });
  }
  return rows.sort((a, b) => a.no - b.no);
}

function render(rows) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    const doc = new PDFDocument({ size: "A4", margin: 0, info: { Title: `각인 작업표(단체) ${TITLE}` } });
    const ws = fs.createWriteStream(OUT);
    doc.pipe(ws); ws.on("finish", resolve); ws.on("error", reject);
    for (const [k, v] of Object.entries(F)) doc.registerFont(k, ...v);

    const L = 34, R = 595 - 34, W = R - L, TOP = 34, BOTTOM = 842 - 34;
    const total = rows.length;
    const maxLines = Math.max(...rows.map((r) => r.lines.length), 1);
    // 같은 문구가 여러 번 나오는 건(전체 문구 기준) — 이름 없는 공통 문구는 정상이라 "한 줄짜리 묶음"으로 따로 다룬다
    const keyOf = (r) => r.lines.join("\n");
    const count = {}; for (const r of rows) count[keyOf(r)] = (count[keyOf(r)] || 0) + 1;
    const lastLineCount = {}; for (const r of rows) if (r.lines.length > 1) { const k = r.lines[r.lines.length - 1]; (lastLineCount[k] = lastLineCount[k] || []).push(r.no); }
    const named = rows.filter((r) => r.lines.length > 1);
    const plain = rows.filter((r) => r.lines.length <= 1);
    const plainGroups = {}; for (const r of plain) (plainGroups[keyOf(r)] = plainGroups[keyOf(r)] || []).push(r);

    let y = TOP;
    const header = () => {
      shape(doc, "각인 작업표 — 단체주문", L, y, 17, "#000", "krB");
      shape(doc, `${total}개`, L, y, 17, "#000", "krB", "right", W);
      y += 24;
      shape(doc, TITLE, L, y, 12, "#000", "krB"); y += 18;
      const made = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 16);
      shape(doc, `명단: ${path.basename(SRC).normalize("NFC")}  ·  생성 ${made}`, L, y, 8.5, "#555"); y += 13;
      if (NOTE) { shape(doc, NOTE, L, y, 9.5, "#000", "krB"); y += 15; }
      shape(doc, "문구는 받은 명단 그대로(띄어쓰기·마침표 포함) · 칸 안의 글자만 복사된다 · 번호 = 패키지 라벨 번호", L, y, 8.5, "#555"); y += 12;
      doc.rect(L, y, W, 1.2).fill("#000"); y += 10;
    };
    const newPage = () => { doc.addPage({ size: "A4", margin: 0 }); y = TOP; shape(doc, `각인 작업표 — 단체주문 · ${TITLE} (이어서)`, L, y, 10, "#555", "krB"); y += 18; doc.rect(L, y, W, 0.8).fill("#000"); y += 8; };
    header();

    // 시안(있으면) + 요약
    const sumLines = [`이름 있는 건 ${named.length}개  ·  한 줄 공통 문구 ${plain.length}개  ·  합계 ${total}개`];
    for (const [k, list] of Object.entries(plainGroups)) sumLines.push(`「${k.replace(/\n/g, " / ")}」 × ${list.length}개 (No. ${list.map((r) => r.no).join("·")})`);
    if (REF && fs.existsSync(REF)) {
      try { doc.image(REF, R - 250, y, { fit: [250, 130] }); } catch { /* 이미지가 안 열리면 생략 */ }
      sumLines.forEach((s, i) => shape(doc, s, L, y + i * 14, 9.5, "#000", i === 0 ? "krB" : "kr"));
      y += 138;
    } else { sumLines.forEach((s, i) => shape(doc, s, L, y + i * 14, 9.5, "#000", i === 0 ? "krB" : "kr")); y += sumLines.length * 14 + 6; }

    // ── 표: 이름 있는 건 ─────────────────────────────
    const cNo = L, wNo = 44, cName = L + wNo + 22, wName = 84;
    const cLine = cName + wName + 6;
    const wCell = (R - cLine - 6 * (maxLines - 1)) / maxLines;
    const ROW = 27;
    const tableHead = () => {
      shape(doc, "No.", cNo + 16, y, 8.5, "#555", "krB");
      shape(doc, "받는 사람", cName, y, 8.5, "#555", "krB");
      for (let i = 0; i < maxLines; i++) shape(doc, `${i + 1}줄`, cLine + i * (wCell + 6), y, 8.5, "#555", "krB");
      y += 13;
    };
    if (named.length) {
      shape(doc, `① 이름 있는 건 — ${named.length}개`, L, y, 11, "#000", "krB"); y += 17;
      tableHead();
      for (const r of named) {
        if (y + ROW > BOTTOM) { newPage(); tableHead(); }
        const dupNos = (lastLineCount[r.lines[r.lines.length - 1]] || []).filter((n) => n !== r.no);
        // 체크칸 + 번호 + 이름(전부 도형)
        doc.lineWidth(0.8).rect(cNo, y + 5, 11, 11).stroke("#000");
        shape(doc, String(r.no).padStart(2, "0"), cNo + 16, y + 3, 14, "#000", "krB");
        shape(doc, r.name, cName, y + 2, 10.5, "#000", "krB");
        if (r.eng && r.eng !== r.lines[r.lines.length - 1]) shape(doc, r.eng, cName, y + 14.5, 7.5, "#777");
        // 각인 문구 — 줄마다 한 칸, 진짜 텍스트(복사 대상)
        r.lines.forEach((ln, i) => {
          const x = cLine + i * (wCell + 6);
          doc.lineWidth(0.6).roundedRect(x, y + 1, wCell, ROW - 5, 3).stroke(i === r.lines.length - 1 ? "#000" : "#aaa");
          const face = [...ln].every((ch) => ch === " " || fkFont("kr").hasGlyphForCodePoint(ch.codePointAt(0))) ? "krB" : "uni";
          doc.fillColor("#000").font(face).fontSize(12.5).text(ln, x + 7, y + 5.5, { width: wCell - 12, lineBreak: false });
        });
        if (dupNos.length) shape(doc, `※ No.${dupNos.map((n) => String(n).padStart(2, "0")).join("·")} 과 ${r.lines.length}줄 같음`, cName, y + ROW - 5.5, 6.8, "#c00", "krB");
        y += ROW + (dupNos.length ? 4 : 0);
      }
      y += 8;
    }

    // ── 한 줄 공통 문구: 문구는 한 번만, 번호는 체크칸으로 ─────────────
    for (const [k, list] of Object.entries(plainGroups)) {
      const need = 22 + 30 + Math.ceil(list.length / 10) * 26 + 6;
      if (y + need > BOTTOM) newPage();
      shape(doc, `② 같은 문구 — ${list.length}개 (전부 아래 문구 하나로 새긴다)`, L, y, 11, "#000", "krB"); y += 17;
      const ls = k.split("\n");
      ls.forEach((ln, i) => {
        const x = L + i * (wCell + 6);
        doc.lineWidth(0.6).roundedRect(x, y + 1, wCell, ROW - 5, 3).stroke("#000");
        doc.fillColor("#000").font("krB").fontSize(12.5).text(ln, x + 7, y + 5.5, { width: wCell - 12, lineBreak: false });
      });
      y += ROW + 4;
      list.forEach((r, i) => {
        const col = i % 10, row = Math.floor(i / 10);
        const x = L + col * (W / 10), yy = y + row * 26;
        doc.lineWidth(0.8).rect(x, yy + 3, 11, 11).stroke("#000");
        shape(doc, String(r.no).padStart(2, "0"), x + 16, yy + 1, 13, "#000", "krB");
      });
      y += Math.ceil(list.length / 10) * 26 + 8;
    }

    // 바닥: 수량 검산
    if (y + 20 > BOTTOM) newPage();
    doc.rect(L, y, W, 0.8).fill("#000"); y += 8;
    shape(doc, `검산: 이름 있는 건 ${named.length} + 같은 문구 ${plain.length} = ${total}개  ·  새긴 뒤 체크칸에 표시하고 같은 번호 패키지에 넣는다`, L, y, 8.5, "#555");
    doc.end();
  });
}

if (require.main !== module) { module.exports = { readRoster }; return; }
(async () => {
  if (!SRC || !fs.existsSync(SRC)) { console.log('사용: node bulkEngraveSheet.js <명단.xlsx> --title "제목" [--out 파일.pdf] [--ref 시안.png] [--note "안내"] [--open]'); process.exit(1); }
  const rows = readRoster(SRC);
  if (!rows.length) { console.log("명단에서 각인 줄을 못 읽었다(번호 칸이 숫자인 줄이 없음)"); process.exit(1); }
  await render(rows);
  const named = rows.filter((r) => r.lines.length > 1).length;
  console.log(`각인 ${rows.length}건(이름 있음 ${named} · 한 줄 공통 ${rows.length - named}) → ${OUT}`);
  const empty = rows.filter((r) => !r.lines.length).map((r) => r.no);
  if (empty.length) console.log(`⚠ 문구가 비어 있는 번호: ${empty.join(", ")}`);
  if (ARGV.includes("--open")) { try { execFileSync("open", [OUT]); } catch { /* 무시 */ } }
})().catch((e) => { console.error("실패:", e.message); process.exit(1); });
