/**
 * 친구(디저트 브랜드 '시소카이막' · 두바이초콜릿 'AMA' 운영)에게 보낼
 * "Claude 실전 활용 사례" 소개 PDF 생성. 1회성.
 *   npx tsx scripts/claude-usecase-pdf.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import PDFDocument from "pdfkit";

const VIOLET = "#7C3AED";
const PURPLE = "#9333EA";
const INK = "#1E1B2E";
const SLATE = "#475569";
const MUTE = "#94A3B8";
const LINE = "#E5E1F0";
const SOFT = "#F5F3FF";

async function main() {
  const fontR = readFileSync(join(process.cwd(), "lib/fonts/Pretendard-Regular.otf"));
  const fontB = readFileSync(join(process.cwd(), "lib/fonts/Pretendard-Bold.otf"));

  const doc = new PDFDocument({
    size: "A4", margin: 0, bufferPages: true,
    info: { Title: "Claude 실전 활용 사례 — 1인 사업자의 운영 자동화", Author: "홍성조", Creator: "Paulvice" },
  });
  doc.registerFont("R", fontR);
  doc.registerFont("B", fontB);

  const chunks: Buffer[] = [];
  doc.on("data", (b: Buffer) => chunks.push(b));
  const done = new Promise<Buffer>((res, rej) => { doc.on("end", () => res(Buffer.concat(chunks))); doc.on("error", rej); });

  const W = doc.page.width;   // 595
  const H = doc.page.height;  // 842
  const M = 56;
  const CW = W - M * 2;

  // ── 헬퍼 ──────────────────────────────────────────────
  const need = (h: number) => { if (doc.y + h > H - 64) doc.addPage(); };
  function sectionTitle(num: string, title: string) {
    need(60);
    const y = doc.y;
    doc.roundedRect(M, y, 26, 26, 7).fill(VIOLET);
    doc.font("B").fontSize(13).fillColor("#FFFFFF").text(num, M, y + 6, { width: 26, align: "center" });
    doc.font("B").fontSize(15).fillColor(INK).text(title, M + 38, y + 4);
    doc.y = y + 34;
    doc.moveTo(M, doc.y).lineTo(M + CW, doc.y).strokeColor(LINE).lineWidth(1).stroke();
    doc.y += 12;
  }
  function para(text: string, opts: { color?: string; size?: number; gap?: number } = {}) {
    doc.font("R").fontSize(opts.size ?? 10.5).fillColor(opts.color ?? SLATE);
    need(28);
    doc.text(text, M, doc.y, { width: CW, lineGap: 3, align: "left" });
    doc.y += opts.gap ?? 8;
  }
  function bullet(head: string, body: string) {
    need(34);
    const y = doc.y;
    doc.circle(M + 3, y + 6, 2.4).fill(PURPLE);
    doc.font("B").fontSize(10.5).fillColor(INK).text(head, M + 14, y, { width: CW - 14, continued: true });
    doc.font("R").fontSize(10.5).fillColor(SLATE).text("  " + body, { width: CW - 14, lineGap: 2 });
    doc.y += 7;
  }
  function calloutBox(title: string, lines: string[], accent = VIOLET) {
    const pad = 14;
    doc.font("R").fontSize(10);
    let inner = 0;
    for (const l of lines) inner += doc.heightOfString(l, { width: CW - pad * 2 - 4, lineGap: 3 }) + 4;
    const boxH = 26 + inner + pad;
    need(boxH + 8);
    const y = doc.y;
    doc.roundedRect(M, y, CW, boxH, 10).fill(SOFT);
    doc.rect(M, y, 4, boxH).fill(accent);
    doc.font("B").fontSize(11).fillColor(accent).text(title, M + pad, y + pad);
    let yy = y + pad + 20;
    doc.font("R").fontSize(10).fillColor(INK);
    for (const l of lines) {
      const h = doc.heightOfString(l, { width: CW - pad * 2 - 4, lineGap: 3 });
      doc.text(l, M + pad, yy, { width: CW - pad * 2 - 4, lineGap: 3 });
      yy += h + 4;
    }
    doc.y = y + boxH + 12;
  }

  const PREVIEW = !!process.env.PREVIEW;
  if (!PREVIEW) {
  // ── 표지 ──────────────────────────────────────────────
  doc.rect(0, 0, W, H).fill("#FFFFFF");
  doc.rect(0, 0, W, 320).fill(VIOLET);
  doc.rect(0, 300, W, 20).fill(PURPLE);
  doc.font("R").fontSize(12).fillColor("#E9D5FF").text("1인 사업자의 운영 자동화 이야기", M, 92, { width: CW });
  doc.font("B").fontSize(30).fillColor("#FFFFFF").text("개발자 없이,", M, 122, { width: CW });
  doc.font("B").fontSize(30).fillColor("#FFFFFF").text("Claude로 사업을 굴리는 법", M, 160, { width: CW });
  doc.font("R").fontSize(11.5).fillColor("#EDE9FE").text(
    "내가 매일 실제로 만들고 쓰는 것들 — 그리고 디저트 브랜드라면 어떻게 쓸 수 있을지",
    M, 212, { width: CW, lineGap: 4 });
  doc.font("R").fontSize(10).fillColor("#DDD6FE").text("작성: 홍성조 (폴바이스 · 해리엇 워치)   |   2026.05.26", M, 264, { width: CW });

  // 인트로 레터
  doc.y = 360;
  doc.font("B").fontSize(13).fillColor(INK).text("오랜만에 통화 즐거웠어 :)", M, doc.y);
  doc.y += 8;
  para(
    "내가 Claude를 일에 어떻게 쓰는지 궁금해했지? 말로는 다 설명이 안 돼서, 내가 실제로 만들어 매일 " +
    "굴리는 것들이랑, 너처럼 디저트 브랜드(제주 시소카이막 · 두바이초콜릿 AMA) 하는 사람한테 바로 " +
    "도움이 될 만한 활용을 정리해봤어.", { gap: 6 });
  para(
    "먼저 한 가지만. 나는 개발자가 아니야. 코드 한 줄 못 짜. 그런데 지금은 직원 여러 명이 할 일을 " +
    "혼자 처리하고 있어 — 전부 Claude한테 한국어로 설명해서 만든 거야. 너도 충분히 할 수 있어.", { gap: 6 });

  calloutBox("Claude를 두 가지로 같이 써", [
    "① Claude 앱 (claude.ai · 데스크톱/모바일) — 대화로 묻고, 자료 분석하고, 이메일·캘린더·구글드라이브 같은 걸 연결해서 일을 시킴.",
    "② Claude Code (컴퓨터 터미널 도구) — '내 사업 운영 프로그램'을 직접 만들고 자동화함. 내가 코딩하는 게 아니라, 말로 시키면 Claude가 코드를 짜고 고치고 배포까지 해줘.",
  ]);

  }

  // ── 1. 내가 실제로 만들어 쓰는 것들 ───────────────────
  if (!PREVIEW) doc.addPage();
  doc.y = 56;
  sectionTitle("1", "내가 실제로 만들어서 매일 쓰는 것들");
  para("폴바이스(시계·주얼리)와 해리엇 워치를 1인으로 운영하면서, Claude로 '나만의 운영 대시보드'를 만들어 쓰고 있어. 전부 직접 시켜서 만든 거야.", { gap: 10 });

  bullet("통합 매출 대시보드", "자사몰 매출을 채널별·시간대별·일별로 자동 집계. 아침에 한 번 보면 끝.");
  bullet("재무·정산 자동화", "통장·카드·간편결제·홈택스 거래내역을 자동으로 읽어 손익(P&L)을 계산. 세무 자료가 저절로 정리돼.");
  bullet("광고 의사결정 시스템", "인스타·페북 광고를 매일 분석해서 '이건 예산 늘려라 / 이건 멈춰라'를 자동 추천. 광고비 새는 걸 막아줘.");
  bullet("CS 통합 인박스", "카페24·인스타·스레드·네이버·채팅 문의를 한 화면에 모으고, AI가 답장 초안까지 써줌.");
  bullet("재고·발주 관리", "품절 임박하면 텔레그램으로 알림. 생산 발주와 재입고 일정도 한 곳에서 관리.");
  bullet("공동구매 운영 리포트", "인플루언서 공구 판매를 매일 자정에 PDF 리포트로 자동 생성해서 텔레그램으로 발송.");
  bullet("고객 안내 문자(SMS)", "배송 지연·AS 같은 공지를 고객들에게 한 번에 발송. (바로 오늘 만든 기능이야 — 뒤에서 설명할게.)");
  bullet("AI 광고 이미지 생성", "제품 사진은 그대로 두고 배경·연출만 바꿔서 광고 소재를 빠르게 양산.");

  // ── 2. 오늘 하루 실제 사례 ────────────────────────────
  doc.y += 6;
  sectionTitle("2", "이 자료를 만든 '오늘' 실제로 한 일");
  para("이게 가장 와닿을 것 같아. 오늘 하루 Claude와 한 작업이야 — 나는 코드를 한 줄도 안 썼어.", { gap: 10 });

  calloutBox("오전 · 공동구매 마감 보고서 (약 10분)", [
    "인플루언서 공구가 끝나서 '마감 보고서 만들어줘'라고 했어.",
    "→ Claude가 주문 데이터를 분석해서 판매 73건·매출을 집계하고, 반품/취소 건까지 골라낸 뒤,",
    "   깔끔한 PDF 보고서를 만들어 텔레그램으로 보내줬어.",
  ], PURPLE);

  calloutBox("오후 · 고객 안내 문자 기능을 '0에서' 만들고 실제 발송 (반나절)", [
    "'고객들한테 배송 지연 안내 문자 보내는 기능'이 없어서 만들어달라고 했어.",
    "→ 문자 발송 서비스를 연결하고, 어떤 고객에게 보낼지 주문에서 자동으로 추리는 화면을 만들고,",
    "   실제 서비스에 배포까지 했어.",
    "→ 그리고 배송이 지연된 고객 24명에게 안내 문자를 실제로 발송 완료. 고객 이름은 자동으로 치환됐어.",
  ], VIOLET);
  para("하루 만에 '없던 기능'이 생기고 실제 고객에게까지 닿았어. 이게 Claude로 일하는 속도야.", { color: INK, gap: 6 });

  // ── 3. 디저트 브랜드라면 (맞춤) ───────────────────────
  doc.addPage();
  doc.y = 56;
  sectionTitle("3", "디저트 브랜드라면 이렇게 쓸 수 있어");
  para("시소카이막·AMA에 바로 대입해본 거야. 시계든 디저트든 '온라인으로 팔고, 문의 받고, 광고하고, 재고 챙기는' 건 똑같거든.", { gap: 10 });

  bullet("문의 폭주 대응", "'제주 외 배송 되나요?', '재고 있나요?', '유통기한은요?' 반복 문의를 인스타 DM·댓글까지 한 곳에 모으고 답장 초안 자동 생성.");
  bullet("인스타 광고 판단", "디저트는 비주얼 광고가 핵심이자 돈 새는 곳. '어떤 광고를 늘리고 멈출지'를 매일 자동으로 추천받아 광고비 효율 관리.");
  bullet("광고·상세 이미지 양산", "AMA 두바이초콜릿 단면컷, 시소카이막 비주얼을 배경·연출만 바꿔 여러 버전으로. 촬영 한 번으로 소재 여러 개.");
  bullet("재고·유통기한 관리", "식품은 유통기한과 재입고가 생명. 품절·임박 자동 알림, 발주·입고 일정 관리로 '없어서 못 파는' 일 방지.");
  bullet("고객 안내 문자·알림톡", "'오늘 픽업 안내', '제주 발송 지연 안내', 'AMA 신상 출시' 같은 공지를 주문 고객들에게 한 번에.");
  bullet("매출·정산 한눈에", "스마트스토어·자사몰·배민·쿠팡·백화점 입점까지 채널별 매출을 모아 일별/월별로. 정산·세무 자료 자동 정리.");
  bullet("예약판매·한정 공구", "한정 수량 디저트 예약 주문을 자동 집계하고, 마감 리포트까지 자동 생성.");
  bullet("기획·카피 작업", "신메뉴 이름, 상세페이지 카피, 플랫폼별(인스타/네이버) 문구를 브랜드 톤에 맞게 빠르게.");
  bullet("매일 아침 브리핑", "'어제 매출·신규 문의·품절 임박'을 매일 아침 카톡/텔레그램으로 한 줄 요약 받기.");

  // ── 4. 시작 가이드 ────────────────────────────────────
  doc.addPage();
  doc.y = 56;
  sectionTitle("4", "어떻게 시작하면 좋을까");
  bullet("1) Claude 앱부터 가볍게", "아무 질문, 자료 정리, 이메일·카피 초안, 엑셀/매출표 분석. 부담 없이 매일 쓰다 보면 감이 와.");
  bullet("2) 반복되는 귀찮은 일을 찾기", "'매번 손으로 하는 그거' 하나를 정해. 그게 첫 자동화 대상이야.");
  bullet("3) 그때 Claude Code로", "'이거 자동으로 매일 해줘' 수준으로 시키면 돼. 개발 몰라도 한국어로 설명하면 만들어줘.");
  bullet("4) 데이터를 연결하면 폭발적", "매출·고객·주문 데이터를 붙이는 순간, 단순 챗봇이 아니라 진짜 '운영 직원'이 돼.");

  // ── 마무리 ────────────────────────────────────────────
  doc.y += 6;
  calloutBox("솔직한 팁 하나", [
    "처음부터 완벽을 기대하지 말고 '대화하듯' 시켜. 실수도 하니까 검토는 필요해.",
    "근데 속도와 범위가 비교 불가야. 직원 한 명이 더 생긴 느낌, 그게 과장이 아니더라고.",
  ], PURPLE);
  para("한번 제대로 써봐. 막히면 언제든 연락하고 — 내가 세팅한 거 화면 공유하면서 보여줄게. 화이팅!  — 성조", { color: INK, gap: 4 });

  // 푸터 (모든 페이지)
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.font("R").fontSize(8).fillColor(MUTE).text(
      "Claude 실전 활용 사례 · 홍성조", M, H - 40, { width: CW, align: "left" });
    doc.font("R").fontSize(8).fillColor(MUTE).text(`${i + 1} / ${range.count}`, M, H - 40, { width: CW, align: "right" });
  }

  doc.end();
  const pdf = await done;
  const out = `${process.env.HOME}/Downloads/Claude_실전활용_홍성조.pdf`;
  writeFileSync(out, pdf);
  console.log(`생성 완료: ${out} (${pdf.byteLength.toLocaleString()} bytes, ${range.count}페이지)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
