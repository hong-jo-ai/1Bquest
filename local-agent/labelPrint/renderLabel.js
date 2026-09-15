/**
 * 우체국 전용라벨 **C형(2026.01)** 자체 출력 렌더러 (pdfkit).
 *
 * 스티커 = 111 × 171 mm 세로 급지. 그런데 인쇄 내용은 **90° 돌아간 가로 배치**다
 * (스티커에 빨간 격자·우체국소포 로고가 가로로 미리 인쇄돼 있다). 2026-09-15 실물 대조로 확정.
 *
 * 격자(가로 좌표계 171 × 111 mm, 실측):
 *   세로 분할선 x=66.7 · 가로 분할선 y=19.7 / 40.1 / 64.3 / 83.1
 *   좌측칸: 주문일·접수국 / 주문인·고객주문처·요금 / 신청일·우편번호바코드 / 상품명 … 하단 [각인]
 *   우측칸: 집배코드 / 보내는분 / 받는분·등기번호 / 등기바코드·코스번호
 *
 * ⚠️ 스티커에 **미리 인쇄된 것은 찍지 않는다**: 빨간 테두리·격자, 우체국소포 로고, "2026.01.ⓒ형",
 *    "신청 및 배달안내 ☎1588-1300", "개인정보 유출방지를 위하여 운송장은 제거바랍니다".
 *
 * 데이터 = pp_shipments 한 행. 접수 응답(raw.resp XML)에서:
 *   delivAreaCd(집배코드 9자리 예 `부46270404`) → 앞2 / 3~5 / 6~7 / 8~9 로 쪼개 크게 인쇄
 *   arrCnpoNm(도착집중국) · delivPoNm(배달국) · courseNo(코스) · vTelNo(수취인 안심번호)
 */
const PDFDocument = require("/Users/mac/sungjo_ai/paulwise-dashboard/node_modules/pdfkit");
const QR = require("qrcode");
const { code128Modules } = require("./code128");

const FONT = process.env.LABEL_FONT || "/System/Library/Fonts/Supplemental/AppleGothic.ttf";
const W_MM = Number(process.env.LABEL_WIDTH_MM || 111);   // 급지 방향(세로) 기준 폭
const H_MM = Number(process.env.LABEL_HEIGHT_MM || 171);  // 급지 방향 길이
const mm = (v) => (v * 72) / 25.4;

// 공급지(보내는분) — 우체국에 등록된 값. 조선몰 건도 같은 값이 찍힌다(공급지 기준).
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
  const recTel = vTel ? vTel.replace(/^(\d{4})(\d{4})(\d{4})$/, "$1-$2-$3") : (s.recipient_mobile || s.recipient_tel || "");
  const engrave = engravingOf(s, raw);
  const date = ymd(s.registered_at);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [mm(W_MM), mm(H_MM)], margin: 0, info: { Title: `label ${regi}` } });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // 세로 급지 페이지 위에 가로 좌표계(171 × 111)를 올린다.
    doc.save();
    doc.translate(mm(W_MM), 0).rotate(90);
    doc.font(FONT).fillColor("#000");

    const T = (txt, x, y, size, opt = {}) => {
      doc.fontSize(size).text(String(txt ?? ""), mm(x), mm(y), { lineBreak: false, ...opt });
    };
    /** AppleGothic 에 볼드가 없어 0.15mm 겹쳐 찍어 굵게 보이게 한다. */
    const B = (txt, x, y, size, opt = {}) => {
      T(txt, x, y, size, opt); T(txt, x + 0.16, y, size, opt); T(txt, x + 0.08, y + 0.08, size, opt);
    };
    const R = (txt, xRight, y, size) => {
      doc.fontSize(size);
      const w = doc.widthOfString(String(txt ?? ""));
      doc.text(String(txt ?? ""), mm(xRight) - w, mm(y), { lineBreak: false });
    };
    /** 오른쪽 끝 맞춤 + 굵게 */
    const BR = (txt, xRight, y, size) => {
      doc.fontSize(size);
      const wMm = (doc.widthOfString(String(txt ?? "")) * 25.4) / 72;
      B(txt, xRight - wMm, y, size);
    };
    const bar = (text, x, y, wMm, hMm) => {
      const mods = code128Modules(text);
      const total = mods.reduce((a, m) => a + m.w, 0);
      const unit = mm(wMm) / total;
      let cx = mm(x);
      for (const m of mods) { if (m.bar) doc.rect(cx, mm(y), m.w * unit, mm(hMm)).fill("#000"); cx += m.w * unit; }
    };

    // ── 좌측칸 ────────────────────────────────────────────────
    T(`주문일 : ${date}`, 0.8, 11.6, 8.5);
    T(`접수국 : ${String(s.regipo_nm || "").replace(/우체국$/, "")}`, 0.8, 14.8, 8.5);
    T("주문인:", 0.8, 21.0, 8.5);
    T(`고객 주문처: ${s.channel || ""}`, 0.8, 24.6, 8.5);
    R("요금:  계약요금", 59, 34.6, 9);
    R(`신청일 : ${date}`, 62, 42.8, 9);
    T("(1/1)", 53, 51.0, 8.5);
    if (zip) { bar(zip, 4.5, 46.5, 33, 12.5); B(zip, 13, 59.6, 12); }

    // 상품명(최대 3줄) + 각인
    doc.fontSize(9.5).fillColor("#000").text(String(s.product_name || ""), mm(0.8), mm(66.8), {
      width: mm(65), height: mm(15.5), lineGap: mm(0.5), ellipsis: true,
    });
    if (engrave) T(engrave.startsWith("[") ? engrave : `[각인] ${engrave}`, 0.8, 105.6, 11);

    // QR(종적조회) — 좌측칸 우상단
    try {
      const qr = QR.create(`https://service.epost.go.kr/trace.RetrieveDomRigiTraceList.comm?sid1=${regi}`, { errorCorrectionLevel: "M" });
      const n = qr.modules.size, cell = mm(10.5) / n;
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
        if (qr.modules.data[r * n + c]) doc.rect(mm(50.5) + c * cell, mm(4.2) + r * cell, cell + 0.2, cell + 0.2).fill("#000");
      }
    } catch { /* QR 실패해도 라벨은 나가야 한다 */ }

    // ── 우측칸: 집배코드 ──────────────────────────────────────
    B(area.head, 67.5, 4.0, 32);
    T(arrCnpo, 86, 10.8, 11);
    B(area.mid, 98, 3.0, 38);
    T(delivPo, 121, 11.6, 11);
    BR(`${area.a} ${area.b}`, 169.5, 4.8, 26); // 우측 끝 맞춤 — 고정 x 로 두면 글자폭 따라 잘린다

    // ── 보내는분 ─────────────────────────────────────────────
    T("보", 67.8, 22.8, 8.5); T("낸", 67.8, 26.4, 8.5); T("분", 67.8, 33.2, 8.5);
    doc.fontSize(9).text(SENDER.addr, mm(71.5), mm(23.2), { width: mm(62), height: mm(9), lineGap: mm(0.3), ellipsis: true });
    R(SENDER.zip, 157, 24.4, 10);
    B(SENDER.name, 71.5, 33.0, 13);
    R(`M: ${SENDER.mobile}`, 168, 34.4, 10);

    // ── 받는분 ───────────────────────────────────────────────
    T("받", 67.8, 50.5, 9); T("는", 67.8, 59.5, 9); T("분", 67.8, 67.5, 9);
    doc.fontSize(14).text(`${s.recipient_addr || ""}`, mm(72.5), mm(43.6), { width: mm(94), height: mm(13), lineGap: mm(0.8), ellipsis: true });
    B(`${s.recipient_name || ""} 님`, 72.5, 59.2, 18);
    B(`T: ${recTel}`, 72.5, 67.4, 13);
    if (vTel) T("※ 고객님의 개인정보 보호를위하여임시가상번호를사용합니다.", 72.5, 72.6, 7.5);
    T("등기번호:", 71.5, 78.9, 8.5);
    B(fmtRegi(regi), 85, 76.6, 17);

    // ── 등기 바코드 ──────────────────────────────────────────
    if (regi) bar(regi, 70, 85.5, 58, 17.5);
    B(course || "", 130, 99.6, 19);
    T("000", 143, 102.5, 10);

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
