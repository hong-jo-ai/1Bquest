/**
 * 설월 인덱스 — 처마 곡선 도해 (인라인 SVG)
 *
 * 출처: Drive `★ HARRIOT/한옥시계-설월/260820-Dial.pdf` (파쇼 다이얼 도면, 2026-08-20)
 * 도면에서 실측한 인덱스 측면 프로파일을 그대로 옮긴 선화입니다. 임의로 예쁘게 고치지 않습니다.
 *
 *   전체        4.0 × 0.6 × 0.4 mm (아플라이드)
 *   양끝        수직면 0.21mm → 15° 경사면 0.7mm → 어깨
 *   가운데      어깨~어깨 2.6mm 구간이 R7 로 0.16mm **오목**
 *
 * 오목이 핵심입니다. 평평한 바통은 한 각도에서 한 번 번쩍이고 죽지만,
 * 오목한 면은 손목이 기울 때 하이라이트가 곡면을 타고 **이동**합니다 → 반짝임이 이어짐.
 * 다이얼은 최대한 광을 죽인 무광(도면 주기 1)이라 빛을 되던지는 건 인덱스뿐 = 눈밭의 햇빛.
 *
 * SVG 는 상세 HTML 에 인라인으로 박힙니다 — 카페24 붙여넣기 시 이미지 호스팅이 필요 없습니다.
 * 설명 라벨은 HTML 캡션으로 빼고, SVG 안에는 치수 수치만 남깁니다(모바일 가독성).
 */

// ── 도면 실측값 (mm) ────────────────────────────────────────────
const MM = { len: 4.0, wid: 0.6, hgt: 0.4, face: 0.21, chamfer: 0.7, chamAngle: 15, radius: 7, dip: 0.162 };

// ── 화면 좌표 (viewBox 1000 × 640) ──────────────────────────────
const K = 180;                    // px per mm
const X0 = 140, X1 = X0 + MM.len * K;               // 140 → 860
const BASE = 500, TOP = BASE - MM.hgt * K;          // 500 → 428
const FACE_TOP = BASE - MM.face * K;                // 462.2  수직 끝면 상단
const SH_L = X0 + MM.chamfer * K, SH_R = X1 - MM.chamfer * K; // 266 / 734  어깨
const DIP = MM.dip * K;                             // 29.2   오목 깊이
const CTRL = TOP + 2 * DIP;                         // 2차 베지어 제어점 = 중앙에서 DIP 만큼 처짐

// 처마선은 인덱스 오목 곡선과 **같은 비율·같은 폭**으로 그린다 (sag/span 6.2%) — "같은 곡선" 주장의 근거.
// 처마 끝(추녀)은 SH_L·SH_R 바깥으로 나가며 들린다 = 인덱스의 어깨가 솟는 것과 같은 사건.
const EAVE_Y = 252, EAVE_SAG = DIP, EAVE_CTRL = EAVE_Y + 2 * EAVE_SAG;
const TIP_L = 200, TIP_R = 800, TIP_Y = 196;
const RIDGE_Y = 108, RIDGE_L = 340, RIDGE_R = 660;

const n = (v) => Math.round(v * 10) / 10;

/** 지붕면의 기와 골 — 용마루에서 처마선까지 부채꼴로 내려긋는다 */
function tiles() {
  return [0.1, 0.225, 0.35, 0.5, 0.65, 0.775, 0.9]
    .map((t) => {
      const xe = SH_L + (SH_R - SH_L) * t;
      const ye = EAVE_Y + 4 * EAVE_SAG * t * (1 - t); // 베지어 y (x 는 선형)
      const xr = RIDGE_L + (RIDGE_R - RIDGE_L) * t;
      return `<line x1="${n(xr)}" y1="${RIDGE_Y}" x2="${n(xe)}" y2="${n(ye)}"/>`;
    })
    .join("");
}

/**
 * @param {object} o
 * @param {string} o.ink     본체 선/면 색
 * @param {string} o.accent  치수·주석 색
 * @param {string} o.soft    보조선 색
 */
function indexProfileSvg({ ink = "#0f1626", accent = "#2c3c63", soft = "#9aa4bb" } = {}) {
  // 처마선: 추녀(들린 끝) → 오목한 처마 → 추녀. 가운데 Q 구간이 인덱스 곡선과 동일 비율
  // 추녀는 처마 끝에서 위로 들리고(급 → 완), 지붕면은 용마루 쪽이 가파르고 처마 쪽이 완만하다(조로)
  const eave = `M ${TIP_L} ${TIP_Y} C ${TIP_L + 14} ${TIP_Y + 28} ${SH_L - 22} ${EAVE_Y - 2} ${SH_L} ${EAVE_Y}
       Q 500 ${n(EAVE_CTRL)} ${SH_R} ${EAVE_Y}
       C ${SH_R + 22} ${EAVE_Y - 2} ${TIP_R - 14} ${TIP_Y + 28} ${TIP_R} ${TIP_Y}`;
  const roof = `${eave}
       C ${TIP_R - 58} ${TIP_Y - 14} ${RIDGE_R + 22} ${RIDGE_Y + 20} ${RIDGE_R} ${RIDGE_Y}
       L ${RIDGE_L} ${RIDGE_Y}
       C ${RIDGE_L - 22} ${RIDGE_Y + 20} ${TIP_L + 58} ${TIP_Y - 14} ${TIP_L} ${TIP_Y} Z`;

  const profile = `M ${X0} ${BASE} L ${X0} ${n(FACE_TOP)} L ${SH_L} ${TOP}
       Q 500 ${n(CTRL)} ${SH_R} ${TOP} L ${X1} ${n(FACE_TOP)} L ${X1} ${BASE} Z`;

  const dipY = n(TOP + DIP); // 오목의 최저점

  return `<svg viewBox="0 0 1000 620" xmlns="http://www.w3.org/2000/svg" role="img"
     aria-label="한옥 처마선과 설월 인덱스 측면 프로파일 비교 도해">
  <g fill="none" stroke-linecap="round" stroke-linejoin="round">

    <!-- 한옥 지붕 — 처마선(아래 모서리)이 인덱스 오목 곡선과 같은 비율 -->
    <path d="${roof}" fill="${ink}" fill-opacity=".05" stroke="${ink}" stroke-opacity=".45" stroke-width="1.8"/>
    <g stroke="${ink}" stroke-opacity=".2" stroke-width="1.3">${tiles()}</g>
    <line x1="${RIDGE_L}" y1="${RIDGE_Y}" x2="${RIDGE_R}" y2="${RIDGE_Y}"
          stroke="${ink}" stroke-opacity=".55" stroke-width="4"/>
    <!-- 막새기와로 마감된 처마 끝 — 두께가 끝까지 유지된다 (바늘처럼 가늘어지지 않음) -->
    <path d="${eave}" stroke="${ink}" stroke-opacity=".8" stroke-width="4"/>

    <!-- 대응 보조선: 처마가 꺾여 오르는 지점 ↕ 인덱스 어깨 -->
    <g stroke="${soft}" stroke-width="1.3" stroke-dasharray="3 8">
      <line x1="${SH_L}" y1="${EAVE_Y + 10}" x2="${SH_L}" y2="${TOP}"/>
      <line x1="${SH_R}" y1="${EAVE_Y + 10}" x2="${SH_R}" y2="${TOP}"/>
    </g>

    <!-- 인덱스 측면 프로파일 (도면 실측) -->
    <path d="${profile}" fill="${ink}" fill-opacity=".92" stroke="${ink}" stroke-width="1.8"/>
    <line x1="${X0 - 34}" y1="${BASE}" x2="${X1 + 34}" y2="${BASE}" stroke="${soft}" stroke-width="1.3"/>

    <!-- 치수 -->
    <g stroke="${accent}" stroke-width="1.1" opacity=".8">
      <!-- R7 — 오목의 최저점에서 위로 뽑는다 (지붕과 인덱스 사이 여백) -->
      <line x1="500" y1="${dipY - 6}" x2="500" y2="${TOP - 62}"/>
      <!-- 4.0 전장 -->
      <line x1="${X0}" y1="${BASE + 14}" x2="${X0}" y2="${BASE + 54}"/>
      <line x1="${X1}" y1="${BASE + 14}" x2="${X1}" y2="${BASE + 54}"/>
      <line x1="${X0}" y1="${BASE + 44}" x2="${X1}" y2="${BASE + 44}"/>
      <!-- 0.7 경사면 -->
      <line x1="${SH_L}" y1="${TOP - 8}" x2="${SH_L}" y2="${TOP - 40}"/>
      <line x1="${X0}" y1="${n(FACE_TOP) - 8}" x2="${X0}" y2="${TOP - 40}"/>
      <line x1="${X0}" y1="${TOP - 30}" x2="${SH_L}" y2="${TOP - 30}"/>
      <!-- 0.4 높이 -->
      <line x1="${X1 + 50}" y1="${TOP}" x2="${X1 + 50}" y2="${BASE}"/>
      <line x1="${X1 + 38}" y1="${TOP}" x2="${X1 + 62}" y2="${TOP}"/>
      <line x1="${X1 + 38}" y1="${BASE}" x2="${X1 + 62}" y2="${BASE}"/>
      <!-- 15° 지시선 -->
      <line x1="${X0 - 8}" y1="${n(FACE_TOP) + 4}" x2="${X0 - 48}" y2="${n(FACE_TOP) - 14}"/>
    </g>

    <g fill="${accent}" stroke="none" font-size="30" font-weight="500" letter-spacing=".03em" text-anchor="middle">
      <text x="500" y="${TOP - 74}">R${MM.radius}</text>
      <text x="500" y="${BASE + 86}">${MM.len.toFixed(1)}</text>
      <text x="${n(X0 + (SH_L - X0) / 2)}" y="${TOP - 46}">${MM.chamfer}</text>
      <text x="${X1 + 50}" y="${TOP - 16}">${MM.hgt}</text>
      <text x="${X0 - 78}" y="${n(FACE_TOP) - 20}">${MM.chamAngle}°</text>
    </g>
  </g>
</svg>`;
}

module.exports = { indexProfileSvg, INDEX_MM: MM };

// 단독 SVG 파일로도 뽑아 둔다 — 릴스·블로그·광고 소재에서 재사용 (상세는 인라인이라 이 파일이 필요 없음)
if (require.main === module) {
  const fs = require("fs");
  const path = require("path");
  const dir = path.join(__dirname, "..", "downloads", "seolwol-detail");
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, "index-eave-profile.svg");
  fs.writeFileSync(out, indexProfileSvg());
  console.log(`✓ ${out}`);
}
