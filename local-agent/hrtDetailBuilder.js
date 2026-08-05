/**
 * 해리엇 시계 상세페이지 빌더
 * — 폴바이스 pvDetailBuilder와 동일 철학: 브랜드 템플릿 1개 + 상품별 config(이미지·텍스트)만 교체.
 *
 * 기존 해리엇 상세(_gwangan_blackrose_detail.html)의 골격을 섹션 렌더러로 분해한 것.
 *   hero / opening / story / narrative / sequence / features / spec / gallery / engrave / closing
 *
 * 설월(雪月)은 액센트를 골드(#b08d57) 대신 **네이비/실버**로 씁니다.
 *   근거: 패키지 사양 v1.0 — 설월은 해리엇 B&W 원칙의 의도적 예외(네이비 허용).
 *   다른 해리엇 상품은 config.theme 생략 시 기존 골드 유지.
 *
 * 사용:
 *   const { buildHarriotDetail } = require("./hrtDetailBuilder");
 *   const html = buildHarriotDetail(require("./seolwolDetailConfig"));
 *   node hrtDetailBuilder.js seolwol        # 국문 상세 → downloads/seolwol-detail/
 *   node hrtDetailBuilder.js seolwolEn      # 영문몰(shop2). config.lang='en' 이면 세리프·줄바꿈 전환
 */

const THEMES = {
  gold:    { accent: "#b08d57", accentSoft: "#8a7a5c", accentLight: "#c9a978", paper: "#f7f5f1", ink: "#121212", line: "#e3ddd2" },
  seolwol: { accent: "#2c3c63", accentSoft: "#5a6a8c", accentLight: "#93a6cc", paper: "#f4f6f9", ink: "#0f1626", line: "#dde3ec" },
};

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** 이미지 or 촬영 대기 플레이스홀더. src 없으면 컷번호·설명이 박힌 점선 박스를 그린다. */
function media(m) {
  if (!m) return "";
  if (typeof m === "string") m = { src: m };
  if (m.src) return `<img src="${m.src}" alt="${esc(m.alt || "")}">`;
  return `<div class="ph" style="aspect-ratio:${m.ratio || "4/3"};">
    <span class="phn">CUT ${esc(m.cut || "—")}</span>
    <span class="pht">${esc(m.alt || "촬영 대기")}</span>
  </div>`;
}

const cap = (t) => (t ? `<p class="mcap">${esc(t)}</p>` : "");
const paras = (arr) => (arr || []).map((p) => `<p>${p}</p>`).join("");

// ───────────────────────── 섹션 렌더러 ─────────────────────────

const SECTIONS = {
  /** ① 히어로 — 제품명·히어로라인·가격·예약 배지 */
  hero: (s) => `
<section class="hero">
  ${s.eyebrow ? `<p class="eyebrow">${esc(s.eyebrow)}</p>` : ""}
  <h1>${esc(s.title)}</h1>
  <p class="en">${esc(s.titleEn)}</p>
  <div class="heroimg">${media(s.image)}</div>
  ${s.line ? `<p class="heroline">${s.line}</p>` : ""}
  <p class="price">${esc(s.priceNote || "")}<b>${esc(s.price)}</b></p>
  ${s.badge ? `<p class="badge">${s.badge}</p>` : ""}
</section>`,

  /** ② 오프닝 — 경건 2줄 */
  opening: (s) => `
<section class="opening">
  <p>${s.text}</p>
  ${s.sub ? `<p class="sub">${s.sub}</p>` : ""}
</section>`,

  /** ③ 스토리 — 서사 본문 + 대형 이미지 */
  story: (s) => `
<section class="sec story">
  ${s.eyebrow ? `<p class="eyebrow">${esc(s.eyebrow)}</p>` : ""}
  <p class="h2 serif">${s.head}</p>
  <div class="rule"></div>
  ${paras(s.body)}
  ${s.image ? `<div class="pimg">${media(s.image)}${cap(s.imageCap)}</div>` : ""}
</section>`,

  /** ④⑤⑥⑨⑪ 범용 서사 섹션 — 밝은/어두운 배경 선택 + 이미지 하단 배치 */
  narrative: (s) => `
<section class="sec narrative ${s.dark ? "dark" : ""}">
  <div class="nwrap">
    ${s.eyebrow ? `<p class="eyebrow">${esc(s.eyebrow)}</p>` : ""}
    <p class="h2 serif">${s.head}</p>
    <div class="rule"></div>
    ${paras(s.body)}
    ${s.note ? `<p class="note">${s.note}</p>` : ""}
  </div>
  ${s.image ? `<div class="nimg">${media(s.image)}${cap(s.imageCap)}</div>` : ""}
</section>`,

  /** 시퀀스 — 3~5컷 가로 나열(모바일 1열). 문페이즈 시퀀스·언박싱용 */
  sequence: (s) => `
<section class="sec seq ${s.dark ? "dark" : ""}">
  <div class="nwrap">
    ${s.eyebrow ? `<p class="eyebrow">${esc(s.eyebrow)}</p>` : ""}
    ${s.head ? `<p class="h2 serif">${s.head}</p>` : ""}
    ${s.body ? `<div class="rule"></div>${paras(s.body)}` : ""}
  </div>
  <div class="seqgrid cols${(s.items || []).length}">
    ${(s.items || []).map((it, i) => `
    <figure>
      ${media(it.image)}
      <figcaption><b>${String(i + 1).padStart(2, "0")}</b> ${it.caption}</figcaption>
    </figure>`).join("")}
  </div>
</section>`,

  /** 영감 — "이것이 시계의 이것이 되었다" 2단 대응(무드 ↔ 제품). 모바일 세로 스택 */
  origin: (s) => `
<section class="sec origin ${s.dark ? "dark" : ""}">
  <div class="nwrap">
    ${s.eyebrow ? `<p class="eyebrow">${esc(s.eyebrow)}</p>` : ""}
    <p class="h2 serif">${s.head}</p>
    <div class="rule"></div>
    ${paras(s.body)}
  </div>
  ${(s.pairs || []).map((p, i) => `
  <div class="pair">
    <div class="pn">${String(i + 1).padStart(2, "0")}</div>
    <div class="pgrid">
      <figure>${media(p.from)}<figcaption>${p.fromCap}</figcaption></figure>
      <div class="arrow">→</div>
      <figure>${media(p.to)}<figcaption>${p.toCap}</figcaption></figure>
    </div>
    <p class="ptext">${p.text}</p>
  </div>`).join("")}
</section>`,

  /** 풀블리드 무드 브레이크 — 이미지 위에 한 줄만 */
  full: (s) => `
<section class="fullbleed">
  ${media(s.image)}
  ${s.line ? `<div class="fbline"><p>${s.line}</p></div>` : ""}
  ${s.caption ? `<p class="fbcap">${esc(s.caption)}</p>` : ""}
</section>`,

  /** 특징 그리드 2×N */
  features: (s) => `
<section class="sec design">
  <div class="head">
    ${s.eyebrow ? `<p class="eyebrow">${esc(s.eyebrow)}</p>` : ""}
    <p class="h2 serif">${s.head}</p>
  </div>
  ${s.intro ? `<p class="intro">${s.intro}</p>` : ""}
  ${s.image ? `<div class="dialimg">${media(s.image)}${cap(s.imageCap)}</div>` : ""}
  <div class="features">
    ${(s.items || []).map((f, i) => `
    <div class="feat">
      <div class="n">${String(i + 1).padStart(2, "0")}</div>
      <div class="t">${esc(f.title)}</div>
      <div class="d">${f.desc}</div>
    </div>`).join("")}
  </div>
</section>`,

  /** 갤러리 — 착용컷 풀폭 나열 */
  gallery: (s) => `
<section class="life">
  <div class="cap">
    ${s.eyebrow ? `<p class="eyebrow">${esc(s.eyebrow)}</p>` : ""}
    <p class="h2 serif">${s.head}</p>
    ${s.body ? `<p class="gbody">${s.body}</p>` : ""}
  </div>
  <div class="grid">${(s.images || []).map(media).join("")}</div>
</section>`,

  /** 스펙 표 — value 없으면 '확인 중' 회색 처리 */
  spec: (s) => `
<section class="sec spec">
  <div class="head">
    ${s.eyebrow ? `<p class="eyebrow">${esc(s.eyebrow)}</p>` : ""}
    <p class="h2 serif">${s.head}</p>
  </div>
  <div class="spectable">
    ${(s.rows || []).map(([k, v]) => `
    <div class="row"><div class="k">${esc(k)}</div><div class="v${v ? "" : " tbd"}">${v ? v : (s.tbd || "확인 중")}</div></div>`).join("")}
  </div>
  ${s.note ? `<p class="specnote">${s.note}</p>` : ""}
</section>`,

  /** 각인 */
  engrave: (s) => `
<section class="sec engrave">
  ${s.eyebrow ? `<p class="eyebrow">${esc(s.eyebrow)}</p>` : ""}
  <p class="h2 serif">${s.head}</p>
  <p class="lead">${s.lead}</p>
  <div class="eximg">${media(s.image)}</div>
  ${s.imageCap ? `<p class="excap">${esc(s.imageCap)}</p>` : ""}
  ${s.free ? `<p class="freetag">${s.free}</p>` : ""}
  <p class="note">${(s.notes || []).map((n) => `· ${n}`).join("<br>")}</p>
</section>`,

  /** ⑬ 클로징 */
  closing: (s) => `
<section class="closing">
  ${s.eyebrow ? `<p class="eyebrow">${esc(s.eyebrow)}</p>` : ""}
  <p class="h2 serif">${s.head}</p>
  ${s.body ? `<p>${s.body}</p>` : ""}
  <p class="slogan">${s.slogan}<small>${esc(s.sloganSub || "Harriot")}</small></p>
</section>`,
};

// ───────────────────────── 스타일 ─────────────────────────

function styles(t, lang) {
  const en = lang === "en";
  // 영문은 한글 세리프(Noto Serif KR)로 조판하면 헤리티지 톤이 죽는다 — 개러몬드 계열로 교체.
  const IMPORT = en
    ? "@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;500&family=Inter:wght@300;400;500;600&display=swap');"
    : "@import url('https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@200;300;500;700&family=Noto+Sans+KR:wght@300;400;500;700&display=swap');";
  const SANS = en ? "'Inter',-apple-system,'Helvetica Neue',sans-serif" : "'Noto Sans KR',sans-serif";
  const SERIF = en ? "'Cormorant Garamond',Georgia,serif" : "${SERIF}";
  const BREAK = en ? "normal" : "keep-all";
  return `${IMPORT}
#hrt-detail{font-family:${SANS};color:#2a2a2a;line-height:1.95;-webkit-font-smoothing:antialiased;max-width:1000px;margin:0 auto;font-size:16px;word-break:${BREAK};}
#hrt-detail *{box-sizing:border-box;margin:0;padding:0;}
#hrt-detail img{display:block;width:100%;height:auto;}
#hrt-detail .serif{font-family:${SERIF};}
#hrt-detail .eyebrow{font-family:${SERIF};font-size:13px;letter-spacing:.42em;color:${t.accent};text-transform:uppercase;font-weight:500;margin-bottom:20px;}
/* 어두운 배경 위 eyebrow는 액센트가 묻히므로 밝은 톤으로 */
#hrt-detail .hero .eyebrow,#hrt-detail .opening .eyebrow,#hrt-detail .closing .eyebrow,
#hrt-detail .life .eyebrow,#hrt-detail .dark .eyebrow{color:${t.accentLight};}
#hrt-detail .sec{padding:100px 40px;}
#hrt-detail .h2{font-family:${SERIF};font-weight:500;font-size:30px;line-height:1.55;letter-spacing:-.01em;}
#hrt-detail .rule{width:40px;height:1px;background:${t.accent};margin:24px 0;}
#hrt-detail .mcap{font-size:12px;color:#9aa0aa;letter-spacing:.02em;margin-top:10px;text-align:center;}

/* 촬영 대기 플레이스홀더 */
#hrt-detail .ph{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;border:1px dashed ${t.accentSoft};background:repeating-linear-gradient(45deg,rgba(0,0,0,.015) 0 12px,transparent 12px 24px);color:${t.accentSoft};width:100%;}
#hrt-detail .ph .phn{font-family:${SERIF};font-size:12px;letter-spacing:.3em;opacity:.8;}
#hrt-detail .ph .pht{font-size:13px;font-weight:300;padding:0 24px;text-align:center;line-height:1.7;}
#hrt-detail .dark .ph{border-color:rgba(255,255,255,.28);color:rgba(255,255,255,.55);background:repeating-linear-gradient(45deg,rgba(255,255,255,.03) 0 12px,transparent 12px 24px);}

/* ① 히어로 */
#hrt-detail .hero{background:${t.ink};color:#fff;text-align:center;padding:82px 40px 92px;}
#hrt-detail .hero h1{font-family:${SERIF};font-weight:300;font-size:42px;letter-spacing:.02em;margin-bottom:10px;}
#hrt-detail .hero .en{font-size:13px;letter-spacing:.36em;color:#8c93a3;text-transform:uppercase;margin-bottom:50px;}
#hrt-detail .hero .heroimg{max-width:760px;margin:0 auto;}
#hrt-detail .hero .heroline{font-family:${SERIF};font-weight:200;font-size:26px;line-height:1.85;color:#eef1f6;margin-top:52px;}
#hrt-detail .hero .price{margin-top:44px;font-size:15px;letter-spacing:.04em;color:#b9c0cd;}
#hrt-detail .hero .price b{display:block;color:#fff;font-weight:500;font-size:23px;letter-spacing:0;margin-top:8px;}
#hrt-detail .hero .badge{margin-top:30px;display:inline-block;border:1px solid rgba(255,255,255,.3);border-radius:2px;padding:11px 22px;font-size:13px;font-weight:300;color:#dfe4ee;letter-spacing:.02em;line-height:1.8;}

/* ② 오프닝 */
#hrt-detail .opening{background:#141a26;color:#eee;text-align:center;padding:96px 40px;}
#hrt-detail .opening p{font-family:${SERIF};font-weight:200;font-size:23px;line-height:2;color:#e7ebf2;}
#hrt-detail .opening .sub{font-family:${SANS};font-size:15px;font-weight:300;color:#8f96a4;margin-top:26px;letter-spacing:.02em;}

/* ③ 스토리 */
#hrt-detail .story{background:${t.paper};text-align:center;}
#hrt-detail .story .rule{margin:30px auto;}
#hrt-detail .story p{font-size:16px;font-weight:300;color:#4a4a4a;max-width:640px;margin:0 auto 20px;line-height:2.05;}
#hrt-detail .story .h2{margin-bottom:0;}
#hrt-detail .story .pimg{max-width:700px;margin:56px auto 0;}

/* 범용 서사 */
#hrt-detail .narrative{background:#fff;text-align:center;}
#hrt-detail .narrative.dark{background:${t.ink};color:#e9edf4;}
#hrt-detail .narrative .nwrap{max-width:640px;margin:0 auto;}
#hrt-detail .narrative .rule{margin:26px auto;}
#hrt-detail .narrative p{font-size:16px;font-weight:300;color:#4a4a4a;margin:0 auto 18px;line-height:2.05;}
#hrt-detail .narrative.dark .h2{color:#fff;font-weight:300;}
#hrt-detail .narrative.dark p{color:#c3cad6;}
#hrt-detail .narrative .note{font-size:13.5px;color:#9aa0aa;margin-top:26px;}
#hrt-detail .narrative .nimg{max-width:820px;margin:56px auto 0;}

/* 시퀀스 */
#hrt-detail .seq{background:${t.paper};text-align:center;}
#hrt-detail .seq.dark{background:${t.ink};color:#e9edf4;}
#hrt-detail .seq.dark .h2{color:#fff;font-weight:300;}
#hrt-detail .seq .nwrap{max-width:640px;margin:0 auto;}
#hrt-detail .seq .rule{margin:26px auto;}
#hrt-detail .seq p{font-size:16px;font-weight:300;color:#4a4a4a;margin:0 auto 18px;line-height:2.05;}
#hrt-detail .seq.dark p{color:#c3cad6;}
#hrt-detail .seqgrid{display:grid;gap:14px;margin-top:52px;}
#hrt-detail .seqgrid.cols2{grid-template-columns:repeat(2,1fr);}
#hrt-detail .seqgrid.cols3{grid-template-columns:repeat(3,1fr);}
#hrt-detail .seqgrid.cols4{grid-template-columns:repeat(2,1fr);}
#hrt-detail .seqgrid.cols5{grid-template-columns:repeat(5,1fr);}
#hrt-detail .seqgrid figcaption{font-size:13px;font-weight:300;color:#6b7280;margin-top:12px;line-height:1.75;text-align:center;}
#hrt-detail .seq.dark .seqgrid figcaption{color:#9aa4b5;}
#hrt-detail .seqgrid figcaption b{font-family:${SERIF};color:${t.accent};font-weight:500;letter-spacing:.1em;margin-right:6px;}
#hrt-detail .seq.dark .seqgrid figcaption b{color:#9fb0d6;}

/* 영감 (origin) */
#hrt-detail .origin{background:#fff;text-align:center;}
#hrt-detail .origin.dark{background:${t.ink};color:#e9edf4;}
#hrt-detail .origin .nwrap{max-width:640px;margin:0 auto;}
#hrt-detail .origin .rule{margin:26px auto;}
#hrt-detail .origin p{font-size:16px;font-weight:300;color:#4a4a4a;margin:0 auto 18px;line-height:2.05;}
#hrt-detail .origin.dark .h2{color:#fff;font-weight:300;}
#hrt-detail .origin.dark p{color:#c3cad6;}
#hrt-detail .origin .pair{max-width:820px;margin:62px auto 0;}
#hrt-detail .origin .pn{font-family:${SERIF};font-size:12px;letter-spacing:.3em;color:${t.accent};margin-bottom:16px;}
#hrt-detail .origin.dark .pn{color:${t.accentLight};}
#hrt-detail .origin .pgrid{display:grid;grid-template-columns:1fr 44px 1fr;align-items:center;gap:0;}
#hrt-detail .origin .pgrid .arrow{font-size:17px;color:${t.accentSoft};font-weight:300;}
#hrt-detail .origin .pgrid figcaption{font-size:12.5px;font-weight:300;color:#8a919d;margin-top:11px;letter-spacing:.02em;}
#hrt-detail .origin .ptext{font-size:15.5px;font-weight:300;color:#4a4a4a;max-width:560px;margin:26px auto 0;line-height:2.05;}
#hrt-detail .origin.dark .ptext{color:#c3cad6;}

/* 풀블리드 무드 브레이크 */
#hrt-detail .fullbleed{position:relative;background:#0b0f18;line-height:0;}
#hrt-detail .fullbleed .fbline{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:40px;}
#hrt-detail .fullbleed .fbline p{font-family:${SERIF};font-weight:200;font-size:27px;line-height:1.9;color:#fff;text-align:center;text-shadow:0 2px 24px rgba(0,0,0,.65);letter-spacing:.01em;}
#hrt-detail .fullbleed .fbcap{line-height:1.8;font-size:12px;color:#7b8494;text-align:center;padding:14px 20px 0;background:${t.ink};margin:0;}

/* 특징 그리드 */
#hrt-detail .design{background:#fff;}
#hrt-detail .design .head{text-align:center;margin-bottom:18px;}
#hrt-detail .design .intro{text-align:center;font-size:16px;font-weight:300;color:#555;max-width:620px;margin:0 auto 54px;line-height:2.05;}
#hrt-detail .design .dialimg{max-width:860px;margin:0 auto 60px;}
#hrt-detail .features{display:flex;flex-wrap:wrap;border-top:1px solid #ececec;}
#hrt-detail .feat{flex:1 1 50%;padding:34px 30px;border-bottom:1px solid #ececec;}
#hrt-detail .feat:nth-child(odd){border-right:1px solid #ececec;}
#hrt-detail .feat .n{font-family:${SERIF};color:${t.accent};font-size:13px;letter-spacing:.2em;}
#hrt-detail .feat .t{font-weight:500;font-size:18px;margin:8px 0 6px;}
#hrt-detail .feat .d{font-size:14px;color:#777;font-weight:300;line-height:1.8;}

/* 갤러리 */
#hrt-detail .life{background:${t.ink};color:#fff;padding:0;}
#hrt-detail .life .cap{text-align:center;padding:88px 40px 62px;}
#hrt-detail .life .cap .h2{color:#fff;font-weight:300;}
#hrt-detail .life .gbody{font-size:15px;font-weight:300;color:#aeb6c4;max-width:560px;margin:22px auto 0;line-height:2;}
#hrt-detail .life .grid{padding:0 0 4px;}
#hrt-detail .life .grid img+img,#hrt-detail .life .grid .ph+.ph{margin-top:4px;}

/* 스펙 */
#hrt-detail .spec{background:${t.paper};}
#hrt-detail .spec .head{text-align:center;margin-bottom:46px;}
#hrt-detail .spectable{max-width:620px;margin:0 auto;}
#hrt-detail .spectable .row{display:flex;border-bottom:1px solid ${t.line};padding:15px 4px;font-size:15px;}
#hrt-detail .spectable .row .k{width:170px;color:${t.accentSoft};font-weight:500;flex-shrink:0;}
#hrt-detail .spectable .row .v{color:#333;}
#hrt-detail .spectable .row .v.tbd{color:#b9bfc9;font-style:italic;}
#hrt-detail .specnote{max-width:620px;margin:28px auto 0;font-size:13.5px;font-weight:300;color:#8a919d;line-height:1.9;text-align:center;}

/* 각인 */
#hrt-detail .engrave{background:#fff;text-align:center;}
#hrt-detail .engrave .h2{margin-bottom:18px;}
#hrt-detail .engrave .lead{font-size:16px;font-weight:300;color:#555;max-width:600px;margin:0 auto 46px;line-height:2.05;}
#hrt-detail .engrave .eximg{max-width:440px;margin:0 auto 16px;border-radius:4px;overflow:hidden;}
#hrt-detail .engrave .excap{font-size:13px;color:${t.accent};letter-spacing:.04em;margin-bottom:30px;}
#hrt-detail .engrave .freetag{display:inline-block;border:1px solid ${t.accent};color:${t.accent};font-size:14px;letter-spacing:.02em;padding:10px 22px;margin-bottom:34px;}
#hrt-detail .engrave .note{font-size:13px;color:#999;font-weight:300;line-height:1.95;max-width:560px;margin:0 auto;}
#hrt-detail .engrave .note b{color:${t.accentSoft};font-weight:500;}

/* 클로징 */
#hrt-detail .closing{background:#141a26;color:#eee;text-align:center;padding:104px 40px;}
#hrt-detail .closing .h2{color:#fff;font-weight:200;margin-bottom:24px;}
#hrt-detail .closing p{font-size:16px;font-weight:300;color:#b6bdc9;max-width:600px;margin:0 auto;line-height:2.05;}
#hrt-detail .closing .slogan{margin-top:44px;font-family:${SERIF};letter-spacing:.12em;font-size:20px;color:#e7ebf2;}
#hrt-detail .closing .slogan small{display:block;font-family:${SANS};font-size:11px;letter-spacing:.34em;color:#7d838f;margin-top:10px;text-transform:uppercase;}

${en ? `
#hrt-detail .h2{font-size:34px;font-weight:400;letter-spacing:0;line-height:1.4;}
#hrt-detail .hero h1{font-size:52px;font-weight:300;letter-spacing:.04em;}
#hrt-detail .hero .heroline{font-size:29px;font-weight:300;}
#hrt-detail .opening p{font-size:26px;}
#hrt-detail .closing .slogan{font-size:23px;}
#hrt-detail .eyebrow{font-size:11.5px;letter-spacing:.36em;}
` : ""}
@media (max-width:768px){
  #hrt-detail{font-size:15px;}
  #hrt-detail .sec,#hrt-detail .opening,#hrt-detail .closing{padding:64px 22px;}
  #hrt-detail .hero{padding:56px 22px 64px;}
  #hrt-detail .hero h1{font-size:32px;}
  #hrt-detail .hero .heroline{font-size:21px;margin-top:40px;}
  #hrt-detail .h2{font-size:24px;}
  #hrt-detail .opening p{font-size:19px;}
  #hrt-detail .feat{flex:1 1 100%;border-right:none!important;}
  #hrt-detail .spectable .row .k{width:120px;}
  #hrt-detail .seqgrid{grid-template-columns:1fr!important;gap:34px;}
  #hrt-detail .life .cap{padding:64px 22px 44px;}
  #hrt-detail .origin .pgrid{grid-template-columns:1fr;gap:8px;}
  #hrt-detail .origin .pgrid .arrow{transform:rotate(90deg);margin:6px auto;}
  #hrt-detail .origin .pair{margin-top:48px;}
  #hrt-detail .fullbleed .fbline p{font-size:20px;}
  ${en ? `
  /* Garamond 는 x-height 가 낮아 같은 px 에서 한글보다 작아 보인다 — 모바일에서 한 단 올린다 */
  #hrt-detail .h2{font-size:28px;}
  #hrt-detail .hero h1{font-size:40px;}
  #hrt-detail .hero .heroline{font-size:22px;}
  #hrt-detail .opening p{font-size:21px;}
  #hrt-detail .closing .slogan{font-size:20px;}
  ` : ""}
}`;
}

// ───────────────────────── 빌드 ─────────────────────────

function buildHarriotDetail(config) {
  const t = THEMES[config.theme || "gold"] || THEMES.gold;
  const body = (config.sections || [])
    .map((s) => {
      const fn = SECTIONS[s.type];
      if (!fn) throw new Error(`알 수 없는 섹션 타입: ${s.type}`);
      return fn(s);
    })
    .join("\n");
  return `<div id="hrt-detail"><style>${styles(t, config.lang)}</style>\n${body}\n</div>`;
}

module.exports = { buildHarriotDetail, SECTIONS, THEMES };

if (require.main === module) {
  const fs = require("fs");
  const path = require("path");
  const which = process.argv[2] || "seolwol";
  const config = require(`./${which}DetailConfig`);
  const html = buildHarriotDetail(config);

  // 영문판은 국문과 같은 폴더로 — config 의 world/ 상대경로가 그대로 살아야 한다
  const outDir = path.join(__dirname, "..", "downloads", config.outDir || `${which}-detail`);
  fs.mkdirSync(outDir, { recursive: true });

  const base = config.fileBase || `${which}-detail-ko`;
  const inner = path.join(outDir, `${base}.html`);
  fs.writeFileSync(inner, html); // 카페24 상세설명에 그대로 붙여넣는 조각

  const preview = path.join(outDir, `${base.replace(/-detail(-ko)?$/, "")}-preview.html`);
  fs.writeFileSync(
    preview,
    `<!doctype html><html lang="${config.lang === "en" ? "en" : "ko"}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${config.previewTitle || which} 상세 미리보기</title>
<style>body{margin:0;background:#e8eaee;}</style></head><body>${html}</body></html>`
  );

  const n = (config.sections || []).length;
  const phs = (html.match(/class="ph"/g) || []).length;
  console.log(`✓ ${n}개 섹션 · 촬영 대기 ${phs}컷`);
  console.log(`  상세조각(카페24 붙여넣기): ${inner}`);
  console.log(`  미리보기:                  ${preview}`);
}
