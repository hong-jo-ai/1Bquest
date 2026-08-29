/**
 * 설월 상세페이지 디자인 V2 실험안.
 * 기존 빌더·config·산출물은 수정하지 않고, 현재 국문 상세 HTML을 기반으로
 * 모바일 압축·구매정보 위계·비교/시퀀스 가독성을 개선한 별도 파일을 만든다.
 *
 * 사용: node local-agent/hrtDetailBuilderV2.js
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "downloads", "seolwol-detail");
const SOURCE = path.join(OUT, "seolwol-detail-ko.html");
const INNER = path.join(OUT, "seolwol-detail-ko-v2.html");
const PREVIEW = path.join(OUT, "seolwol-detail-ko-v2-preview.html");

if (!fs.existsSync(SOURCE)) {
  throw new Error("국문 상세 원본이 없습니다. 먼저 hrtDetailBuilder.js seolwol을 실행하세요.");
}

const v2Css = `
<style id="seolwol-v2-overrides">
/* V2 — 더 짧고 선명한 구매 흐름 */
#hrt-detail.v2{max-width:1100px;background:#fff;}
#hrt-detail.v2 .hero{padding:72px 42px 76px;}
#hrt-detail.v2 .hero .heroimg{max-width:820px;}
#hrt-detail.v2 .hero .heroline{margin-top:42px;}
#hrt-detail.v2 .hero .price{margin-top:34px;}
#hrt-detail.v2 .hero .badge{display:none;}
#hrt-detail.v2 .opening{display:none;}
#hrt-detail.v2 .buyfacts{max-width:760px;margin:30px auto 0;padding-top:24px;border-top:1px solid rgba(255,255,255,.16);display:grid;grid-template-columns:repeat(3,1fr);gap:8px;}
#hrt-detail.v2 .buyfact{padding:10px 8px;color:#d7deea;font-size:12px;line-height:1.55;letter-spacing:.01em;}
#hrt-detail.v2 .buyfact b{display:block;color:#fff;font-size:14px;font-weight:500;margin-bottom:2px;}
#hrt-detail.v2 .heroquote{max-width:620px;margin:26px auto 0;color:#949eaf;font-family:'Noto Serif KR',serif;font-size:14px;line-height:1.9;}

/* 섹션 호흡과 본문 가독성 */
#hrt-detail.v2 .sec{padding-top:88px;padding-bottom:88px;}
#hrt-detail.v2 .story p,#hrt-detail.v2 .narrative p,#hrt-detail.v2 .seq p,#hrt-detail.v2 .origin p{font-weight:400;line-height:1.9;}
#hrt-detail.v2 .mcap,#hrt-detail.v2 .seqgrid figcaption{color:#737b88;}
#hrt-detail.v2 .story{background:linear-gradient(180deg,#f2f5fa 0%,#f8f9fb 100%);}

/* 원전 → 제품 번역을 카드 단위로 묶는다 */
#hrt-detail.v2 .origin .pair{padding:28px;border:1px solid #e2e7ef;border-radius:2px;background:#f8f9fb;}
#hrt-detail.v2 .origin .pair+.pair{margin-top:22px;}
#hrt-detail.v2 .origin .pn{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border:1px solid #93a6cc;border-radius:50%;margin-bottom:22px;letter-spacing:0;}
#hrt-detail.v2 .origin .ptext{margin-top:22px;}

/* 변화는 한눈에, 제품 디테일은 편집 그리드로 */
#hrt-detail.v2 .seqgrid.cols3{grid-template-columns:repeat(3,1fr);}
#hrt-detail.v2 .seqgrid.cols4{grid-template-columns:repeat(2,1fr);}
#hrt-detail.v2 .life .grid{display:grid;grid-template-columns:1.35fr .65fr;gap:4px;}
#hrt-detail.v2 .life .grid>*{margin:0!important;}
#hrt-detail.v2 .life .grid>*:first-child{grid-row:span 2;}
#hrt-detail.v2 .life .grid>*:last-child{grid-column:1/-1;aspect-ratio:16/9!important;}

/* 스펙과 예약정보 */
#hrt-detail.v2 .spectable{max-width:720px;background:#fff;padding:10px 28px;border:1px solid #e2e7ef;}
#hrt-detail.v2 .spectable .row{padding:14px 2px;}
#hrt-detail.v2 .specnote{max-width:720px;padding:18px 22px;border:1px solid #c7d1e2;background:#eef2f8;color:#52617a;}

@media(max-width:768px){
  #hrt-detail.v2 .hero{padding:50px 20px 54px;}
  #hrt-detail.v2 .hero .heroline{margin-top:34px;}
  #hrt-detail.v2 .buyfacts{grid-template-columns:repeat(2,1fr);gap:0;margin-top:24px;}
  #hrt-detail.v2 .buyfact{border-bottom:1px solid rgba(255,255,255,.09);padding:12px 5px;}
  #hrt-detail.v2 .heroquote{font-size:13px;margin-top:20px;}
  #hrt-detail.v2 .sec{padding-top:60px;padding-bottom:60px;}
  #hrt-detail.v2 .story p,#hrt-detail.v2 .narrative p,#hrt-detail.v2 .seq p,#hrt-detail.v2 .origin p{line-height:1.85;}

  /* 떠오름→걸림→저묾은 모바일에서도 한 프레임에 */
  #hrt-detail.v2 .seqgrid.cols3{grid-template-columns:repeat(3,1fr)!important;gap:6px;margin-top:34px;}
  #hrt-detail.v2 .seqgrid.cols3 figcaption{font-size:11px;line-height:1.45;margin-top:8px;}
  #hrt-detail.v2 .seqgrid.cols4{grid-template-columns:repeat(2,1fr)!important;gap:10px;margin-top:36px;}

  /* 영감 비교도 좌우 관계를 지킨다 */
  #hrt-detail.v2 .origin .pair{padding:18px 12px;margin-top:32px;}
  #hrt-detail.v2 .origin .pair+.pair{margin-top:14px;}
  #hrt-detail.v2 .origin .pgrid{grid-template-columns:1fr 24px 1fr;gap:0;}
  #hrt-detail.v2 .origin .pgrid .arrow{transform:none;margin:0;}
  #hrt-detail.v2 .origin .pgrid figcaption{font-size:10px;line-height:1.45;}
  #hrt-detail.v2 .origin .ptext{font-size:14px;line-height:1.8;margin-top:18px;}

  /* 착용컷의 과도한 세로 길이를 2×2로 압축 */
  #hrt-detail.v2 .life .grid{grid-template-columns:repeat(2,1fr);gap:3px;}
  #hrt-detail.v2 .life .grid>*:first-child{grid-row:auto;}
  #hrt-detail.v2 .life .grid>*:last-child{grid-column:auto;aspect-ratio:4/5!important;}

  /* 긴 값은 전체 폭을 사용 */
  #hrt-detail.v2 .spectable{padding:8px 18px;}
  #hrt-detail.v2 .spectable .row{display:block;padding:13px 0;}
  #hrt-detail.v2 .spectable .row .k{width:auto;font-size:11px;letter-spacing:.06em;margin-bottom:5px;}
  #hrt-detail.v2 .spectable .row .v{font-size:14px;line-height:1.65;}
}
</style>`;

let html = fs.readFileSync(SOURCE, "utf8");
html = html.replace('<div id="hrt-detail">', '<div id="hrt-detail" class="v2">');

const facts = `<div class="buyfacts" aria-label="핵심 상품 정보">
  <div class="buyfact"><b>38mm · 8.15mm</b>슬림 드레스 워치</div>
  <div class="buyfact"><b>9월 7일 예정</b>출시일 미확정</div>
  <div class="buyfact"><b>각인 상시 무료</b>출고 지연 없음</div>
  <div class="buyfact"><b>2년 보증</b>공식 보증 제공</div>
</div><p class="heroquote">어떤 밤은 지나가지 않습니다.<br>오래 남는 밤은, 대개 아주 조용한 밤입니다.</p>`;

html = html.replace(/(<p class="badge">[\s\S]*?<\/p>)/, `$1${facts}`);
html += v2Css;

fs.writeFileSync(INNER, html);
fs.writeFileSync(PREVIEW, `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>HARRIOT 설월 상세페이지 V2</title>
<style>html,body{margin:0;background:#e8eaee;}body{padding:0 0 80px;}</style>
</head><body>${html}</body></html>`);

console.log(`✓ 설월 상세페이지 V2 생성\n  ${INNER}\n  ${PREVIEW}`);
