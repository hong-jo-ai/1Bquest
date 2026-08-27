/**
 * 폴바이스 시계 상세페이지 표준 템플릿 빌더
 * — 해리엇 대량생산 방식: 브랜드 템플릿 1개 + 상품별 config(이미지·텍스트)만 교체.
 *
 * 디자인 근거: paulvice-watch-detail-template 메모리(196 승인 레이아웃) + paulvice-design-tone.
 *   사진우선·글최소·모바일 1열 풀폭·블랙/화이트/그레이(+라이트그레이 #efeeec 섹션 교차)·
 *   섹션: 인트로→히어로→DESIGN→착용→두무드(정사각 좌우대칭)→팔찌혜택→라이프스타일→
 *         (선택)AS SEEN ON→각인→패키지/스펙→USP→SIZE(TryItOn 연결)
 *
 * 사용:
 *   const { buildWatchDetail } = require("./pvDetailBuilder");
 *   const html = buildWatchDetail(config);   // config 예시는 파일 하단 참조
 */

const SERIF = "Georgia,'Times New Roman',serif"; // 워드마크성 표기 전용(BI: 오리엔티드 타입)
const SANS = "'Pretendard','Apple SD Gothic Neo','Malgun Gothic',sans-serif";
const INK = "#000", BODY = "#575757", SUB = "#999", GREY = "#EFEFEF", OFF = "#f9f8f6", CHAR = "#000", PVGRAY = "#B1AAA2"; // BI: Black #000 · White #EFEFEF · Paul Vice Gray #B1AAA2

const esc = (s) => String(s == null ? "" : s);
const img = (src, alt, mb = 12) => src ? `<img src="${src}" alt="${esc(alt)}" style="width:100%;display:block;${mb ? `margin-bottom:${mb}px;` : ""}">` : "";
const eyebrow = (t, color = PVGRAY) => `<p style="font-family:${SANS};font-weight:600;font-size:11.5px;letter-spacing:.32em;color:${color};margin:0 0 12px;">${esc(t)}</p>`;
const head = (t, size = 24) => `<h3 style="font-family:${SANS};font-size:${size}px;color:${INK};font-weight:600;letter-spacing:-.01em;margin:0 0 16px;word-break:keep-all;">${esc(t)}</h3>`;
const body = (t) => `<p style="font-size:14.5px;line-height:1.9;margin:0;word-break:keep-all;color:${BODY};">${t}</p>`;
const sectionHead = (eb, h, b, pad = "0 20px 34px") => `
<div style="text-align:center;padding:${pad};">
  ${eyebrow(eb)}${head(h)}${b ? body(b) : ""}
</div>`;

function buildWatchDetail(c) {
  const parts = [];
  parts.push(`<div class="pv-watch-detail" style="max-width:860px;margin:0 auto;font-family:${SANS};color:${BODY};">`);

  // ── 인트로 (키컬러 Paul Vice Gray 배경 — BI Color System) ──
  parts.push(`
<div style="background:${PVGRAY};text-align:center;padding:72px 20px 64px;">
  <p style="font-family:${SERIF};font-size:13px;letter-spacing:.35em;color:#fff;margin:0 0 18px;">${esc(c.collectionEn)}</p>
  <h2 style="font-family:${SANS};font-size:29px;color:${INK};font-weight:700;letter-spacing:-.01em;line-height:1.45;margin:0 0 18px;word-break:keep-all;">${c.title}</h2>
  <p style="font-size:14.5px;line-height:1.9;margin:0;word-break:keep-all;color:#403b35;">${c.tagline}</p>
</div>`);

  // ── AS SEEN ON (셀럽 — 최상단 훅, 선택) ──
  if (c.celeb) {
    parts.push(`
<div style="background:${GREY};text-align:center;padding:56px 20px 48px;">
  <p style="font-family:${SERIF};font-size:13px;letter-spacing:.35em;color:${SUB};margin:0 0 14px;">AS SEEN ON</p>
  <h3 style="font-family:${SERIF};font-size:27px;letter-spacing:.16em;color:${INK};font-weight:400;margin:0 0 10px;">${esc(c.celeb.nameEn)}</h3>
  <p style="font-size:14px;color:${BODY};margin:0 0 30px;">${esc(c.celeb.caption)}</p>
  <img src="${c.celeb.image}" alt="${esc(c.celeb.nameEn)} 착용" style="width:100%;max-width:600px;display:block;margin:0 auto;">
  ${c.celeb.credit ? `<p style="font-family:${SERIF};font-size:11px;letter-spacing:.2em;color:#aaa;margin:16px 0 0;">${esc(c.celeb.credit)}</p>` : ""}
</div>`);
  }

  // ── 히어로 착용컷 ──
  parts.push(img(c.images.hero, c.name + " 착용컷", 0));

  // ── 프로모 상단 세그먼트 (기존 제작 프로모 블록 그대로 삽입, 선택) ──
  if (c.images.promoTop) parts.push(img(c.images.promoTop, "프로모션", 0));

  // ── 기존 제작 세그먼트 통재사용 (헤더 없이 나열, 선택) ──
  if (c.images.passThrough && c.images.passThrough.length) {
    c.images.passThrough.forEach((u,i)=>parts.push(img(u, `${c.name} 상세 ${i+1}`, 0)));
  }

  // ── DESIGN ──
  parts.push(`<div style="padding:70px 0 0;">${sectionHead("DESIGN", c.designTitle || "디자인", c.designCopy)}</div>`);
  parts.push(img(c.images.design, c.name + " 제품컷"));
  if (c.images.detail) parts.push(img(c.images.detail, c.name + " 디테일", 0));

  // ── 제품 디테일 (복수, 선택) ──
  if (c.images.details && c.images.details.length) {
    parts.push(`<div style="padding:70px 0 0;">${sectionHead("THE DETAILS", c.detailTitle || "가까이 볼수록", c.detailCopy)}</div>`);
    c.images.details.forEach((u, i) => parts.push(img(u, `${c.name} 디테일 ${i + 1}`, i === c.images.details.length - 1 ? 0 : 12)));
  }

  // ── 착용컷 ──
  if (c.images.wear && c.images.wear.length) {
    parts.push(`<div style="padding:70px 0 0;">${sectionHead("ON THE WRIST", c.wearTitle || "손목 위에서", c.wearCopy)}</div>`);
    c.images.wear.forEach((u, i) => parts.push(img(u, `${c.name} 착용컷 ${i + 1}`, i === c.images.wear.length - 1 ? 0 : 12)));
  }

  // ── 두 무드 (차콜 섹션, 정사각 대칭 2컷) ──
  if (c.images.moodA && c.images.moodB) {
    parts.push(`
<div style="background:${CHAR};color:#fff;text-align:center;padding:60px 20px;margin:70px 0 0;">
  <p style="font-family:${SERIF};font-size:12px;letter-spacing:.3em;color:#8c8278;margin:0 0 12px;">TWO MOODS</p>
  <h3 style="font-family:${SERIF};font-size:25px;color:#fff;font-weight:400;margin:0 0 14px;">한 시계, 두 가지 무드</h3>
  <p style="font-size:14px;line-height:1.8;color:#bbb;margin:0 0 30px;word-break:keep-all;">${esc(c.moodCopy || "기본 가죽 스트랩, 그리고 메탈 브레이슬릿.\n스트랩만 바꿔도 다른 시계가 됩니다.").replace(/\n/g, "<br>")}</p>
  <img src="${c.images.moodA}" alt="${esc(c.name)} ${esc(c.moodALabel || "가죽")}" style="width:100%;display:block;margin-bottom:8px;">
  <p style="font-family:${SERIF};font-size:11px;letter-spacing:.24em;color:#8c8278;margin:0 0 22px;">${esc(c.moodALabelEn || "LEATHER — 기본 구성")}</p>
  <img src="${c.images.moodB}" alt="${esc(c.name)} ${esc(c.moodBLabel || "메탈")}" style="width:100%;display:block;margin-bottom:8px;">
  <p style="font-family:${SERIF};font-size:11px;letter-spacing:.24em;color:#8c8278;margin:0;">${esc(c.moodBLabelEn || "METAL — 스트랩 추가 구매")}</p>
</div>`);
  }

  // ── 팔찌 레이어드 혜택 ──
  if (c.braceletPromo) {
    parts.push(`
<div style="background:${GREY};text-align:center;padding:56px 20px;margin:0 0 70px;">
  ${eyebrow("LAYERED", SUB)}
  ${head("팔찌와 함께, 더 예쁘게")}
  ${body(c.braceletPromo.copy || `워치와 큐빅 커프 팔찌를 함께 구매하시면<br>단품 ₩59,000 → <b style="color:${INK};">₩36,000 (39% OFF)</b><br>구매옵션 아래 <b style="color:${INK};">추가구성상품</b>에서 골드/실버를 선택하세요.`)}
  ${c.braceletPromo.image ? `<img src="${c.braceletPromo.image}" alt="레이어드 착용" style="width:100%;max-width:600px;display:block;margin:28px auto 0;">` : ""}
  ${c.braceletPromo.image2 ? `<img src="${c.braceletPromo.image2}" alt="큐빅 커프 팔찌" style="width:100%;max-width:600px;display:block;margin:12px auto 0;">` : ""}
</div>`);
  }

  // ── MOVING LOOK (착용 영상, 선택) ──
  if (c.video) {
    parts.push(`
<div style="background:#000;text-align:center;padding:56px 20px 60px;margin:70px 0 0;">
  <p style="font-family:${SANS};font-weight:600;font-size:11.5px;letter-spacing:.32em;color:${PVGRAY};margin:0 0 12px;">MOVING LOOK</p>
  <h3 style="font-family:${SANS};font-size:24px;color:#fff;font-weight:600;letter-spacing:-.01em;margin:0 0 26px;">움직이는 손목 위에서</h3>
  <video src="${c.video}" muted loop autoplay playsinline controls${c.videoPoster ? ` poster="${c.videoPoster}"` : ""} style="width:100%;max-width:300px;border-radius:8px;margin:0 auto;display:block;"></video>
</div>`);
  }

  // ── 각인 (형태 맞는 실물 각인컷이 있을 때만) ──
  if (c.images.engraving) {
    parts.push(`<div style="padding:70px 0 0;">${sectionHead("ENGRAVING", "세상에 하나뿐인 시계", c.engravingCopy || `케이스백에 이름·기념일을 <b style="color:${INK};">무료로 각인</b>해 드립니다.<br>주문 시 각인 문구를 입력해 주세요.`)}</div>`);
    parts.push(img(c.images.engraving, "무료 각인", 0));
  }

  // ── 패키지 / 스펙 ──
  parts.push(`<div style="padding:70px 0 0;">${sectionHead("GIFTING", "선물이라면, 더 완벽하게", `폴바이스 기프트 패키지에 담아 보내드립니다.`)}</div>`);
  if (c.images.gifting) parts.push(img(c.images.gifting, "기프트 패키지", 0));

  const spec = c.spec || {};
  parts.push(`
<div style="padding:60px 20px 0;">
  <p style="font-family:${SERIF};font-size:12px;letter-spacing:.3em;color:${SUB};text-align:center;margin:0 0 24px;">SPECIFICATION</p>
  <table style="width:100%;border-collapse:collapse;font-size:13.5px;color:${BODY};">
    ${Object.entries(spec).map(([k, v]) => `<tr style="border-top:1px solid #eee;"><td style="padding:11px 8px;color:${SUB};width:110px;">${esc(k)}</td><td style="padding:11px 8px;">${esc(v)}</td></tr>`).join("\n    ")}
    <tr style="border-top:1px solid #eee;border-bottom:1px solid #eee;"><td style="padding:11px 8px;color:${SUB};">보증</td><td style="padding:11px 8px;">폴바이스 공식 6개월 무상 A/S</td></tr>
  </table>
</div>`);

  // ── USING (받으신 뒤 사용 안내 — 쿼츠 작동방지 탭. 탭 있음/없음 양방향 오해 예방, 2026-07-22) ──
  parts.push(`
<div style="background:${OFF};text-align:center;padding:56px 20px;margin:44px 0 0;">
  ${eyebrow("USING", SUB)}
  ${head("받으신 뒤, 작동방지 탭 안내")}
  ${body(c.usingCopy || `쿼츠 시계는 배터리 보호를 위해 용두(옆면 조작 버튼)에 투명 <b style="color:${INK};">작동방지 탭</b>을 끼워 출고합니다. 주문량에 따라 배송 전 저희가 미리 제거해 보내드리기도 합니다.<br><br>· <b style="color:${INK};">시계가 멈춰 있다면</b> — 용두를 살짝 당겨 탭을 제거하고, 시간을 맞춘 뒤 용두를 다시 밀어 넣어 주세요.<br>· <b style="color:${INK};">탭이 없다면</b> — 검수 과정에서 제거 후 발송된 정상 제품이니 안심하고 사용하세요.`)}
</div>`);

  // ── USP 스트립 ──
  parts.push(`
<div style="display:flex;justify-content:center;gap:12px;font-size:12.5px;color:#888;border-top:1px solid #eee;border-bottom:1px solid #eee;padding:16px 0;margin:40px 0 0;">
  <span>무료 각인</span><span style="color:#ddd;">·</span><span>무료 선물포장</span><span style="color:#ddd;">·</span><span>주문당일 발송</span><span style="color:#ddd;">·</span><span>6개월 A/S</span>
</div>`);

  // ── SIZE → TryItOn ──
  parts.push(`
<div style="text-align:center;padding:64px 20px 80px;">
  ${eyebrow("SIZE", SUB)}
  ${head("내 손목엔 어떨까?")}
  ${body(c.sizeCopy || `케이스 ${esc(spec["케이스"] || c.caseSize || "")} — 부담 없는 데일리 사이즈.<br>바로 아래 <b style="color:${INK};">TRY IT ON</b>에서 내 손목 위 모습을 확인해 보세요.`)}
</div>`);

  parts.push(`</div>`);
  return parts.join("\n");
}

/**
 * 주얼리 상세 빌더 — 시계 템플릿과 톤 통일, 주얼리에 맞게 섹션 조정.
 * 제외: 무브먼트/방수/글라스 스펙, 각인 케이스백, SIZE→TryItOn, 스트랩 두무드, 팔찌 프로모.
 * 포함: 인트로(웜그레이) → 히어로 → DESIGN(제품 누끼) → THE DETAILS(디테일 매크로) →
 *       ON THE BODY(착용) → STYLING(레이어드, 선택) → GIFTING → SPEC(주얼리)
 */
function buildJewelryDetail(c) {
  const parts = [];
  parts.push(`<div class="pv-jewelry-detail" style="max-width:860px;margin:0 auto;font-family:${SANS};color:${BODY};">`);

  // 인트로 (웜그레이)
  parts.push(`
<div style="background:${PVGRAY};text-align:center;padding:72px 20px 64px;">
  <p style="font-family:${SERIF};font-size:13px;letter-spacing:.35em;color:#fff;margin:0 0 18px;">${esc(c.collectionEn)}</p>
  <h2 style="font-family:${SANS};font-size:29px;color:${INK};font-weight:700;letter-spacing:-.01em;line-height:1.45;margin:0 0 18px;word-break:keep-all;">${c.title}</h2>
  <p style="font-size:14.5px;line-height:1.9;margin:0;word-break:keep-all;color:#403b35;">${c.tagline}</p>
</div>`);

  // AS SEEN ON (셀럽 — 최상단 훅, 선택)
  if (c.celeb) {
    parts.push(`
<div style="background:${GREY};text-align:center;padding:56px 20px 48px;">
  <p style="font-family:${SERIF};font-size:13px;letter-spacing:.35em;color:${SUB};margin:0 0 14px;">AS SEEN ON</p>
  <h3 style="font-family:${SERIF};font-size:27px;letter-spacing:.16em;color:${INK};font-weight:400;margin:0 0 10px;">${esc(c.celeb.nameEn)}</h3>
  <p style="font-size:14px;color:${BODY};margin:0 0 30px;">${esc(c.celeb.caption)}</p>
  <img src="${c.celeb.image}" alt="${esc(c.celeb.nameEn)} 착용" style="width:100%;max-width:600px;display:block;margin:0 auto;">
  ${c.celeb.credit ? `<p style="font-family:${SERIF};font-size:11px;letter-spacing:.2em;color:#aaa;margin:16px 0 0;">${esc(c.celeb.credit)}</p>` : ""}
</div>`);
  }

  parts.push(img(c.images.hero, c.name + " 착용컷", 0));

  parts.push(`<div style="padding:70px 0 0;">${sectionHead("DESIGN", c.designTitle || "디자인", c.designCopy)}</div>`);
  parts.push(img(c.images.design, c.name + " 제품컷", 0));

  if (c.images.details && c.images.details.length) {
    parts.push(`<div style="padding:70px 0 0;">${sectionHead("THE DETAILS", c.detailTitle || "가까이 볼수록", c.detailCopy)}</div>`);
    c.images.details.forEach((u, i) => parts.push(img(u, `${c.name} 디테일 ${i + 1}`, i === c.images.details.length - 1 ? 0 : 12)));
  }

  if (c.images.wear && c.images.wear.length) {
    parts.push(`<div style="padding:70px 0 0;">${sectionHead(c.wearEyebrow || "ON THE BODY", c.wearTitle || "몸 위에서", c.wearCopy)}</div>`);
    c.images.wear.forEach((u, i) => parts.push(img(u, `${c.name} 착용컷 ${i + 1}`, i === c.images.wear.length - 1 ? 0 : 12)));
  }

  // STYLING (레이어드/시계 매치, 선택)
  if (c.styling) {
    parts.push(`
<div style="background:${GREY};text-align:center;padding:56px 20px;margin:70px 0 0;">
  ${eyebrow("STYLING", SUB)}
  ${head(c.styling.title || "함께 스타일링")}
  ${body(c.styling.copy)}
  ${c.styling.image ? `<img src="${c.styling.image}" alt="스타일링" style="width:100%;max-width:600px;display:block;margin:28px auto 0;">` : ""}
</div>`);
  }

  // MOVING LOOK (착용 영상, 선택)
  if (c.video) {
    parts.push(`
<div style="background:#000;text-align:center;padding:56px 20px 60px;margin:70px 0 0;">
  <p style="font-family:${SANS};font-weight:600;font-size:11.5px;letter-spacing:.32em;color:${PVGRAY};margin:0 0 12px;">MOVING LOOK</p>
  <h3 style="font-family:${SANS};font-size:24px;color:#fff;font-weight:600;letter-spacing:-.01em;margin:0 0 26px;">움직이는 손목 위에서</h3>
  <video src="${c.video}" muted loop autoplay playsinline controls${c.videoPoster ? ` poster="${c.videoPoster}"` : ""} style="width:100%;max-width:300px;border-radius:8px;margin:0 auto;display:block;"></video>
</div>`);
  }

  // GIFTING
  parts.push(`<div style="padding:70px 0 0;">${sectionHead("GIFTING", "선물이라면, 더 완벽하게", `폴바이스 기프트 패키지에 담아 보내드립니다.`)}</div>`);
  if (c.images.gifting) parts.push(img(c.images.gifting, "기프트 패키지", 0));

  // SPEC (주얼리)
  const spec = c.spec || {};
  parts.push(`
<div style="padding:60px 20px 0;">
  <p style="font-family:${SERIF};font-size:12px;letter-spacing:.3em;color:${SUB};text-align:center;margin:0 0 24px;">SPECIFICATION</p>
  <table style="width:100%;border-collapse:collapse;font-size:13.5px;color:${BODY};">
    ${Object.entries(spec).map(([k, v]) => `<tr style="border-top:1px solid #eee;"><td style="padding:11px 8px;color:${SUB};width:110px;">${esc(k)}</td><td style="padding:11px 8px;">${esc(v)}</td></tr>`).join("\n    ")}
    <tr style="border-top:1px solid #eee;border-bottom:1px solid #eee;"><td style="padding:11px 8px;color:${SUB};">보증</td><td style="padding:11px 8px;">폴바이스 공식 A/S</td></tr>
  </table>
</div>`);

  parts.push(`
<div style="display:flex;justify-content:center;gap:12px;font-size:12.5px;color:#888;border-top:1px solid #eee;border-bottom:1px solid #eee;padding:16px 0;margin:40px 0 80px;">
  <span>무료 선물포장</span><span style="color:#ddd;">·</span><span>주문당일 발송</span><span style="color:#ddd;">·</span><span>정품 보증</span>
</div>`);

  parts.push(`</div>`);
  return parts.join("\n");
}

module.exports = { buildWatchDetail, buildJewelryDetail };

/* config 예시 (에끌라 오벌 골드 195):
{
  collectionEn: "ECLAT OVAL · GOLD",
  title: "부드러운 곡선의 오벌,<br>에끌라 골드",
  name: "에끌라 오벌 워치 골드",
  tagline: "…",
  designCopy: "…",
  images: { hero, design, detail, wear:[...], moodA, moodB, engraving, gifting },
  braceletPromo: { copy, image } | null,
  celeb: { nameEn, caption, image, credit } | null,
  spec: { "케이스":"32 × 22 mm", "두께":"7 mm", ... },
}
*/
