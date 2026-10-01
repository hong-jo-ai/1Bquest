/**
 * HARRIOT JOURNAL 빌더
 *
 *   node harriot-journal/build.js            → dist/ 에 전체 생성
 *   node harriot-journal/build.js --deploy   → 생성 후 카페24 SFTP 업로드
 *
 * 글은 articles/<slug>.js 에 **데이터로** 쓰고, HTML 은 여기서 찍는다.
 * 손으로 HTML 을 만지지 말 것 — 고칠 게 있으면 이 파일이나 article 데이터를 고친다.
 *
 * ⚠️ URL 규칙: 카페24는 2단계 하위폴더의 index.html 을 자동 매핑하지 않는다
 *    (/journal/kari-757/ → 404, /journal/kari-757.html → 200. 2026-09-02 실측).
 *    그래서 글은 /journal/<slug>.html 로 배포한다. 목록만 /journal/ (= journal/index.html).
 *
 * ⚠️ 카페24가 <title> 을 상점 공통값으로 덮어쓴다 → 각 페이지가 JS 로 되돌린다.
 *    canonical 은 카페24가 경로 기준으로 자동 생성하므로 여기서 넣지 않는다.
 */
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const DIST = path.join(ROOT, "dist");
const ORIGIN_BY_LANG = { ko: "https://harriotwatches.co.kr", en: "https://harriotwatches.com" };
let ORIGIN = ORIGIN_BY_LANG.ko;   // 빌드 중 언어별로 전환된다

/* ── 유틸 ──────────────────────────────────────────────────────────────── */
const esc = (s) =>
  String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const jstr = (s) => JSON.stringify(String(s == null ? "" : s));

function krDate(iso, lang) {
  const [y, m, d] = String(iso).split("-");
  if (!d) return iso;
  if (lang === "en") {
    const M = ["January","February","March","April","May","June",
               "July","August","September","October","November","December"];
    return `${M[+m - 1]} ${+d}, ${y}`;
  }
  return `${y}년 ${+m}월 ${+d}일`;
}

/** 본문 글자수 → 분량. 한글 500자/분, 영문 1000자(≈200단어)/분 */
function readMins(a) {
  const chars = (a.blocks || [])
    .map((b) => b.text || (b.rows || []).map((r) => r.join("")).join("") || "")
    .join("").replace(/\s/g, "").length;
  return Math.max(1, Math.round(chars / (a.lang === "en" ? 1000 : 500)));
}

const T = (lang) => lang === "en"
  ? { journal:"Journal", home:"Home", brand:"Brand", collection:"Collection", shop:"Shop", collectionHref:"/category/collection/43/",
      mins:(n)=>`${n} min read`, archive:"From the magazine",
      archiveNote:"Earlier pieces from our magazine. We are moving them here one by one.",
      tagline:"HARRIOT — Watches that remember Korea",
      mastDek:"Notes from making watches in Korea" }
  : { journal:"Journal", home:"홈", brand:"브랜드", collection:"컬렉션", shop:"쇼핑", collectionHref:"/category/collection/43/",
      mins:(n)=>`${n}분 분량`, archive:"매거진 아카이브",
      archiveNote:"이전에 매거진에 올린 글입니다. 순차적으로 이곳으로 옮기고 있습니다.",
      tagline:"HARRIOT — 대한민국을 기억하는 시계",
      mastDek:"한국에서 시계를 만들며 남긴 기록" };

/* ── 공통 CSS ──────────────────────────────────────────────────────────── */
const FONTS = `<link rel="stylesheet" as="style" crossorigin
      href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@300;400;500&display=swap">`;

const SANS = `'Pretendard', -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic', sans-serif`;
const SERIF = `'Noto Serif KR', Georgia, serif`;

const BASE_CSS = `
.jr,.jr *,.jr *::before,.jr *::after{box-sizing:border-box}
.jr h1,.jr h2,.jr h3,.jr p,.jr figure,.jr blockquote,.jr ul,.jr ol,.jr dl,.jr dd,.jr li{margin:0;padding:0}
.jr img{display:block;width:100%;height:auto}
.jr li{list-style:none}
.jr{--ink:#111;--soft:#4a4a4a;--mute:#8e8e8e;--rule:#ebebeb;--wash:#f7f7f7;
  background:#fff;color:var(--ink);font-family:${SANS};font-weight:400;
  -webkit-font-smoothing:antialiased;overflow-x:hidden}
.jr__bar{display:flex;align-items:center;justify-content:space-between;padding:24px clamp(20px,4vw,48px)}
.jr__brand{display:block;width:116px}
.jr__nav{display:flex;gap:26px}
.jr__nav a{font-size:12px;font-weight:500;letter-spacing:.06em;color:var(--mute);text-decoration:none}
.jr__nav a:hover{color:var(--ink)}
.jr__foot{border-top:1px solid var(--rule);padding:32px clamp(20px,4vw,48px) 64px}
.jr__footIn{max-width:1240px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap}
.jr__footNav{display:flex;gap:26px;flex-wrap:wrap}
.jr__footNav a{font-size:12px;font-weight:500;letter-spacing:.06em;color:var(--mute);text-decoration:none}
.jr__footNav a:hover{color:var(--ink)}
.jr__footNote{font-size:12px;color:var(--mute)}
.jr__meta{display:flex;align-items:center;gap:7px;font-size:13px;color:var(--mute)}
.jr__meta svg{flex:none;width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:1.6}
`;

const CLOCK = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`;

/* ── 헤더 / 푸터 ───────────────────────────────────────────────────────── */
const header = (lang, onDark) => {
  const t = T(lang);
  const logo = onDark ? "harriot-logo-horizontal-white.png" : "harriot-logo-horizontal-black.png";
  return `<header class="jr__bar${onDark ? " -onDark" : ""}">
    <a class="jr__brand" href="/" aria-label="HARRIOT"><img src="/seolwol/${logo}" alt="HARRIOT 해리엇"></a>
    <nav class="jr__nav">
      <a href="/journal/">${t.journal}</a>
      <a href="${t.collectionHref}">${t.collection}</a>
      <a href="/">${t.shop}</a>
    </nav>
  </header>`;
};

const footer = (lang) => {
  const t = T(lang);
  return `<footer class="jr__foot"><div class="jr__footIn">
    <nav class="jr__footNav">
      <a href="/">${t.home}</a>
      <a href="/journal/">${t.journal}</a>
      <a href="/roma/sub/sub-01.html">${t.brand}</a>
      <a href="${t.collectionHref}">${t.collection}</a>
    </nav>
    <p class="jr__footNote">${t.tagline}</p>
  </div></footer>`;
};

/* ── 기사 블록 렌더 ────────────────────────────────────────────────────── */
function block(b) {
  switch (b.t) {
    case "lede": return `<div class="jr__wrap"><div class="jr__body"><p class="-lede">${esc(b.text)}</p></div></div>`;
    case "p":    return `<div class="jr__wrap"><div class="jr__body"><p>${b.html || esc(b.text)}</p></div></div>`;
    case "h2":   return `<div class="jr__wrap"><div class="jr__body"><h2>${esc(b.text)}</h2></div></div>`;
    case "h3":   return `<div class="jr__wrap"><div class="jr__body"><h3>${esc(b.text)}</h3></div></div>`;
    case "note": return `<div class="jr__wrap"><div class="jr__body"><p class="jr__note">${esc(b.text)}</p></div></div>`;
    case "end":  return `<div class="jr__wrap"><div class="jr__body"><p class="jr__end">■</p></div></div>`;
    case "quote":
      return `<div class="jr__wrap"><blockquote class="jr__pull"><p>${esc(b.text)}</p>` +
             (b.cite ? `<cite>${esc(b.cite)}</cite>` : "") + `</blockquote></div>`;
    case "img": {
      const w = b.w === "bleed" ? "jr__bleed" : b.w === "body" ? "jr__wrap" : "jr__wide";
      return `<div class="${w}"><figure><img src="${esc(b.src)}" alt="${esc(b.alt)}" loading="lazy">` +
             (b.cap ? `<figcaption>${esc(b.cap)}</figcaption>` : "") + `</figure></div>`;
    }
    case "duo":
      return `<div class="jr__wide"><div class="jr__duo">` + b.items.map((i) =>
        `<figure><img src="${esc(i.src)}" alt="${esc(i.alt)}" loading="lazy">` +
        (i.cap ? `<figcaption>${esc(i.cap)}</figcaption>` : "") + `</figure>`).join("") +
        `</div></div>`;
    case "spec":
      return `<div class="jr__wrap"><div class="jr__body"><dl class="jr__spec">` +
        b.rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("") +
        `</dl></div></div>`;
    default: return "";
  }
}

const ARTICLE_CSS = `
.jr__wrap{max-width:680px;margin:0 auto;padding:0 22px}
.jr__wide{max-width:1040px;margin:0 auto;padding:0 22px}
.jr__bleed{width:100%}
.jr__bar.-onDark{position:absolute;inset:0 0 auto;z-index:5}
.jr__bar.-onDark .jr__nav a{color:rgba(255,255,255,.8)}
.jr__bar.-onDark .jr__nav a:hover{color:#fff}
.jr__hero{position:relative;min-height:min(88svh,820px);display:flex;align-items:flex-end}
.jr__heroImg{position:absolute;inset:0}
.jr__heroImg img{width:100%;height:100%;object-fit:cover}
.jr__scrim{position:absolute;inset:0;background:linear-gradient(180deg,rgba(8,8,8,.44) 0%,rgba(8,8,8,.10) 32%,rgba(8,8,8,.80) 100%)}
.jr__heroBody{position:relative;z-index:2;width:100%;padding:0 0 clamp(48px,8vw,96px);color:#fff;text-align:center}
.jr__title{font-weight:700;font-size:clamp(30px,5.2vw,60px);line-height:1.22;letter-spacing:-.038em;word-break:keep-all;text-wrap:balance;color:#fff}
.jr__dek{margin:22px auto 0;max-width:560px;font-size:clamp(15px,1.6vw,17px);line-height:1.9;color:rgba(255,255,255,.84);word-break:keep-all}
.jr__hero .jr__meta{margin-top:26px;justify-content:center;color:rgba(255,255,255,.68)}
.jr__hero.-light{min-height:0;display:block}
.jr__hero.-light .jr__scrim{display:none}
.jr__hero.-light .jr__heroImg{position:static}
.jr__hero.-light .jr__bar{position:static}
.jr__hero.-light .jr__bar .jr__nav a{color:var(--mute)}
.jr__hero.-light .jr__heroBody{color:var(--ink);padding:clamp(40px,6vw,68px) 0 0}
.jr__hero.-light .jr__title{color:var(--ink)}
.jr__hero.-light .jr__dek{color:var(--soft)}
.jr__hero.-light .jr__meta{color:var(--mute)}
.jr__body{padding-top:0}
.jr__wrap+.jr__wrap .jr__body{padding-top:0}
.jr__body p{font-family:${SERIF};font-weight:300;font-size:17px;line-height:2.08;color:#1a1a1a;word-break:keep-all;margin-top:26px}
.jr__body p.-lede{font-size:18px;margin-top:clamp(48px,7vw,84px)}
.jr__body p.-lede::first-letter{float:left;font-size:4.4em;line-height:.86;font-weight:400;margin:.06em .12em 0 0}
.jr__body h2{font-weight:700;font-size:clamp(22px,3vw,29px);line-height:1.5;letter-spacing:-.03em;margin-top:clamp(52px,6vw,80px);word-break:keep-all}
.jr__body h3{font-weight:700;font-size:18px;letter-spacing:-.02em;margin-top:40px;word-break:keep-all}
.jr__body strong{font-weight:600}
.jr__body a{color:var(--ink);text-underline-offset:4px}
.jr__note{background:var(--wash);padding:18px 22px;font-family:${SANS} !important;font-size:13px !important;line-height:1.9 !important;color:var(--soft) !important;margin-top:34px}
.jr__end{margin-top:40px;font-size:13px;letter-spacing:.3em;color:var(--mute)}
.jr__pull{margin:clamp(48px,6vw,80px) auto;padding:32px 0;border-top:1px solid var(--ink);border-bottom:1px solid var(--ink);text-align:center}
.jr__pull p{font-family:${SERIF};font-size:clamp(20px,2.6vw,27px);font-weight:300;line-height:1.7;letter-spacing:-.03em;word-break:keep-all}
.jr__pull cite{display:block;margin-top:16px;font-style:normal;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--mute)}
.jr figure{margin:clamp(44px,5.5vw,72px) auto}
.jr figcaption{margin-top:13px;font-size:12px;line-height:1.8;color:var(--mute);word-break:keep-all}
.jr__wide figcaption,.jr__bleed figcaption{max-width:680px;margin-left:auto;margin-right:auto;padding:0 22px}
.jr__duo{display:grid;grid-template-columns:1fr 1fr;gap:clamp(10px,1.6vw,20px)}
.jr__duo figure{margin:0}
.jr__duo figcaption{padding:0}
.jr__spec{margin-top:32px;border-top:1px solid var(--rule)}
.jr__spec div{display:flex;gap:20px;padding:14px 0;border-bottom:1px solid var(--rule);font-size:15px;line-height:1.8;word-break:keep-all}
.jr__spec dt{flex:0 0 96px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--mute);padding-top:4px}
.jr__spec dd{flex:1;margin:0}
.jr__cta{margin-top:clamp(52px,7vw,84px);background:var(--wash);padding:clamp(28px,4vw,44px);display:flex;gap:clamp(20px,3vw,34px);align-items:center;flex-wrap:wrap;text-decoration:none;color:inherit}
.jr__cta img{width:150px;flex:none}
.jr__ctaBody{flex:1 1 240px;min-width:0}
.jr__ctaLabel{font-size:10px;letter-spacing:.26em;text-transform:uppercase;color:var(--mute)}
.jr__ctaName{font-size:21px;font-weight:700;margin-top:10px;letter-spacing:-.03em;word-break:keep-all}
.jr__ctaDesc{margin-top:8px;font-size:14px;color:var(--soft);line-height:1.75;word-break:keep-all}
.jr__ctaGo{margin-top:18px;display:inline-block;font-size:12px;letter-spacing:.1em;border-bottom:1px solid var(--ink);padding-bottom:5px}
@media(max-width:620px){.jr__duo{grid-template-columns:1fr}.jr__cta{flex-direction:column;align-items:flex-start}
.jr__body p.-lede::first-letter{font-size:3.6em}.jr__spec div{flex-direction:column;gap:4px}.jr__spec dt{flex:none}}
`;

/* ── 기사 페이지 ───────────────────────────────────────────────────────── */
function renderArticle(a) {
  const lang = a.lang || "ko";
  const t = T(lang);
  const url = `${ORIGIN}/journal/${a.slug}.html`;
  const mins = a.mins || readMins(a);
  const full = `${a.title}${a.titleSuffix ? " — " + a.titleSuffix : ""}`;

  const ld = {
    "@context": "https://schema.org", "@type": "Article",
    headline: full, description: a.description, image: [a.image],
    datePublished: a.date, dateModified: a.modified || a.date,
    inLanguage: lang, articleSection: a.category || "Heritage",
    ...(a.keywords ? { keywords: a.keywords } : {}),
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    author: { "@type": "Organization", name: "HARRIOT", url: ORIGIN + "/" },
    publisher: { "@type": "Organization", name: "HARRIOT", url: ORIGIN + "/",
      logo: { "@type": "ImageObject", url: `${ORIGIN}/roma/img/211830/og_default.png` } },
  };
  const crumbs = {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: t.home, item: ORIGIN + "/" },
      { "@type": "ListItem", position: 2, name: "JOURNAL", item: ORIGIN + "/journal/" },
      { "@type": "ListItem", position: 3, name: a.title },
    ],
  };

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5">
<!-- 자동 생성 — harriot-journal/build.js. 이 파일을 직접 고치지 말 것.
     원본 데이터 = harriot-journal/articles/${a.slug}.js -->
<script>
(function(){var t=${jstr(full + " | HARRIOT")};
function s(){if(document.title!==t)document.title=t}
s();document.addEventListener("DOMContentLoaded",s);window.addEventListener("load",s);})();
</script>
<title>${esc(full)}</title>
<meta name="description" content="${esc(a.description)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="HARRIOT">
<meta property="og:locale" content="${lang === "en" ? "en_US" : "ko_KR"}">
<meta property="og:title" content="${esc(full)}">
<meta property="og:description" content="${esc(a.ogDescription || a.description)}">
<meta property="og:image" content="${esc(a.image)}">
<meta property="og:url" content="${esc(url)}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.ico">
<script type="application/ld+json">${JSON.stringify(ld, null, 1)}</script>
<script type="application/ld+json">${JSON.stringify(crumbs, null, 1)}</script>
${FONTS}
<style>${BASE_CSS}${ARTICLE_CSS}</style>
</head>
<body>
<div class="jr">
<article>
  <section class="jr__hero${a.heroLight ? " -light" : ""}">
    <div class="jr__heroImg"><img src="${esc(a.hero || a.image)}" alt="${esc(a.heroAlt || a.alt)}" loading="eager"></div>
    <div class="jr__scrim"></div>
    ${header(lang, !a.heroLight)}
    <div class="jr__heroBody"><div class="jr__wrap">
      <h1 class="jr__title">${esc(a.title)}</h1>
      <p class="jr__dek">${esc(a.dek)}</p>
      <div class="jr__meta">${CLOCK}<span>${esc(krDate(a.date, lang))} · ${esc(t.mins(mins))}</span></div>
    </div></div>
  </section>
${(a.blocks || []).map(block).join("\n")}
${a.cta ? `  <div class="jr__wrap"><a class="jr__cta" href="${esc(a.cta.href)}">
    ${a.cta.img ? `<img src="${esc(a.cta.img)}" alt="${esc(a.cta.alt || "")}">` : ""}
    <div class="jr__ctaBody">
      <div class="jr__ctaLabel">${esc(a.cta.label)}</div>
      <div class="jr__ctaName">${esc(a.cta.name)}</div>
      <div class="jr__ctaDesc">${esc(a.cta.desc)}</div>
      <span class="jr__ctaGo">${esc(a.cta.go)}</span>
    </div></a></div>` : ""}
</article>
${footer(lang)}
</div>
</body>
</html>`;
}

/* ── 목록 페이지 ───────────────────────────────────────────────────────── */
const INDEX_CSS = `
.jr{min-height:100svh;display:flex;flex-direction:column}
.jr__wide{max-width:1240px;margin:0 auto;padding:0 clamp(20px,4vw,48px);width:100%}
.jr__mast{padding:clamp(28px,4vw,52px) 0 clamp(32px,4vw,56px)}
.jr__mastTitle{font-size:12px;font-weight:700;letter-spacing:.26em;text-transform:uppercase;color:var(--mute)}
.jr__mastDek{margin-top:10px;font-size:15px;color:var(--mute);line-height:1.7;word-break:keep-all}
.jr__lead{padding-bottom:clamp(56px,8vw,104px)}
.jr__leadLink{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.12fr);gap:clamp(28px,5vw,72px);align-items:center;text-decoration:none;color:inherit}
.jr__leadTitle{font-size:clamp(29px,4vw,50px);font-weight:700;line-height:1.22;letter-spacing:-.035em;word-break:keep-all}
.jr__leadDek{margin-top:20px;font-size:16px;line-height:1.8;color:var(--soft);word-break:keep-all;max-width:44ch}
.jr__leadLink .jr__meta{margin-top:22px}
.jr__leadFig{overflow:hidden;aspect-ratio:4/3;background:#f4f4f4}
.jr__leadFig img{width:100%;height:100%;object-fit:cover;transition:transform .55s cubic-bezier(.2,.6,.2,1)}
.jr__leadLink:hover .jr__leadFig img{transform:scale(1.03)}
.jr__leadLink:hover .jr__leadTitle{text-decoration:underline;text-underline-offset:6px}
.jr__grid{display:grid;grid-template-columns:repeat(3,1fr);gap:clamp(36px,4vw,56px) clamp(20px,2.6vw,34px)}
.jr__card a{display:block;text-decoration:none;color:inherit}
.jr__cardFig{overflow:hidden;aspect-ratio:16/10;background:#f4f4f4}
.jr__cardFig img{width:100%;height:100%;object-fit:cover;transition:transform .55s cubic-bezier(.2,.6,.2,1)}
.jr__card a:hover .jr__cardFig img{transform:scale(1.03)}
.jr__h{font-size:clamp(19px,1.7vw,22px);font-weight:700;line-height:1.34;letter-spacing:-.03em;margin-top:18px;word-break:keep-all}
.jr__card a:hover .jr__h{text-decoration:underline;text-underline-offset:5px}
.jr__card .jr__meta{margin-top:12px}
.jr__archive{padding:clamp(64px,8vw,112px) 0 clamp(48px,6vw,80px);margin-top:auto}
.jr__archive h2{font-size:12px;font-weight:700;letter-spacing:.26em;text-transform:uppercase;color:var(--mute);padding-bottom:16px}
.jr__archive a{display:flex;align-items:baseline;gap:16px;padding:18px 0;border-top:1px solid var(--rule);font-size:16px;font-weight:500;line-height:1.55;color:var(--ink);text-decoration:none;word-break:keep-all}
.jr__archive li:last-child a{border-bottom:1px solid var(--rule)}
.jr__archive a:hover{color:var(--mute)}
.jr__archiveNote{margin-top:20px;font-size:13px;color:var(--mute);line-height:1.75}
@media(max-width:900px){.jr__leadLink{grid-template-columns:1fr;gap:24px}.jr__leadFig{order:-1;aspect-ratio:16/10}
.jr__grid{grid-template-columns:repeat(2,1fr)}}
@media(max-width:560px){.jr__grid{grid-template-columns:1fr}}
`;

function renderIndex(articles, archive, lang) {
  const t = T(lang);
  const sorted = [...articles].sort((a, b) =>
    String(b.date).localeCompare(String(a.date)) || (a.order || 99) - (b.order || 99));
  const lead = sorted.find((a) => a.lead) || sorted[0];
  const rest = sorted.filter((a) => a !== lead);
  const meta = (a) => `<div class="jr__meta">${CLOCK}<span>${esc(krDate(a.date, lang))} · ${esc(t.mins(a.mins || readMins(a)))}</span></div>`;

  const ld = {
    "@context": "https://schema.org", "@type": "CollectionPage",
    name: "HARRIOT JOURNAL",
    description: lang === "en"
      ? "Notes from making watches in Korea." : "한국 시계 브랜드 해리엇이 남긴 제작기와 기록.",
    url: ORIGIN + "/journal/", inLanguage: lang,
    isPartOf: { "@type": "WebSite", name: "HARRIOT", url: ORIGIN + "/" },
    mainEntity: { "@type": "ItemList", itemListElement: sorted.map((a, i) => ({
      "@type": "ListItem", position: i + 1,
      url: `${ORIGIN}/journal/${a.slug}.html`,
      name: `${a.title}${a.titleSuffix ? " — " + a.titleSuffix : ""}`,
    })) },
  };
  const title = lang === "en" ? "Journal — Notes from HARRIOT" : "JOURNAL — 해리엇이 남긴 기록";
  const desc = lang === "en"
    ? "Notes from making watches in Korea: the KARI collaboration, the dial master of 36 years, and what MADE IN KOREA really takes."
    : "한국 시계 브랜드 해리엇이 남긴 제작기와 기록. 한국항공우주연구원 협업, 36년 문자판 장인, MADE IN KOREA 손목시계가 만들어지는 과정.";

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5">
<!-- 자동 생성 — harriot-journal/build.js -->
<script>
(function(){var t=${jstr(title + " | HARRIOT")};
function s(){if(document.title!==t)document.title=t}
s();document.addEventListener("DOMContentLoaded",s);window.addEventListener("load",s);})();
</script>
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="HARRIOT">
<meta property="og:locale" content="${lang === "en" ? "en_US" : "ko_KR"}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(lead ? lead.image : ORIGIN + "/roma/img/211830/og_default.png")}">
<meta property="og:url" content="${ORIGIN}/journal/">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.ico">
<script type="application/ld+json">${JSON.stringify(ld, null, 1)}</script>
${FONTS}
<style>${BASE_CSS}${INDEX_CSS}</style>
</head>
<body>
<div class="jr">
${header(lang, false)}
<div class="jr__wide">
  <div class="jr__mast">
    <h1 class="jr__mastTitle">${t.journal}</h1>
    <p class="jr__mastDek">${t.mastDek}</p>
  </div>
${lead ? `  <div class="jr__lead"><a class="jr__leadLink" href="/journal/${esc(lead.slug)}.html">
    <div>
      <h2 class="jr__leadTitle">${esc(lead.title)}</h2>
      <p class="jr__leadDek">${esc(lead.dek)}</p>
      ${meta(lead)}
    </div>
    <figure class="jr__leadFig"><img src="${esc(lead.image)}" alt="${esc(lead.alt)}" loading="eager"></figure>
  </a></div>` : ""}
  <ul class="jr__grid">
${rest.map((a) => `    <li class="jr__card"><a href="/journal/${esc(a.slug)}.html">
      <figure class="jr__cardFig"><img src="${esc(a.image)}" alt="${esc(a.alt)}" loading="lazy"></figure>
      <h2 class="jr__h">${esc(a.title)}</h2>
      ${meta(a)}
    </a></li>`).join("\n")}
  </ul>
</div>
${archive && archive.length ? `<section class="jr__archive"><div class="jr__wide">
  <h2>${t.archive}</h2>
  <ul>${archive.map((x) => `<li><a href="${esc(x.href)}">${esc(x.title)}</a></li>`).join("")}</ul>
  <p class="jr__archiveNote">${t.archiveNote}</p>
</div></section>` : ""}
${footer(lang)}
</div>
</body>
</html>`;
}

/* ── 빌드 ──────────────────────────────────────────────────────────────── */
function loadArticles(lang) {
  const dir = path.join(ROOT, "articles", lang);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".js"))
    .map((f) => require(path.join(dir, f)));
}

function build() {
  const out = [];
  for (const lang of ["ko", "en"]) {
    const arts = loadArticles(lang);
    if (!arts.length) continue;
    ORIGIN = ORIGIN_BY_LANG[lang];
    const dist = path.join(DIST, lang, "journal");
    fs.mkdirSync(dist, { recursive: true });
    for (const a of arts) {
      a.lang = lang;
      const p = path.join(dist, `${a.slug}.html`);
      fs.writeFileSync(p, renderArticle(a));
      out.push(p);
    }
    let archive = [];
    try { archive = require(path.join(ROOT, "articles", lang, "_archive.json")); } catch {}
    const ip = path.join(dist, "index.html");
    fs.writeFileSync(ip, renderIndex(arts, archive, lang));
    out.push(ip);
    console.log(`[${lang}] 기사 ${arts.length}편 + 목록 → ${path.relative(ROOT, dist)}`);
  }
  return out;
}

if (require.main === module) {
  const files = build();
  console.log(`\n생성 ${files.length}개`);
  files.forEach((f) => console.log("  " + path.relative(ROOT, f) +
    "  " + fs.statSync(f).size + "B"));
}

module.exports = { build, renderArticle, renderIndex, readMins };
