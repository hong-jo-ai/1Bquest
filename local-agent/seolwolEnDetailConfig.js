/**
 * HARRIOT SEOLWOL (설월) — 영문몰(shop2) 상세페이지 config
 *
 * 국문(seolwolDetailConfig.js)과 **골격·이미지는 동일**, 카피만 영문.
 * 번역이 아니라 영문 헤리티지 톤으로 다시 쓴 것 — 문장 길이·리듬이 국문과 다릅니다.
 *
 * ⚠️ 폐기된 원안: docs/harriot-seolwol-launch-prep.md §1 의
 *    [2026-08-31 정정] "The moon does not wane" 는 사실이 맞다 — 달은 항상 보름달이고 위상 변화가 없다.
 *    바뀌는 것은 달의 위치(처마 위 어디에 걸렸는가). 단 "the eaves move" 는 틀림 — 움직이는 건 달이다.
 *    살아남은 건 "You are standing beneath a roof, looking up." 한 줄 → 히어로로 승격.
 * ⚠️ 기능 비교 카피 금지("Not a complication borrowed from Geneva" 등).
 *    스위스 무브 브랜드와 같은 링에 서는 순간 진다 — 설월은 디자인·스토리로 판다.
 * ⚠️ 무브먼트는 스펙표에만. "Swiss Made"는 인증 확인 전까지 사용 금지(RONDA 표기까지만).
 *
 * 글로벌 $350 (2026-09-02 개정: $420→$400→$350, DDU 유지 결정). **출시 9/10 확정**(2026-08-21 사장님). 초도 보증서 넘버링 없음.
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
      image: { src: "https://harriotwatches.com/seolwol/img/cut01-dial-hero-v2.jpg", alt: "Dial macro — the moon half held behind the eave", ratio: "4/3" },
      line: "You are not watching the sky.<br>You are standing beneath a roof, looking up.",
      priceNote: "Moon Phase · Date · 38mm",
      price: "$350",
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
        "It began with a photograph we came across by chance. Snow lying evenly on the tiled roofs of a Korean village, sunlight across it, holding <b>a colour that was neither white nor blue but somewhere between the two</b>. That colour was beautiful. The curve of the eaves and that faint blue were strong enough that we decided, one day, to make a watch out of them.",
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
          to: { src: "https://harriotwatches.com/seolwol/img/cut05-window-v2.jpg", alt: "The moon phase aperture, cut along a roofline", ratio: "16/9" },
          toCap: "The window at twelve",
          text: "Stand in the courtyard and the roofline divides the sky first. The moon always rested at the end of that curve. We cut the window along the same line — and then cut it twelve more times, into the indices.",
        },
        {
          // 2026-08-31: replaced the AI mood image with the founder's own photograph.
          from: { src: "world/real_snow-roof.jpg", alt: "Snow settled on the roofs of a hanok village" },
          fromCap: "Snow on a hanok roof",
          to: { src: "https://harriotwatches.com/seolwol/img/cut09-dial-texture-v2.jpg", alt: "Dial in raking light — fine snow texture", ratio: "16/9" },
          toCap: "The dial of Seolwol",
          text: "Snow is not white. Lying in shade it carries the palest blue. That colour, on those roofs, became the colour of the dial — not matched to it afterwards, but decided in front of it. The grain came from the same place: no coarse particles, no pearl, only the surface of snow settled on tile.",
        },
        {
          from: { src: "world/m33_moon.png", alt: "The full moon after snowfall" },
          fromCap: "The moon after the snow",
          to: { src: "https://harriotwatches.com/seolwol/img/cut06-disc-v2b.jpg", alt: "The moon phase disc made for this watch", ratio: "1/1" },
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
      image: { src: "https://harriotwatches.com/seolwol/img/cut05-window-v2.jpg", alt: "Close macro of the aperture — the eave curve", ratio: "16/9" },
    },

    // ── (4)-a2 Not a phase, a position ★ key differentiator (added 2026-08-31) ──
    {
      type: "narrative",
      eyebrow: "Not a Phase",
      head: "The moon does not wane.",
      body: [
        "On a moon phase watch the <b>shape</b> of the moon changes day by day. Two arcs curving inward at the base of the aperture shave the moon at its sides, and that is what makes the phase. Almost every moon phase is built this way.",
        "<b>On Seolwol the moon is always full.</b> What changes, day by day, is <b>where it hangs above the eaves</b>.",
        "To do that we cut those two lower arcs the other way — flowing outward instead of curving in, following the roofline of a hanok seen from a courtyard. The moon rises at one eave, crosses the roof, and sets behind the other. Once over the course of a month.",
        "A moon half covered does not read as a half moon. The line that hides it is not a round arc carving the moon, but the outward curve of an eave. It reads not as a phase, but as <b>a moon behind a roof</b>.",
      ],
      image: { src: "https://harriotwatches.com/seolwol/img/cut05-window-v2.jpg", alt: "Moon phase aperture — a full moon resting on the eave curve", ratio: "16/9" },
    },

    // ── ④-b 시퀀스 ──────────────────────────────────────────
    {
      type: "sequence",
      items: [
        { image: { src: "https://harriotwatches.com/seolwol/img/cut02-moon-rise.jpg", alt: "Moon phase — rising from behind the eave", ratio: "1/1" }, caption: "It rises" },
        { image: { src: "https://harriotwatches.com/seolwol/img/cut03-moon-cross.jpg", alt: "Moon phase — resting on the curve", ratio: "1/1" }, caption: "It rests" },
        { image: { src: "https://harriotwatches.com/seolwol/img/cut04-moon-set.jpg", alt: "Moon phase — setting behind the eave", ratio: "1/1" }, caption: "It sets" },
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
        { image: { src: "https://harriotwatches.com/seolwol/img/cut06-disc-v2b.jpg", alt: "Moon phase disc close — surface and stars", ratio: "1/1" }, caption: "The grain of the moon, and the stars. The disc was made for this watch, not taken from the movement." },
        { image: { src: "https://harriotwatches.com/seolwol/img/cut07-lume.jpg", alt: "Long exposure in darkness — only the moon glows", ratio: "1/1" }, caption: "Turn out the light and the moon stays." },
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
      image: { src: "https://harriotwatches.com/seolwol/img/cut08-align.jpg", alt: "The seconds hand at twelve — symbol aligned with the logo", ratio: "1/1" },
    },

    // ── ⑦ THE DIAL ──────────────────────────────────────────
    {
      type: "features",
      eyebrow: "The Dial",
      head: "Snow does not gather light.<br>It scatters it.",
      intro:
        "The dial is not white. It is the colour of snow on a roof — the palest of blues. The grain is left standing. Rather than polishing it smooth, we kept it as fresh snow sits — crystalline, uneven.",
      image: { src: "https://harriotwatches.com/seolwol/img/cut09-dial-texture-v2.jpg", alt: "Dial texture in raking light", ratio: "16/9" },
      items: [
        { title: "Pale sky blue", desc: "The colour of snow on a Korean roof. Not white." },
        { title: "Fine snow texture", desc: "Up close the surface is not even. Snow never is." },
        { title: "Matte finish", desc: "It does not mirror. Light breaks against the grain and scatters." },
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
        "The dial scatters light. The only thing that gathers it into a single line is the indices.",
        "It is how sunlight behaves on snow — the ground stays quiet, and only the glint moves.",
      ],
      image: { src: "https://harriotwatches.com/seolwol/img/cut10-index-v2.jpg", alt: "Index macro in raking light — the highlight running along the hollow", ratio: "16/9" },
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
        { image: { src: "https://harriotwatches.com/seolwol/img/cut11-profile-v2.jpg", alt: "Side profile — flat sapphire, slim case", ratio: "1/1" }, caption: "A low, level silhouette." },
        { image: { src: "https://harriotwatches.com/seolwol/img/cut13-strap-v2.jpg", alt: "Strap close — navy crocodile pattern", ratio: "1/1" }, caption: "Navy crocodile-pattern calf." },
      ],
    },

    // ── ⑨ On the Wrist ──────────────────────────────────────
    {
      type: "gallery",
      eyebrow: "On the Wrist",
      head: "Most itself<br>under a sleeve.",
      body: "A dress watch, at home at a ceremony — but not only there. It sits most naturally under a white shirt, a fine knit, the sleeve of a coat.",
      images: [
        { src: "https://harriotwatches.com/seolwol/img/cut14-wrist-suit.jpg", alt: "On the wrist — front", ratio: "4/5" },
        { src: "https://harriotwatches.com/seolwol/img/cut15-wrist-casual.jpg", alt: "On the wrist — three quarters", ratio: "4/5" },
        { src: "https://harriotwatches.com/seolwol/img/cut23-front.jpg", alt: "Full front (high resolution)", ratio: "4/5" },
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
      image: { src: "https://harriotwatches.com/seolwol/img/cut15-box-sleeve.jpg", alt: "Sleeve on — the printed moon meets the foiled eave", ratio: "4/3" },
    },

    // ── ⑩-b 언박싱 4단계 ────────────────────────────────────
    {
      type: "sequence",
      items: [
        { image: { src: "https://harriotwatches.com/seolwol/img/cut16-box-bare.jpg", alt: "Sleeve removed — only the foiled eave remains", ratio: "4/3" }, caption: "Lift the sleeve away and the moon is gone. Only the eaves remain. Open the lid and there is a single sheet of tracing paper — what the moon and the hanok have meant to us. Lift that away, and there is the SEOLWOL, with its warranty." },
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
      image: { src: "https://harriotwatches.com/seolwol/img/cut22-caseback-v2.jpg", alt: "Caseback engraving — hanok roofline above, name below", ratio: "1/1" },
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
        ["Lug to lug", "43.2mm · Strap width 20mm"],
        ["Crystal", "Flat sapphire · anti-reflective inside, anti-fingerprint outside"],
        ["Dial", "Pale sky blue · fine snow texture"],
        ["Indices", "Applied · 4.0mm · ends cut at 15° · centre hollowed on R7 (eave curve) · polished silver"],
        ["Hands", "Dauphine · seconds hand with symbol counterweight"],
        ["Moon phase", "At 12 o'clock · <b>disc made for this watch</b> · <b>always full, no phase change</b> — crosses the eaves over about 29.5 days · deep navy, luminous moon"],
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
        "Orders ship in the order they are received.",
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
