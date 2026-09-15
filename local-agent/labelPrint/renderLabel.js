/**
 * 우체국 전용라벨 **C형(2026.01)** 자체 출력 렌더러 (pdfkit).
 *
 * 스티커 = 111 × 171 mm 세로 급지. 인쇄 내용은 **90° 돌아간 가로 배치**다
 * (스티커에 빨간 격자·우체국소포 로고가 가로로 미리 인쇄돼 있다). 2026-09-15 실물 대조로 확정.
 *
 * 격자(가로 좌표계 171 × 111 mm, 실측):
 *   세로 분할선 x=66.7 · 가로 분할선 y=19.7 / 40.1 / 64.3 / 83.1
 *   좌측칸: 주문일·접수국 / 주문인·고객주문처·요금 / 신청일·우편번호바코드 / 상품명 … 하단 [각인]
 *   우측칸: 집배코드 / 보내는분 / 받는분·등기번호 / 등기바코드·코스번호
 *
 * ⚠️ 스티커에 **미리 인쇄된 것은 찍지 않는다**: 빨간 테두리·격자, 우체국소포 로고, "2026.01.ⓒ형",
 *    세로 라벨 "보/낸/분"·"받/는/분", "신청 및 배달안내 ☎1588-1300", "개인정보 유출방지…".
 * ⚠️ PS100 은 **가장자리 2~3mm 를 못 찍는다** → SAFE_L / SAFE_R 안쪽으로만 배치.
 *
 * 폰트: AppleSDGothicNeo **Bold**(본문) / **Heavy**(집배코드·수취인·등기번호).
 *   감열 인쇄라 가는 폰트는 흐리게 나온다 — 굵게, 대신 크기는 작게(사장님 2026-09-15).
 */
const PDFDocument = require("/Users/mac/sungjo_ai/paulwise-dashboard/node_modules/pdfkit");
const QR = require("qrcode");
const { code128Modules } = require("./code128");

const TTC = process.env.LABEL_FONT_TTC || "/System/Library/Fonts/AppleSDGothicNeo.ttc";
const FAM_BOLD = process.env.LABEL_FONT_BOLD || "AppleSDGothicNeo-Bold";
const FAM_HEAVY = process.env.LABEL_FONT_HEAVY || "AppleSDGothicNeo-Heavy";
const FONT_FALLBACK = "/System/Library/Fonts/Supplemental/AppleGothic.ttf";

const W_MM = Number(process.env.LABEL_WIDTH_MM || 111);   // 급지 방향(세로) 폭
const H_MM = Number(process.env.LABEL_HEIGHT_MM || 171);  // 급지 방향 길이
const SAFE_L = Number(process.env.LABEL_SAFE_LEFT_MM || 2.2);
// 🔴 오른쪽 끝 x≈154~171mm 은 **떼어내는 절취칸**(우체국 출력본은 거기 세로 바코드만 있고 내용은 안 찍는다).
//    게다가 실제 출력이 의도보다 ~3% 크게 나가 오른쪽으로 밀린다(2026-09-15 실측: 의도 166.5 → 실제 169.5).
//    → 안전선을 146 으로 크게 당긴다(실제 약 150mm, 절취칸 앞).
const SAFE_R = Number(process.env.LABEL_SAFE_RIGHT_MM || 146.0);
const mm = (v) => (v * 72) / 25.4;

// 공급지(보내는분) — 우체국에 등록된 값. 다른 채널 건도 이 값이 찍힌다(공급지 기준).
const SENDER = {
  name: process.env.LABEL_SENDER_NAME || "해리엇와치스",
  addr: process.env.LABEL_SENDER_ADDR || "서울특별시 서초구 동산로 19 (양재동, 서울서초우체국) 해리엇와치스 앞",
  zip: process.env.LABEL_SENDER_ZIP || "06779",
  mobile: process.env.LABEL_SENDER_MOBILE || "010) 2669-5082",
};

function xmlTag(xml, tag) {
  const m = new RegExp(`<${tag}>\\s*(?:<!\\[CDATA\\[)?([^<\\]]*)`).exec(xml || "");
  return m ? m[1].trim() : "";
}

/** 등기번호 13자리 → 68901-7377-6586 (5-4-4, 실물 기준) */
function fmtRegi(n) {
  const d = String(n || "").replace(/\D/g, "");
  return d.length === 13 ? `${d.slice(0, 5)}-${d.slice(5, 9)}-${d.slice(9)}` : d;
}

/** 집배코드 `부46270404` → { head:"부4", mid:"627", a:"04", b:"04" } */
function splitAreaCd(cd) {
  const s = String(cd || "");
  return { head: s.slice(0, 2), mid: s.slice(2, 5), a: s.slice(5, 7), b: s.slice(7, 9) };
}

function engravingOf(s, raw) {
  const msg = String(raw?.delivMsg || s.deliv_msg || "").trim();
  if (msg) return msg;
  const m = /\(각인\s*:\s*([^)]*)\)/.exec(String(s.product_name || ""));
  return m && m[1].trim() ? `[각인] ${m[1].trim()}` : "";
}

function ymd(d) {
  const t = new Date(d || Date.now());
  const p = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(t);
  const g = (k) => p.find((x) => x.type === k).value.replace(".", "");
  return `${g("year")}/${g("month")}/${g("day")}`;
}

function renderLabel(s) {
  const raw = typeof s.raw === "string" ? (() => { try { return JSON.parse(s.raw); } catch { return {}; } })() : (s.raw || {});
  const xml = raw.resp || "";
  const area = splitAreaCd(xmlTag(xml, "delivAreaCd"));
  const arrCnpo = xmlTag(xml, "arrCnpoNm");
  const delivPo = xmlTag(xml, "delivPoNm");
  const course = xmlTag(xml, "courseNo") || "";
  const vTel = xmlTag(xml, "vTelNo");
  const regi = String(s.regi_no || "").replace(/\D/g, "");
  const zip = String(s.recipient_zip || "").replace(/\D/g, "");
  // 안심번호는 11자리(0504-729-3352)·12자리(0503-5845-7201) 둘 다 온다. 11자리를 안 다뤄 하이픈 없이 찍혔다(2026-09-15).
  const recTel = vTel
    ? vTel.replace(/^(\d{4})(\d{4})(\d{4})$/, "$1-$2-$3").replace(/^(\d{4})(\d{3})(\d{4})$/, "$1-$2-$3")
    : (s.recipient_mobile || s.recipient_tel || "");
  const engrave = engravingOf(s, raw);
  const date = ymd(s.registered_at);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [mm(W_MM), mm(H_MM)], margin: 0, info: { Title: `label ${regi}` } });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // 폰트 등록 — 실패하면 AppleGothic + 겹쳐찍기로 폴백(라벨이 안 나가는 것보단 낫다)
    let faux = false;
    try {
      doc.registerFont("kr", TTC, FAM_BOLD);
      doc.registerFont("krH", TTC, FAM_HEAVY);
    } catch {
      faux = true;
      doc.registerFont("kr", FONT_FALLBACK);
      doc.registerFont("krH", FONT_FALLBACK);
    }

    // 세로 급지 페이지 위에 가로 좌표계(171 × 111)를 올린다.
    doc.save();
    doc.translate(mm(W_MM), 0).rotate(90);
    doc.fillColor("#000");

    const T = (txt, x, y, size) => {
      doc.font("kr").fontSize(size).text(String(txt ?? ""), mm(x), mm(y), { lineBreak: false });
    };
    /** 강조(Heavy). 폴백 모드에서만 0.15mm 겹쳐 굵게 흉내낸다. */
    const H = (txt, x, y, size) => {
      doc.font("krH").fontSize(size).text(String(txt ?? ""), mm(x), mm(y), { lineBreak: false });
      if (faux) doc.text(String(txt ?? ""), mm(x) + 0.4, mm(y), { lineBreak: false });
    };
    const R = (txt, xRight, y, size) => {
      doc.font("kr").fontSize(size);
      const w = doc.widthOfString(String(txt ?? ""));
      doc.text(String(txt ?? ""), mm(xRight) - w, mm(y), { lineBreak: false });
    };
    /** 오른쪽 끝 맞춤 + 강조 — 고정 x 로 두면 글자폭 따라 잘린다 */
    const HR = (txt, xRight, y, size) => {
      doc.font("krH").fontSize(size);
      const wMm = (doc.widthOfString(String(txt ?? "")) * 25.4) / 72;
      H(txt, xRight - wMm, y, size);
    };
    const block = (txt, x, y, wMm, size, hMm, gap = 0.5) => {
      doc.font("kr").fontSize(size).text(String(txt ?? ""), mm(x), mm(y), {
        width: mm(wMm), height: mm(hMm), lineGap: mm(gap), ellipsis: true,
      });
    };
    const bar = (text, x, y, wMm, hMm) => {
      const mods = code128Modules(text);
      const total = mods.reduce((a, m) => a + m.w, 0);
      const unit = mm(wMm) / total;
      let cx = mm(x);
      for (const m of mods) { if (m.bar) doc.rect(cx, mm(y), m.w * unit, mm(hMm)).fill("#000"); cx += m.w * unit; }
    };

    // ── 좌측칸 ────────────────────────────────────────────────
    T(`주문일 : ${date}`, SAFE_L, 12.9, 7.5);   // 로고(y 2~11)와 겹치지 않게
    T(`접수국 : ${String(s.regipo_nm || "").replace(/우체국$/, "")}`, SAFE_L, 16.1, 7.5);
    T("주문인:", SAFE_L, 21.6, 7.5);
    T(`고객 주문처: ${s.channel || ""}`, SAFE_L, 25.2, 7.5);
    R("요금:  계약요금", 58, 34.8, 8);
    R(`신청일 : ${date}`, 60.5, 43.2, 8);
    T("(1/1)", 52, 51.2, 7.5);
    if (zip) { bar(zip, 4.5, 46.5, 32, 12.5); H(zip, 13.5, 59.8, 10.5); }

    // 상품명(최대 3줄) + 각인 — 세로 분할선을 넘지 않게. 수량은 우체국 출력본과 같게 뒤에 붙인다.
    block(`${s.product_name || ""}${s.qty ? `, 수량:${s.qty}` : ""}`, SAFE_L, 67.0, 58, 8.5, 15.5);
    // 각인/배송메시지가 없으면 우체국 출력본처럼 "정보 없음"
    T(engrave ? (engrave.startsWith("[") ? engrave : `[각인] ${engrave}`) : "정보 없음", SAFE_L, 103.2, 9.5);

    // QR(종적조회) — 좌측칸 우상단
    try {
      const qr = QR.create(`https://service.epost.go.kr/trace.RetrieveDomRigiTraceList.comm?sid1=${regi}`, { errorCorrectionLevel: "M" });
      const n = qr.modules.size, cell = mm(10) / n;
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
        if (qr.modules.data[r * n + c]) doc.rect(mm(51) + c * cell, mm(4.5) + r * cell, cell + 0.2, cell + 0.2).fill("#000");
      }
    } catch { /* QR 실패해도 라벨은 나가야 한다 */ }

    // ── 우측칸: 집배코드 ──────────────────────────────────────
    H(area.head, 67.5, 5.5, 26);
    T(arrCnpo, 82, 11.4, 9.5);
    H(area.mid, 94, 4.8, 30);
    T(delivPo, 114, 11.8, 9.5);
    HR(`${area.a} ${area.b}`, SAFE_R, 6.2, 21);

    // ── 보내는분 (세로 라벨 "보/낸/분" 은 미리 인쇄돼 있다) ─────
    block(SENDER.addr, 71.5, 23.4, 54, 8, 9, 0.3);
    R(SENDER.zip, 138, 24.6, 9);
    H(SENDER.name, 71.5, 33.4, 11.5);
    R(`M: ${SENDER.mobile}`, SAFE_R, 34.8, 9);

    // ── 받는분 (세로 라벨 "받/는/분" 도 미리 인쇄) ──────────────
    block(s.recipient_addr, 72.5, 44.2, SAFE_R - 72.5, 12.5, 13, 0.8);
    H(`${s.recipient_name || ""} 님`, 72.5, 59.8, 16);
    H(`T: ${recTel}`, 72.5, 67.8, 11.5);
    if (vTel) T("※ 고객님의 개인정보 보호를위하여임시가상번호를사용합니다.", 72.5, 72.8, 6.5);
    T("등기번호:", 71.5, 77.8, 7.5);
    H(fmtRegi(regi), 83.5, 76.0, 14.5);

    // ── 등기 바코드 ──────────────────────────────────────────
    if (regi) bar(regi, 70, 85.5, 58, 17.5);
    H(course || "", 127.5, 100.4, 17);
    T("000", 139, 102.8, 9);

    doc.restore();
    doc.end();
  });
}

/** 인쇄 경로·정렬 확인용 테스트 라벨 (실제 접수 응답과 같은 모양의 더미) */
function renderTestLabel(note = "") {
  return renderLabel({
    regi_no: "6890100000001", regipo_nm: "서울서초우체국", channel: "테스트", order_number: "TEST",
    recipient_name: "테스트", recipient_mobile: "010-0000-0000", recipient_zip: "06600",
    recipient_addr: "서울특별시 서초구 테스트로 1 테스트빌딩 101호 (정렬 확인용)",
    product_name: `인쇄 정렬 테스트 ${note} — 이 라벨이 빨간 칸에 맞으면 성공`.trim(), qty: "1",
    registered_at: new Date().toISOString(),
    raw: { resp: "<delivAreaCd>서10000000</delivAreaCd><arrCnpoNm>테스트M</arrCnpoNm><delivPoNm>테스트국</delivPoNm><courseNo>000</courseNo><vTelNo>050300000000</vTelNo>", delivMsg: "[각인] 정렬 테스트" },
  });
}

module.exports = { renderLabel, renderTestLabel, xmlTag, splitAreaCd, fmtRegi };
