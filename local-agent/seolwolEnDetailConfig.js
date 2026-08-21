/**
 * HARRIOT SEOLWOL (설월) — 영문몰(shop2) 상세페이지 config
 *
 * 국문(seolwolDetailConfig.js)과 **골격·이미지는 동일**, 카피만 영문.
 * 번역이 아니라 영문 헤리티지 톤으로 다시 쓴 것 — 문장 길이·리듬이 국문과 다릅니다.
 *
 * ⚠️ 폐기된 원안: docs/harriot-seolwol-launch-prep.md §1 의
 *    "The moon does not wane / refuses / we inverted it" 는 사실이 아니라 전량 폐기.
 *    살아남은 건 "You are standing beneath a roof, looking up." 한 줄 → 히어로로 승격.
 * ⚠️ 기능 비교 카피 금지("Not a complication borrowed from Geneva" 등).
 *    스위스 무브 브랜드와 같은 링에 서는 순간 진다 — 설월은 디자인·스토리로 판다.
 * ⚠️ 무브먼트는 스펙표에만. "Swiss Made"는 인증 확인 전까지 사용 금지(RONDA 표기까지만).
 *
 * 글로벌 $420. **출시 9/10 확정**(2026-08-21 사장님). 초도 보증서 넘버링 없음.
 */

const ENGRAVE_FREE = true;
const { indexProfileSvg } = require("./seolwolIndexArt");

module.exports = {
  theme: "seolwol",
  lang: "en", // 세리프(Cormorant Garamond)·줄바꿈·스펙 TBD 라벨 전환
  previewTitle: "Harriot Seolwol 雪月",
  outDir: "seolwol-detail",   // 국문과 동일 폴더 — world/ 상대경로 공유
  fileBase: "seolwol-detail-en",

  sections: [
    // ── ① HERO ──────────────────────────────────────────────
    {
      type: "hero",
      eyebrow: "Harriot · Seolwol 雪月",
      title: "Seolwol",
      titleEn: "Snow Moon",
      image: { cut: "01", alt: "Dial macro — the moon half held behind the eave", ratio: "4/3" },
      line: "You are not watching the sky.<br>You are standing beneath a roof, looking up.",
      priceNote: "Moon Phase · Date · 38mm",
      price: "$420",
      badge: "Available September 10<br>Complimentary engraving · No added lead time",
    },

    // ── ② OPENING ───────────────────────────────────────────
    {
      type: "opening",
      text: "Some nights do not pass.<br>The ones that stay are usually the quiet ones.",
      sub: "Harriot makes watches from the stories Korea keeps.",
    },

    // ── ③ THE STORY ─────────────────────────────────────────
    {
      type: "story",
      eyebrow: "Seolwol 雪月",
      head: "Snow and moonlight,<br>in a single word.",
      body: [
        "In the deepest part of winter, the moon that rises once the snow has stopped was called <b>seolwol</b> — 雪月. Snow and moonlight, held in one word.",
        "For us the moon was something you looked up at. A place to make a wish, to think of someone who had gone, to wait out a season.",
        "And it was always seen from beneath a roof. Stand in the courtyard of a <b>hanok</b>, a traditional Korean house, and the roofline cuts the sky before anything else does. The moon rests at the end of that curve.",
        "What we remember is not the moon. It is <b>the moon seen with the eaves</b>.",
      ],
      image: { src: "world/m34_courtyard.png", alt: "A snow-covered hanok courtyard under a winter moon" },
    },

    // ── ③-b 무드 브레이크 ───────────────────────────────────
    {
      type: "full",
      image: { src: "world/m38_snowfall.png", alt: "Snow falling over a hanok at night" },
    },

    // ── ③-c THE ORIGIN ★ ────────────────────────────────────
    {
      type: "origin",
      eyebrow: "The Origin",
      head: "Three things<br>became a watch.",
      body: [
        "Everything in Seolwol came from the courtyard of a Korean house in winter.<br>Nothing here was invented. It was carried over.",
      ],
      pairs: [
        {
          from: { src: "world/m37_eave-tip.png", alt: "A winter moon resting at the tip of a hanok eave" },
          fromCap: "The eaves of a hanok",
          to: { cut: "05", alt: "The moon phase aperture, cut along a roofline", ratio: "16/9" },
          toCap: "The window at twelve",
          text: "Stand in the courtyard and the roofline divides the sky first. The moon always rested at the end of that curve. We cut the window along the same line — and then cut it twelve more times, into the indices.",
        },
        {
          from: { src: "world/m32_snowtiles.png", alt: "Fresh snow on hanok roof tiles" },
          fromCap: "Snow on the roof tiles",
          to: { cut: "09", alt: "Dial in raking light — fine snow texture", ratio: "16/9" },
          toCap: "The dial",
          text: "Snow is not white. In shade it carries the palest blue. The colour of the dial, and the fineness of its grain, came from here.",
        },
        {
          from: { src: "world/m33_moon.png", alt: "The full moon after snowfall" },
          fromCap: "The moon after the snow",
          to: { cut: "06", alt: "The moon phase disc made for this watch", ratio: "1/1" },
          toCap: "The moon phase disc",
          text: "The moon the movement gave us was not this moon. We drew the moon and the stars again, and gave the moon its surface.",
        },
      ],
    },

    // ── ④-a Beneath the Eaves ───────────────────────────────
    {
      type: "narrative",
      eyebrow: "The Eaves",
      head: "Beneath the eaves.",
      body: [
        "The window at twelve o'clock is not a circle. It is cut along the curve of a Korean tiled roof.",
        "The moon rises through those eaves, and sets behind them.",
        "What you see is not the moon in the sky. It is <b>the moon seen from a courtyard</b>.",
      ],
      image: { cut: "05", alt: "Close macro of the aperture — the eave curve", ratio: "16/9" },
    },

    // ── ④-b 시퀀스 ──────────────────────────────────────────
    {
      type: "sequence",
      items: [
        { image: { cut: "02", alt: "Moon phase — rising from behind the eave", ratio: "1/1" }, caption: "It rises" },
        { image: { cut: "03", alt: "Moon phase — resting on the curve", ratio: "1/1" }, caption: "It rests" },
        { image: { cut: "04", alt: "Moon phase — setting behind the eave", ratio: "1/1" }, caption: "It sets" },
      ],
    },

    // ── ⑤ The Moon ★ ────────────────────────────────────────
    {
      type: "sequence",
      dark: true,
      eyebrow: "The Moon",
      head: "We drew the moon again.",
      body: [
        "The movement came with a moon.<br>It was not the moon we had seen.",
        "So we drew the moon and the stars again. The stars are not all one size — the near and the far share a sky.",
        "We gave the moon its surface. Not a smooth circle, but the mottling that only someone who has looked at it for a long time knows.",
        "And we put the luminous on the moon alone.<br><b>Turn out the light and the hands and the indices disappear. The moon stays.</b>",
      ],
      items: [
        { image: { cut: "06", alt: "Moon phase disc close — surface and stars", ratio: "1/1" }, caption: "The grain of the moon, and the stars. The disc was made for this watch, not taken from the movement." },
        { image: { cut: "07", alt: "Long exposure in darkness — only the moon glows", ratio: "1/1" }, caption: "Turn out the light and the moon stays." },
      ],
    },

    // ── ⑥ Alignment ★ ───────────────────────────────────────
    {
      type: "narrative",
      eyebrow: "Alignment",
      head: "Once a minute,<br>the watch puts itself in order.",
      body: [
        "The short end of the seconds hand is the Harriot symbol.",
        "When the seconds hand reaches twelve, the symbol on the other end settles above the logo at six. They become a single line through the centre of the dial.",
        "It performs no function. It lasts one second.",
      ],
      image: { cut: "08", alt: "The seconds hand at twelve — symbol aligned with the logo", ratio: "1/1" },
    },

    // ── ⑦ THE DIAL ──────────────────────────────────────────
    {
      type: "features",
      eyebrow: "The Dial",
      head: "Snow does not shine.<br>It holds the light.",
      intro:
        "The dial is not white. It is the colour of snow on a roof — the palest of blues. The grain is kept fine: no coarse texture, no pearl.",
      image: { cut: "09", alt: "Dial texture in raking light", ratio: "16/9" },
      items: [
        { title: "Pale sky blue", desc: "The colour of snow on a Korean roof. Not white." },
        { title: "Fine snow texture", desc: "No coarse grain, no pearl. Snow does not shine; it holds the light." },
        { title: "Matte finish", desc: "Taken down as far as it would go. A dial that glitters is a dial where the snow cannot be seen." },
        { title: "Dauphine hands", desc: "A central ridge splits the light in two. The tips are softened, not sharpened." },
      ],
    },

    // ── ⑦-b The Index ★ — 처마 곡선을 4mm로 줄여 열두 번 ──────
    // 근거: 파쇼 다이얼 도면 260820-Dial.pdf 실측. 도해 SVG = seolwolIndexArt.js (국문과 동일 그림)
    {
      type: "diagram",
      eyebrow: "The Index",
      head: "The eave is not<br>only at twelve.",
      body: [
        "The indices are not plain batons. They were drawn again from the beginning.",
        "Four millimetres long. Both ends are cut away at fifteen degrees, and between them the top is hollowed on a seven-millimetre radius, so the centre sits lower than the shoulders.",
        "That hollow is <b>the eave line</b> — the curve of a roof seen from a courtyard, reduced to four millimetres and repeated twelve times around the dial.",
      ],
      svg: indexProfileSvg(),
      figcap: "Above · the eave of a hanok. Below · the Seolwol index in profile. The same curve. (mm)",
      after: [
        "A flat index flashes once, at one angle, and goes dead. A hollowed one does not. Tilt the wrist and the light runs along the curve — it <b>travels</b> instead of going out.",
        "The dial is finished as matte as it could be. The only thing that throws light back is the indices.",
        "It is how sunlight behaves on snow — the ground stays quiet, and only the glint moves.",
      ],
      image: { cut: "10", alt: "Index macro in raking light — the highlight running along the hollow", ratio: "16/9" },
      imageCap: "The light travels along the curve",
    },

    // ── ⑧ Case & Strap ──────────────────────────────────────
    {
      type: "sequence",
      eyebrow: "Case & Strap",
      head: "38mm.<br>8.15mm thin.",
      body: [
        "It slides under a shirt cuff.",
        "The crystal is sapphire, and it is flat. There is no dome to bend the edge, so you see the snow on the dial as it is. Anti-reflective coating on the inside, anti-fingerprint on the outside. Nothing reflected, nothing left behind — <b>the best crystal is the one you cannot see.</b>",
        "Polished bezel, brushed case flank, polished lug tops. The surfaces change as you turn your wrist.",
        "The strap is navy calf in a crocodile pattern with a lacquered sheen — the exact opposite of the matte dial. It tapers from 20mm to 16mm.",
      ],
      items: [
        { image: { cut: "11", alt: "Side profile — flat sapphire, slim case", ratio: "1/1" }, caption: "A low, level silhouette." },
        { image: { cut: "13", alt: "Strap close — navy crocodile pattern", ratio: "1/1" }, caption: "Navy crocodile-pattern calf." },
      ],
    },

    // ── ⑨ On the Wrist ──────────────────────────────────────
    {
      type: "gallery",
      eyebrow: "On the Wrist",
      head: "Most itself<br>under a sleeve.",
      body: "A dress watch, at home at a ceremony — but not only there. It sits most naturally under a white shirt, a fine knit, the sleeve of a coat.",
      images: [
        { cut: "14", alt: "On the wrist — front", ratio: "4/5" },
        { cut: "15", alt: "On the wrist — three quarters", ratio: "4/5" },
        { cut: "16", alt: "On the wrist — under a coat sleeve", ratio: "4/5" },
        { cut: "23", alt: "Full front (high resolution)", ratio: "4/5" },
      ],
    },

    // ── ⑩-a The Box ★ ───────────────────────────────────────
    {
      type: "narrative",
      eyebrow: "The Box",
      head: "The box is the story<br>that arrives first.",
      body: [
        "A grey moon is printed on a translucent vellum sleeve. Beneath it, silver foil on the navy box carries the eave of a hanok roof. Through the paper, the two meet.",
        "<b>The moon hangs over the roof.</b>",
      ],
      image: { cut: "17", alt: "Sleeve on — the printed moon meets the foiled eave", ratio: "4/3" },
    },

    // ── ⑩-b 언박싱 4단계 ────────────────────────────────────
    {
      type: "sequence",
      items: [
        { image: { cut: "18", alt: "Sleeve removed — only the foiled eave remains", ratio: "4/3" }, caption: "Lift the sleeve away and the moon is gone. Only the eaves remain." },
        { image: { cut: "19", alt: "Lid opened — vellum cover with the story", ratio: "4/3" }, caption: "Open the lid and there is a single sheet of vellum. On it, what the moon and the roof have meant to us." },
        { image: { cut: "20", alt: "Lifting the vellum cover", ratio: "4/3" }, caption: "Lift that sheet, and" },
        { image: { cut: "21", alt: "The watch and its warranty card", ratio: "4/3" }, caption: "Seolwol, and its warranty." },
      ],
    },

    // ── ⑩-c 무드 브레이크 ───────────────────────────────────
    {
      type: "full",
      image: { src: "world/m36_stilllife.png", alt: "White porcelain and pine on snow" },
    },

    // ── ⑪ Engraving ─────────────────────────────────────────
    {
      type: "engrave",
      eyebrow: "Engraving",
      head: "Engraved, to last.",
      lead:
        "The upper caseback carries the silhouette of a hanok roof, and the space below it was left empty.<br>A name. A date. Or nothing at all.",
      image: { cut: "22", alt: "Caseback engraving — hanok roofline above, name below", ratio: "1/1" },
      imageCap: "Caseback engraving",
      free: ENGRAVE_FREE ? "Engraving is free, and adds no time to your shipping date" : null,
      notes: [
        "Engraved on the <b>lower caseback</b>, beneath the roofline.",
        "There is no character limit, but longer text is set smaller. <b>Up to 10 characters</b> is recommended.",
        "Engraved pieces cannot be returned or exchanged for a change of mind.",
      ],
    },

    // ── ⑫ SPECIFICATION ─────────────────────────────────────
    {
      type: "spec",
      eyebrow: "Specification",
      head: "Specification",
      tbd: "To be confirmed",
      rows: [
        ["Model", "Harriot Seolwol 雪月"],
        ["Case", "38mm · 316L stainless steel"],
        ["Thickness", "8.15mm"],
        ["Lug to lug", "43.8mm · Strap width 20mm"],
        ["Crystal", "Flat sapphire · anti-reflective inside, anti-fingerprint outside"],
        ["Dial", "Pale sky blue · fine snow texture"],
        ["Indices", "Applied · 4.0mm · ends cut at 15° · centre hollowed on R7 (eave curve) · polished silver"],
        ["Hands", "Dauphine · seconds hand with symbol counterweight"],
        ["Moon phase", "At 12 o'clock · <b>disc made for this watch</b> (deep navy, luminous moon)"],
        ["Date", "At 6 o'clock · white disc"],
        ["Luminous", "Super-LumiNova · moon only"],
        ["Movement", "RONDA 708 quartz moon phase"],
        ["Water resistance", "5 ATM"],
        ["Strap", "Navy crocodile-pattern calf · 20 → 16mm"],
        ["Buckle", "Pin buckle · HARRIOT engraved"],
        ["Caseback", "Solid · hanok roofline · space for custom engraving"],
        ["Warranty", "2 years"],
      ],
      note:
        "Available <b>September 10</b>. Orders ship in the order they are received.",
    },

    // ── ⑬-a 무드 브레이크 ───────────────────────────────────
    {
      type: "full",
      image: { src: "world/m31_eave-moon.png", alt: "A winter moon above a snow-covered hanok roof" },
    },

    // ── ⑬ CLOSING ───────────────────────────────────────────
    {
      type: "closing",
      eyebrow: "Harriot",
      head: "There was a night after the snow<br>when we stood in a courtyard<br>and looked up through the eaves.",
      body: "We put that night on the wrist.",
      slogan: "Seolwol 雪月",
      sloganSub: "Harriot",
    },
  ],
};
