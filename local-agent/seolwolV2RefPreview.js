/**
 * 설월 V2 디자인 + AI 촬영 레퍼런스 통합 미리보기.
 * 실제 업로드용 상세와 분리된 검토 전용 문서다.
 *
 * 사용: node local-agent/seolwolV2RefPreview.js
 */

const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "..", "downloads", "seolwol-detail");
const BASE_REF = path.join(OUT, "seolwol-preview-REF.html");
const V2 = path.join(OUT, "seolwol-detail-ko-v2.html");
const TARGET = path.join(OUT, "seolwol-detail-ko-v2-AI-preview.html");

for (const file of [BASE_REF, V2]) {
  if (!fs.existsSync(file)) throw new Error(`필요한 미리보기 파일이 없습니다: ${file}`);
}

const v2 = fs.readFileSync(V2, "utf8");
const css = v2.match(/<style id="seolwol-v2-overrides">[\s\S]*?<\/style>/)?.[0];
const facts = v2.match(/<div class="buyfacts"[\s\S]*?<p class="heroquote">[\s\S]*?<\/p>/)?.[0];
if (!css || !facts) throw new Error("V2 디자인 요소를 찾지 못했습니다.");

let html = fs.readFileSync(BASE_REF, "utf8");
html = html.replace('<div id="hrt-detail">', '<div id="hrt-detail" class="v2">');
html = html.replace(/(<p class="badge">[\s\S]*?<\/p>)/, `$1${facts}`);
html = html.replace("</head>", `<style>
body{padding-bottom:70px;}
.ai-ref-note{max-width:1100px;margin:0 auto;background:#fff4e8;color:#7a4517;padding:13px 20px;text-align:center;font:500 12px/1.7 'Noto Sans KR',sans-serif;border-bottom:1px solid #efd3b5;}
.extra-ref{max-width:1100px;margin:0 auto;background:#f4f6f9;padding:76px 40px;text-align:center;font-family:'Noto Sans KR',sans-serif;}
.extra-ref h2{font-family:'Noto Serif KR',serif;font-size:26px;font-weight:500;color:#172238;margin:0 0 12px;}
.extra-ref>p{font-size:13px;line-height:1.8;color:#6d7685;margin:0 auto 34px;}
.extra-ref-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px;max-width:820px;margin:0 auto;}
.extra-ref-grid figure{margin:0;background:#fff;padding-bottom:13px;}
.extra-ref-grid img{display:block;width:100%;height:auto;}
.extra-ref-grid figcaption{font-size:12px;color:#687385;margin-top:12px;}
.extra-ref-grid figure:last-child{grid-column:1/-1;max-width:520px;justify-self:center;}
@media(max-width:768px){.extra-ref{padding:54px 18px}.extra-ref-grid{gap:8px}.extra-ref-grid figcaption{font-size:10px;padding:0 5px}}
</style></head>`);
html = html.replace(
  /(<\/div>\s*<div id="hrt-detail" class="v2">)/,
  `$1<div class="ai-ref-note">아래 제품 이미지는 촬영 구도와 조명을 검토하기 위한 AI 레퍼런스입니다. 실제 제품의 비율·다이얼·인덱스·문페이즈·로고와 다를 수 있습니다.</div>`
);
html = html.replace("</body>", `${css}</body>`);
html = html.replace(
  "<title>설월 상세 — AI 레퍼런스 미리보기</title>",
  "<title>HARRIOT 설월 V2 — AI 촬영 레퍼런스 통합 미리보기</title>"
);

const extras = `<section class="extra-ref" aria-label="추가 촬영 및 무드 레퍼런스">
  <h2>Additional Visual References</h2>
  <p>본문에서 선택되지 않은 대체 구도까지 모두 모았습니다.<br>실제 상세페이지에는 촬영본을 보고 가장 강한 구도만 남깁니다.</p>
  <div class="extra-ref-grid">
    <figure><img src="refs/studio/cut05b_aperture-alt.png" alt="문페이즈 창 대체 구도"><figcaption>문페이즈 창 · 대체 구도</figcaption></figure>
    <figure><img src="refs/studio/cut10_index-hands.png" alt="인덱스와 핸즈 클로즈"><figcaption>처마 곡선 인덱스 · 클로즈</figcaption></figure>
    <figure><img src="refs/studio/cut11b_flat-edge-alt.png" alt="플랫 사파이어 측면 대체 구도"><figcaption>플랫 사파이어 · 대체 구도</figcaption></figure>
    <figure><img src="world/m35_eavegap.png" alt="한옥 처마 사이의 하늘"><figcaption>한옥 처마 사이 · 무드 대체안</figcaption></figure>
    <figure><img src="world/m39_eave-alt.png" alt="한옥 처마와 달 대체 이미지"><figcaption>처마와 달 · 무드 대체안</figcaption></figure>
  </div>
</section>`;
html = html.replace(/(<section class="closing">)/, `${extras}$1`);

fs.writeFileSync(TARGET, html);
console.log(`✓ 설월 V2 + AI 레퍼런스 통합 미리보기 생성\n  ${TARGET}`);
