/**
 * 우체국 운송장 라벨 PDF 렌더 (자체 출력용, pdfkit).
 *
 * ⚠️ 잠정 레이아웃(2026-09-15). 우체국 공식 규격은 계약고객전용시스템 고객센터 > 자주하는 질문
 *    "우체국 소포 운송장 규격 및 샘플" 첨부(로그인 필요)를 받아 맞춰야 한다. 그 전까진 100×150mm 에
 *    등기번호 Code128 + 집배코드 + 받는분/보내는분 + 상품명을 크게 넣는 표준 택배 라벨 형태.
 *
 * 데이터는 pp_shipments 한 행(접수 응답 raw 포함): regi_no, recipient_*, product_name, qty, channel,
 * raw.resp 의 delivAreaCd(집배코드)·arrCnpoNm(도착집중국)·delivPoNm(배달국)·courseNo.
 */
const PDFDocument = require("/Users/mac/sungjo_ai/paulwise-dashboard/node_modules/pdfkit");
const { code128Modules } = require("./code128");

const FONT = process.env.LABEL_FONT || "/System/Library/Fonts/Supplemental/AppleGothic.ttf";
// 우체국 전용라벨 C형(2026.01) = 111 × 171 mm (±5). 사장님이 쓰는 스티커. 첫 테스트는 100×150 으로 찍혀 하단이 비었다.
const LABEL_W_MM = Number(process.env.LABEL_WIDTH_MM || 111);
const LABEL_H_MM = Number(process.env.LABEL_HEIGHT_MM || 171);
const mm = (v) => (v * 72) / 25.4;

/** 접수 응답 XML(raw.resp)에서 태그값 추출 */
function xmlTag(xml, tag) {
  const m = new RegExp(`<${tag}>\\s*(?:<!\\[CDATA\\[)?([^<\\]]*)`).exec(xml || "");
  return m ? m[1].trim() : "";
}

function senderFor(channel) {
  const c = String(channel || "");
  if (/해리엇|harriot/i.test(c)) return { name: process.env.LABEL_SENDER_HARRIOT || "해리엇 (HARRIOT)", tel: process.env.LABEL_SENDER_TEL || "070-4571-4944" };
  return { name: process.env.LABEL_SENDER_PAULVICE || "폴바이스 (PAULVICE)", tel: process.env.LABEL_SENDER_TEL || "070-4571-4944" };
}

function drawBarcode(doc, text, x, y, widthMm, heightMm) {
  const mods = code128Modules(text);
  const total = mods.reduce((s, m) => s + m.w, 0);
  const unit = mm(widthMm) / total;
  let cx = x;
  for (const m of mods) {
    if (m.bar) doc.rect(cx, y, m.w * unit, mm(heightMm)).fill("#000");
    cx += m.w * unit;
  }
}

/** shipment 행 → PDF Buffer */
function renderLabel(s) {
  const raw = typeof s.raw === "string" ? (() => { try { return JSON.parse(s.raw); } catch { return {}; } })() : (s.raw || {});
  const xml = raw.resp || "";
  const areaCd = xmlTag(xml, "delivAreaCd");
  const arrCnpo = xmlTag(xml, "arrCnpoNm");
  const delivPo = xmlTag(xml, "delivPoNm");
  const course = xmlTag(xml, "courseNo");
  const regi = String(s.regi_no || "").replace(/\D/g, "");
  const sender = senderFor(s.channel);
  const W = mm(LABEL_W_MM), P = mm(4);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [W, mm(LABEL_H_MM)], margin: 0, info: { Title: `label ${regi}` } });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.font(FONT);

    // ── 상단: 집배코드(크게) + 도착집중국/배달국/코스
    doc.fontSize(9).fillColor("#000").text(`${s.regipo_nm || "우체국"} 계약소포`, P, mm(3));
    doc.fontSize(9).text(new Date(s.registered_at || Date.now()).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" }), W - P - mm(35), mm(3), { width: mm(35), align: "right" });
    doc.fontSize(26).text(areaCd || "-", P, mm(8), { width: W - 2 * P, characterSpacing: 1 });
    doc.fontSize(11).text([arrCnpo && `도착 ${arrCnpo}`, delivPo && `배달 ${delivPo}`, course && `코스 ${course}`].filter(Boolean).join("   "), P, mm(21));
    doc.moveTo(P, mm(27)).lineTo(W - P, mm(27)).lineWidth(0.8).stroke();

    // ── 받는분
    doc.fontSize(9).fillColor("#444").text("받는분", P, mm(29));
    doc.fillColor("#000").fontSize(15).text(`${s.recipient_name || ""}  ${s.recipient_mobile || s.recipient_tel || ""}`, P, mm(33), { width: W - 2 * P });
    doc.fontSize(11).text(`(${s.recipient_zip || ""}) ${s.recipient_addr || ""}`, P, mm(41), { width: W - 2 * P, height: mm(16), ellipsis: true });

    // ── 보내는분
    doc.moveTo(P, mm(59)).lineTo(W - P, mm(59)).lineWidth(0.5).stroke();
    doc.fontSize(9).fillColor("#444").text("보내는분", P, mm(61));
    doc.fillColor("#000").fontSize(11).text(`${sender.name}  ${sender.tel}`, P, mm(65), { width: W - 2 * P });

    // ── 상품 / 메시지
    doc.moveTo(P, mm(72)).lineTo(W - P, mm(72)).lineWidth(0.5).stroke();
    doc.fontSize(9).fillColor("#444").text(`상품 ${s.qty ? `(수량 ${s.qty})` : ""}`, P, mm(74));
    doc.fillColor("#000").fontSize(10).text(String(s.product_name || "").slice(0, 160), P, mm(78), { width: W - 2 * P, height: mm(20), ellipsis: true });
    const msg = raw.delivMsg || s.deliv_msg || "";
    if (msg) doc.fontSize(9).fillColor("#444").text(`메시지: ${String(msg).slice(0, 60)}`, P, mm(98), { width: W - 2 * P });

    // ── 등기번호 바코드
    doc.moveTo(P, mm(104)).lineTo(W - P, mm(104)).lineWidth(0.8).stroke();
    if (regi) {
      drawBarcode(doc, regi, mm(10), mm(108), LABEL_W_MM - 20, 24);
      doc.fillColor("#000").fontSize(16).text(regi.replace(/(\d{4})(\d{4})(\d{5})/, "$1-$2-$3"), P, mm(134), { width: W - 2 * P, align: "center", characterSpacing: 2 });
    }
    doc.fontSize(8).fillColor("#666").text(`주문 ${s.order_number || ""} · ${s.channel || ""}`, P, mm(143), { width: W - 2 * P, align: "center" });
    doc.end();
  });
}

/** 인쇄 경로 검증용 테스트 라벨 */
function renderTestLabel(note = "") {
  return renderLabel({
    regi_no: "6890100000001", regipo_nm: "서울서초우체국", channel: "테스트", order_number: "TEST",
    recipient_name: "테스트 수취인", recipient_mobile: "010-0000-0000", recipient_zip: "06600", recipient_addr: "서울 서초구 테스트로 1 테스트빌딩 101호",
    product_name: `인쇄 경로 테스트 ${note}`.trim(), qty: "1", registered_at: new Date().toISOString(),
    raw: { resp: "<delivAreaCd>A00000000</delivAreaCd><arrCnpoNm>테스트집중국</arrCnpoNm><delivPoNm>테스트국</delivPoNm><courseNo>000</courseNo>", delivMsg: "이 라벨이 프린터에서 나오면 연결 성공" },
  });
}

module.exports = { renderLabel, renderTestLabel, xmlTag };
