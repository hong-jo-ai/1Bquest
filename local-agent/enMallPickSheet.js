/**
 * 영문몰(shop_no=2) 출고 준비표 PDF.
 *
 * 왜 필요한가: 페덱스 라벨에는 **상품명이 안 찍힌다**(수취인·운송장·서비스만). 국내 우체국 라벨은
 * 상품명·각인이 같이 찍혀 그걸 보고 포장하는데, 영문몰은 볼 게 없어 주문서를 따로 열어야 했다
 * (사장님 2026-09-28: "내가 따로 준비할 수 있게 PDF 하나 만들어서 인쇄해줘").
 *
 * 담는 것: 주문번호·고객·국가 / 품목과 수량 / **각인 문구·서체** / 박스 규격·청구중량 / 결제액 /
 *          발급 상태(라벨 발급 전이면 막힌 사유).
 * 라벨 발급 여부와 무관하게 **배송준비중인 shop2 주문 전부**를 담는다 — 포장 준비가 목적이므로.
 *
 * 실행: node local-agent/enMallPickSheet.js            PDF 생성만(경로 출력)
 *       node local-agent/enMallPickSheet.js --print    생성 후 레이저 프린터로 인쇄
 *       node local-agent/enMallPickSheet.js --printer "<이름>"   프린터 지정
 * 기본 프린터는 EN_PICK_PRINTER(없으면 lpstat 기본 프린터).
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const DASH = path.resolve(__dirname, "..");
const PDFDocument = require(path.join(DASH, "node_modules/pdfkit"));
const { collectEnMallTargets } = require("./enMallOutbound");

const TTC = "/System/Library/Fonts/AppleSDGothicNeo.ttc";
const FALLBACK = "/System/Library/Fonts/Supplemental/AppleGothic.ttf";
const ARGV = process.argv.slice(2);
// 파일명 날짜는 KST — UTC 로 찍으면 오전 9시 전에는 어제 날짜가 된다.
const KST_YMD = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
const OUT = path.join(require("os").tmpdir(), `en-mall-pick-${KST_YMD}.pdf`);

function fontsOn(doc) {
  try {
    doc.registerFont("kr", TTC, "AppleSDGothicNeo-Regular");
    doc.registerFont("krB", TTC, "AppleSDGothicNeo-Bold");
  } catch {
    doc.registerFont("kr", FALLBACK);
    doc.registerFont("krB", FALLBACK);
  }
}

function render(targets, file) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 36, info: { Title: "영문몰 출고 준비표" } });
    const out = fs.createWriteStream(file);
    doc.pipe(out);
    fontsOn(doc);

    const today = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "long", timeStyle: "short" });
    doc.font("krB").fontSize(16).text("영문몰 출고 준비표 (FedEx)", { align: "left" });
    doc.font("kr").fontSize(9).fillColor("#555").text(`${today} · 발송 대기 ${targets.length}건 · 페덱스 라벨에는 상품명이 없어 이 표로 준비합니다`);
    doc.fillColor("#000").moveDown(0.8);

    targets.forEach((t, i) => {
      if (doc.y > 690) doc.addPage(), fontsOn(doc);
      const top = doc.y;
      doc.rect(36, top, 523, 1).fill("#000").fillColor("#000");
      doc.moveDown(0.4);

      doc.font("krB").fontSize(12).text(`${i + 1}. ${t.brand} ${t.orderNo}  ·  ${t.name} (${t.addrParts.countryCode})`);
      doc.font("kr").fontSize(10).fillColor("#333").text(`주문일 ${t.orderDate} · 결제 $${t.amountUSD} · 박스 ${t.box.boxId} ${t.box.lengthCm}×${t.box.widthCm}×${t.box.heightCm}cm · 청구중량 ${t.box.weightKg}kg`);
      doc.fillColor("#000").moveDown(0.3);

      doc.font("krB").fontSize(11).text("품목");
      doc.font("kr").fontSize(11);
      for (const it of t.items) doc.text(`   □  ${it.name}  ×${it.qty}`);

      if (t.engravings.length) {
        doc.moveDown(0.2);
        doc.font("krB").fontSize(11).fillColor("#a00").text("각인 — 새기면 되돌릴 수 없음");
        doc.font("kr").fontSize(11).fillColor("#a00");
        for (const e of t.engravings) {
          const font = /설월|seolwol/i.test(String(e.product)) && !/\[/.test(e.text) ? "  (설월 기본 Times New Roman)" : ""
            + (e.corrected ? "  (고객 메일 정정 — 주문서 문구 아님)" : "");
          // 줄바꿈은 각인 미리보기가 ⏎ 로 넣어 보낸다. 그 글자는 한글 폰트에 없어 네모로 깨지므로
          // **실제 줄로 나눠 찍는다** — 몇 줄짜리 각인인지가 작업자에게 그대로 보인다.
          const lines = String(e.text).split(/\s*⏎\s*/).filter(Boolean);
          if (lines.length > 1) {
            doc.text(`   「${font ? "" : ""}`, { continued: false });
            lines.forEach((ln, n) => doc.text(`     ${n + 1}줄: ${ln}`, { width: 500 }));
            doc.text(`   」${font}`);
          } else doc.text(`   「${e.text}」${font}`, { width: 500 });
          doc.fontSize(9).fillColor("#666").text(`      ← ${e.product}`);
          doc.fontSize(11).fillColor("#a00");
        }
        doc.fillColor("#000");
      }
      if (t.msgLooksEngraving) {
        doc.font("kr").fontSize(10).fillColor("#a00").text(`   ⚠️ 배송메시지에 각인 언급: "${t.shippingMessage}"`, { width: 500 }).fillColor("#000");
      }

      doc.moveDown(0.2);
      doc.font("kr").fontSize(9).fillColor("#333").text(`주소 ${t.addrText}`, { width: 500 });
      if (t.blockers.length) doc.fillColor("#a00").font("krB").fontSize(10).text(`라벨 발급 막힘: ${t.blockers.join(", ")}`);
      doc.fillColor("#000").moveDown(0.6);
    });

    if (!targets.length) doc.font("kr").fontSize(12).text("발송 대기 주문이 없습니다.");

    doc.end();
    out.on("finish", () => resolve(file));
    out.on("error", reject);
  });
}

(async () => {
  const targets = await collectEnMallTargets();
  await render(targets, OUT);
  console.log(`생성: ${OUT} (${targets.length}건)`);
  if (ARGV.includes("--print")) {
    const i = ARGV.indexOf("--printer");
    const printer = i >= 0 ? ARGV[i + 1] : process.env.EN_PICK_PRINTER || "";
    const args = printer ? ["-P", printer, OUT] : [OUT];
    execFileSync("lpr", args);
    console.log(`인쇄 전송${printer ? ` → ${printer}` : " (기본 프린터)"}`);
  }
})().catch((e) => { console.error("실패:", e.message); process.exit(1); });
