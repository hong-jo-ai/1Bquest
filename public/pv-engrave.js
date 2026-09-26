/*! 폴바이스 에끌라 오벌 각인 미리보기 — 2026-09-26
 *  해리엇 설월판(hrt-engrave.js)의 형제. 로직은 같고 기하만 다르다.
 *  ⚠️ 한쪽을 고치면 다른 쪽도 볼 것.
 *
 *  설월과 다른 점
 *   · 각인면이 **원이 아니라 사각(브러시드 판)** → 줄 수에 따라 폭이 변하지 않는다. 세로만 본다.
 *   · 판에 **공장 각인이 이미 있다**(위 PAULVICE / 아래 스펙 3줄) → 고객 각인은 **그 사이 빈 띠**.
 *
 *  실측·환산 (2026-09-26)
 *   사장님 실측: 케이스백 세로 23mm. 교차검증: 스트랩 러그 10mm(메탈 스트랩 상품 규격)
 *     → 원본 930px 이미지에서 케이스 세로 554px / 23mm = 24.1 px/mm
 *     → 스트랩 폭 244px / 10mm = 24.4 px/mm   (1.3% 차이 = 일치)
 *   채택 **1mm = 24.2px @930px**.
 *   ⚠️ 사장님이 주신 "가로 19mm" 는 이 스케일과 안 맞는다(케이스 최대 폭은 21.1mm 로 나온다).
 *      토노 케이스라 위아래로 갈수록 좁아지니 덜 넓은 곳을 재신 것으로 보인다.
 *      가로는 이미지에서 얻고, 스케일은 세로(23mm)+스트랩(10mm) 두 개가 맞은 값을 쓴다.
 *   → 각인 가능 영역(빈 띠) ≈ **가로 15.5mm × 세로 10.0mm**
 *
 *  페일오픈: 어디서 실패하든 조용히 끝낸다. 롤백 = 스크립트태그 삭제.
 */
(function () {
  "use strict";
  try {
    var PRODUCTS = { "195": 1, "196": 1, "263": 1, "264": 1, "265": 1 };

    // 카페24는 상품 주소가 두 벌이다: ?product_no= 과 /product/<이름>/<번호>/
    function productNo() {
      var q = (location.search.match(/[?&]product_no=(\d+)/) || [])[1];
      if (q) return q;
      var m = location.pathname.match(/\/product\/[^\/?]+\/(\d+)(?:[\/?]|$)/);
      if (m) return m[1];
      var c = document.querySelector('link[rel="canonical"]');
      if (c) { var cm = String(c.href || "").match(/\/product\/[^\/?]+\/(\d+)(?:[\/?]|$)/); if (cm) return cm[1]; }
      return null;
    }
    if (!PRODUCTS[productNo()]) return;

    var IMG = "https://ecimg.cafe24img.com/pg799b36658487045/icaruse2000/web/upload/engrave/eclat-caseback.jpg";

    var NATIVE = 930;        // 원본 이미지 폭
    var PXMM = 24.2;         // 원본에서 1mm
    var WK = 0.78;           // 각인기 글자 가로 보정(설월에서 실측으로 잡은 값, 같은 각인기)
    // 빈 띠(각인 자리) — 원본 이미지 비율
    var ZONE = { cx: 50.33, cy: 48.82, w: 40.21, h: 26.02 };

    function isEn() {
      if (/(^|\/)shop2(\/|$)/.test(location.pathname)) return true;
      var th = document.querySelector(".xans-product-addoption th");
      if (th && /engraving/i.test(th.textContent || "")) return true;
      return false;
    }
    var EN = isEn();

    var T = EN ? {
      btn: "Preview your engraving", title: "A line only yours",
      sub: "The caseback keeps the words the dial cannot say.",
      scale: "Engraving area 15.5 × 10mm · shown at actual scale",
      label: "Engraving message", ph: "e.g. 2026.09.26\nFor you",
      size: "Letter height",
      hint: "Most engravings sit between 2.3 and 2.7mm — larger for short lines, smaller for long ones.",
      warn: "⚠ This runs past the engraving area. Reduce the size or shorten the text.",
      long: "⚠ Too long to send with the order. Please shorten the text.",
      note: "<b>This preview is a guide and does not guarantee the exact engraved result.</b> Weight, letter spacing and line spacing may differ, and the size is adjusted on the engraving machine. What reaches us is <b>your text, typeface, line breaks and letter height</b>.",
      apply: "Use this engraving", close: "Close", dialog: "Engraving preview",
      tagKo: "Korean", tagEn: "Latin", def: " · default", sizeWord: "height"
    } : {
      btn: "각인 미리보기", title: "당신에게만 있는 한 줄",
      sub: "앞면이 말하지 못한 문장을, 뒷면이 간직합니다.",
      scale: "각인 영역 15.5 × 10mm · 실제 비율로 표시됩니다",
      label: "각인 문구", ph: "예) 2026.09.26\n사랑하는 당신에게",
      size: "글자 높이",
      hint: "대부분 2.3~2.7mm 사이로 새깁니다 — 문구가 짧으면 크게, 길면 작게.",
      warn: "⚠ 각인 영역을 넘칩니다. 크기를 줄이거나 문구를 짧게 해주세요.",
      long: "⚠ 주문서에 담기엔 문구가 깁니다. 조금만 줄여주세요.",
      note: "<b>화면은 참고용이며 실제와 똑같이 새겨지는 것을 보장하지 않습니다.</b> 굵기·자간·줄 간격이 다를 수 있고 크기도 각인 장비에서 조정됩니다. 전달되는 것은 <b>문구 · 서체 · 줄바꿈 위치 · 글자 높이</b>입니다.",
      apply: "이 문구로 신청하기", close: "닫기", dialog: "각인 미리보기",
      tagKo: "한글", tagEn: "영문", def: " · 기본", sizeWord: "높이"
    };

    var FONTS = [
      { n: "나눔고딕", en: "Nanum Gothic", f: "'Nanum Gothic',sans-serif", t: "ko" },
      { n: "나눔명조", en: "Nanum Myeongjo", f: "'Nanum Myeongjo',serif", t: "ko" },
      { n: "Arial", en: "Arial", f: "Arial,Helvetica,sans-serif", t: "en" },
      { n: "Times New Roman", en: "Times New Roman", f: "'Times New Roman',Times,serif", t: "en" }
    ];
    var DEF = 0;
    var font = FONTS[DEF].f, fontName = EN ? FONTS[DEF].en : FONTS[DEF].n, mm = 2.5;

    function css() {
      if (document.getElementById("pvEngCss")) return;
      var s = document.createElement("style");
      s.id = "pvEngCss";
      s.textContent =
        '#pvEngBtn{display:block;width:100%;box-sizing:border-box;margin:10px 0 2px;padding:13px 12px;' +
        'border:1.5px solid #111;border-radius:4px;background:#fff;color:#111;font-size:14px;font-weight:700;' +
        'cursor:pointer;letter-spacing:.01em;line-height:1.2;text-align:center}' +
        '#pvEngBtn:hover,#pvEngBtn:active{background:#111;color:#fff}' +
        '#pvEngWrap{position:fixed;inset:0;z-index:99999;display:none;align-items:center;justify-content:center;padding:16px}' +
        '#pvEngWrap.on{display:flex}' +
        '#pvEngDim{position:absolute;inset:0;background:rgba(0,0,0,.55)}' +
        '#pvEngBox{position:relative;background:#fff;color:#111;border-radius:6px;max-width:430px;width:100%;' +
        'max-height:94vh;display:flex;flex-direction:column;padding:16px 18px 12px;' +
        'font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;line-height:1.6}' +
        '#pvEngBox h3{font-family:Georgia,"Times New Roman",serif;font-weight:400;font-size:19px;margin:0 0 5px;flex:none}' +
        '#pvEngScroll{overflow-y:auto;flex:1;min-height:0;-webkit-overflow-scrolling:touch}' +
        '#pvEngBox .sb{color:#8a8a8a;font-size:12.5px;margin:0 0 12px;line-height:1.6;flex:none}' +
        '#pvEngX{position:absolute;top:12px;right:14px;border:0;background:none;font-size:22px;color:#8a8a8a;cursor:pointer;line-height:1}' +
        '#pvEngStage{position:relative;width:100%;max-width:180px;margin:0 auto 3px;background:#f4f4f4;border-radius:6px;overflow:hidden}' +
        '#pvEngStage img{display:block;width:100%;height:auto}' +
        '#pvEngZone{position:absolute;transform:translate(-50%,-50%);' +
        'display:flex;align-items:center;justify-content:center;overflow:hidden;text-align:center}' +
        '#pvEngOut{margin:0;color:#8f8f8f;white-space:pre-wrap;word-break:keep-all;overflow-wrap:break-word;' +
        'line-height:1.28;text-shadow:0 1px 1px rgba(255,255,255,.45)}' +
        '#pvEngScale{text-align:center;color:#8a8a8a;font-size:10.5px;margin:0 0 9px}' +
        '#pvEngTxt{width:100%;min-height:44px;resize:vertical;padding:10px;border:1px solid #ddd;border-radius:4px;font:inherit;font-size:14px;box-sizing:border-box}' +
        '#pvEngBox .lb{display:block;font-size:11px;letter-spacing:.06em;color:#8a8a8a;margin:0 0 6px;text-transform:uppercase}' +
        '#pvEngFonts{display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:9px}' +
        '#pvEngFonts button{padding:5px 4px;border:1px solid #ddd;border-radius:4px;background:#fff;color:#111;cursor:pointer;font-size:12.5px;line-height:1.25}' +
        '#pvEngFonts button[aria-pressed="true"]{border-color:#111;box-shadow:0 0 0 1px #111}' +
        '#pvEngFonts small{display:block;font-size:9px;color:#8a8a8a;margin-top:1px;font-family:-apple-system,sans-serif}' +
        '#pvEngSizeRow{display:flex;align-items:baseline;justify-content:space-between;margin:8px 0 2px}' +
        '#pvEngMm{font-size:17px;font-weight:600}#pvEngMm span{font-size:12px;font-weight:400;color:#8a8a8a}' +
        '#pvEngSize{width:100%;accent-color:#111}' +
        '#pvEngHint{font-size:10.5px;color:#8a8a8a;margin:4px 0 0;line-height:1.45}' +
        '#pvEngWarn{margin:8px 0 0;font-size:12px;color:#a8552a;display:none}#pvEngWarn.on{display:block}' +
        '#pvEngNote{flex:none;font-size:10.5px;color:#8a8a8a;margin:9px 0 0;padding-top:9px;border-top:1px solid #ddd;line-height:1.45}' +
        '#pvEngNote b{color:#111}' +
        '#pvEngApply{width:100%;flex:none;margin-top:9px;padding:14px;border:0;border-radius:4px;background:#111;color:#fff;font-size:14px;font-weight:600;cursor:pointer}';
      document.head.appendChild(s);
      if (!document.getElementById("pvEngFont")) {
        var l = document.createElement("link");
        l.id = "pvEngFont"; l.rel = "stylesheet";
        l.href = "https://fonts.googleapis.com/css2?family=Nanum+Gothic&family=Nanum+Myeongjo&display=swap";
        document.head.appendChild(l);
      }
    }

    function build() {
      if (document.getElementById("pvEngWrap")) return;
      var w = document.createElement("div");
      w.id = "pvEngWrap";
      w.innerHTML =
        '<div id="pvEngDim"></div><div id="pvEngBox" role="dialog" aria-modal="true" aria-label="' + T.dialog + '">' +
        '<button id="pvEngX" type="button" aria-label="' + T.close + '">&times;</button>' +
        '<h3>' + T.title + '</h3><p class="sb">' + T.sub + '</p>' +
        '<div id="pvEngScroll">' +
        '<div id="pvEngStage"><img src="' + IMG + '" alt="ECLAT caseback"><div id="pvEngZone"><p id="pvEngOut"></p></div></div>' +
        '<p id="pvEngScale">' + T.scale + '</p>' +
        '<span class="lb">' + T.label + '</span>' +
        '<textarea id="pvEngTxt" spellcheck="false"></textarea>' +
        '<div id="pvEngFonts"></div>' +
        '<div id="pvEngSizeRow"><span class="lb" style="margin:0">' + T.size + '</span>' +
        '<span id="pvEngMm">2.5<span>mm</span></span></div>' +
        '<input type="range" id="pvEngSize" min="1.5" max="4" value="2.5" step="0.1" aria-label="' + T.size + '">' +
        '<p id="pvEngHint">' + T.hint + '</p>' +
        '<p id="pvEngWarn"></p></div>' +
        '<p id="pvEngNote">' + T.note + '</p>' +
        '<button id="pvEngApply" type="button">' + T.apply + '</button></div>';
      document.body.appendChild(w);
      w.querySelector("#pvEngTxt").placeholder = T.ph;

      var z = w.querySelector("#pvEngZone");
      z.style.left = ZONE.cx + "%"; z.style.top = ZONE.cy + "%";
      z.style.width = ZONE.w + "%"; z.style.height = ZONE.h + "%";
      z.style.position = "absolute";

      var fw = w.querySelector("#pvEngFonts");
      FONTS.forEach(function (o, i) {
        var b = document.createElement("button");
        b.type = "button";
        b.setAttribute("aria-pressed", i === DEF ? "true" : "false");
        b.innerHTML = (EN ? o.en : o.n) + "<small>" + (o.t === "ko" ? T.tagKo : T.tagEn) + (i === DEF ? T.def : "") + "</small>";
        b.onclick = function () {
          [].forEach.call(fw.children, function (x) { x.setAttribute("aria-pressed", "false"); });
          b.setAttribute("aria-pressed", "true");
          font = o.f; fontName = EN ? o.en : o.n; render();
        };
        fw.appendChild(b);
      });

      w.querySelector("#pvEngDim").onclick = close;
      w.querySelector("#pvEngX").onclick = close;
      w.querySelector("#pvEngTxt").addEventListener("input", render);
      w.querySelector("#pvEngSize").addEventListener("input", function () { mm = parseFloat(this.value); render(); });
      w.querySelector("#pvEngApply").onclick = apply;
      document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
    }

    function pxPerMm() {
      var st = document.getElementById("pvEngStage");
      return PXMM * (st.clientWidth / NATIVE);
    }
    function orderValue() {
      var v = document.getElementById("pvEngTxt").value.replace(/\s+$/, "");
      var lines = v.split("\n").map(function (s) { return s.trim(); }).filter(function (s) { return s !== ""; });
      if (!lines.length) return "";
      return lines.join(" ⏎ ") + "  [" + fontName + " · " + T.sizeWord + " " + mm.toFixed(1) + "mm]";
    }
    function limit() {
      var input = document.getElementById("add_option_0");
      var m = input ? parseInt(input.getAttribute("maxlength") || "0", 10) : 0;
      return m > 0 ? m : 100;
    }
    function render() {
      try {
        var t = document.getElementById("pvEngTxt").value;
        var out = document.getElementById("pvEngOut");
        var zone = document.getElementById("pvEngZone");
        out.textContent = t.trim() === "" ? "" : t;
        out.style.fontFamily = font;
        // 폰트 크기로 줄바꿈을 맞추고(가로 0.78배), scaleY 로 보이는 높이를 mm 로 되돌린다.
        // scaleX 는 레이아웃에 영향을 주지 않아 줄바꿈이 안 바뀐다 — 쓰면 안 된다.
        out.style.fontSize = (mm * WK * pxPerMm()) + "px";
        out.style.transform = "scaleY(" + (1 / WK) + ")";
        out.style.transformOrigin = "center";
        document.getElementById("pvEngMm").innerHTML = mm.toFixed(1) + "<span>mm</span>";
        // 사각 영역이라 가로는 고정 — 세로만 본다(설월은 원이라 줄 수마다 폭이 달랐다).
        var over = out.scrollHeight / WK > zone.clientHeight + 1;
        var tooLong = orderValue().length > limit();
        var warn = document.getElementById("pvEngWarn");
        warn.textContent = tooLong ? T.long : T.warn;
        warn.className = (t.trim() !== "" && (over || tooLong)) ? "on" : "";
      } catch (e) {}
    }
    function open() {
      css(); build();
      document.getElementById("pvEngWrap").classList.add("on");
      render();
      try { if (document.fonts && document.fonts.ready) document.fonts.ready.then(render); } catch (e) {}
      setTimeout(render, 400);
    }
    function close() { var w = document.getElementById("pvEngWrap"); if (w) w.classList.remove("on"); }
    function apply() {
      try {
        var input = document.getElementById("add_option_0");
        if (!input) { close(); return; }
        var val = orderValue();
        if (!val) { document.getElementById("pvEngTxt").focus(); return; }
        if (val.length > limit()) { render(); document.getElementById("pvEngTxt").focus(); return; }
        input.value = val;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        input.dispatchEvent(new Event("keyup", { bubbles: true }));
        close();
        try { input.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e) {}
      } catch (e) { close(); }
    }

    function mount() {
      try {
        var input = document.getElementById("add_option_0");
        if (!input) return false;
        if (document.getElementById("pvEngBtn")) return true;
        if (limit() < 60) return true;   // 각인칸이 짧으면 결과를 담을 수 없다 → 버튼을 띄우지 않는다
        css();
        var b = document.createElement("button");
        b.id = "pvEngBtn"; b.type = "button"; b.textContent = T.btn;
        b.onclick = function (e) { e.preventDefault(); open(); };
        var host = input.parentNode;
        if (host) host.appendChild(b);
        return true;
      } catch (e) { return true; }
    }
    var n = 0;
    var timer = setInterval(function () { if (mount() || ++n > 24) clearInterval(timer); }, 500);
    if (document.readyState !== "loading") mount();
    else document.addEventListener("DOMContentLoaded", mount);
  } catch (e) { /* 페일오픈 */ }
})();
