/*! 해리엇 설월(#136) 각인 미리보기 — 2026-09-25 (영문몰 대응 2026-09-26)
 *  설계 원칙(전례 기반):
 *   1) 페일오픈: 어디서 실패하든 조용히 끝낸다. 기존 각인 입력란은 그대로 동작해야 한다.
 *   2) 가리지 않는다: 모달은 명시적 클릭으로만 열린다. 구매 버튼을 덮지 않는다.
 *   3) 설월 상세페이지에서만 동작. 그 외 페이지에서는 아무것도 하지 않는다.
 *   4) 자르지 않는다: 각인 입력란 maxlength 를 넘으면 조용히 잘라 넣는 대신 신청을 막는다.
 *      잘린 각인은 되돌릴 수 없다(서체·줄바꿈 정보가 통째로 날아간다).
 *  국문몰(shop1)·영문몰(shop2) 한 파일로 처리한다 — 스크립트태그만 몰별로 등록.
 *  롤백: 카페24 스크립트태그만 삭제하면 원상복구.
 */
(function () {
  "use strict";
  try {
    // ── 상품번호 ── 카페24는 같은 상품에 URL 이 두 벌이다:
    //    /product/detail.html?product_no=136  과  /product/설월/136/  (SEO 주소, 메인 배너가 쓴다)
    //    쿼리만 보면 SEO 주소로 들어온 고객에겐 버튼이 안 뜬다(2026-09-26 실측).
    function productNo() {
      var q = (location.search.match(/[?&]product_no=(\d+)/) || [])[1];
      if (q) return q;
      var m = location.pathname.match(/\/product\/[^\/?]+\/(\d+)(?:[\/?]|$)/);
      if (m) return m[1];
      var c = document.querySelector('link[rel="canonical"]');
      if (c) { var cm = String(c.href || "").match(/\/product\/[^\/?]+\/(\d+)(?:[\/?]|$)/); if (cm) return cm[1]; }
      return null;
    }
    if (productNo() !== "136") return;

    var IMG = "https://ecimg.cafe24img.com/pg2772b24326326016/harriotkorea/web/upload/engrave/caseback.jpg";

    // ── 몰 언어 ── shop2 = 영문몰. html lang 은 두 몰 다 "ko" 라 신호가 안 된다(2026-09-26 실측).
    //    경로가 1순위, 각인칸 라벨이 2순위(영문몰이 나중에 자체 도메인을 받아도 살아남게).
    function isEn() {
      if (/(^|\/)shop2(\/|$)/.test(location.pathname)) return true;
      var th = document.querySelector(".xans-product-addoption th");
      if (th && /engraving/i.test(th.textContent || "")) return true;
      return false;
    }
    var EN = isEn();

    var T = EN ? {
      btn: "Preview your engraving",
      title: "Engrave your time",
      sub: "The dial shows the hours. The caseback keeps your words.",
      scale: "Engraving face 20mm across · shown at actual scale",
      label: "Engraving message",
      ph: "e.g. 2026.09.26\nFor the one I love",
      size: "Letter height",
      warn: "⚠ This runs past the engraving face. Reduce the size or shorten the text.",
      long: "⚠ Too long to send with the order. Please shorten the text.",
      note: "<b>This preview is a guide and does not guarantee the exact engraved result.</b> Weight, letter spacing and line spacing may differ, and the size is adjusted on the engraving machine. What reaches us is <b>your text, typeface, line breaks and letter height</b>.",
      apply: "Use this engraving",
      hint: "Most engravings sit between 2.3 and 2.7mm — larger for short lines, smaller for long ones.",
      close: "Close",
      dialog: "Engraving preview",
      tagKo: "Korean", tagEn: "Latin", def: " · default",
      sizeWord: "height"
    } : {
      btn: "각인 미리보기",
      title: "당신의 시간을 새깁니다",
      sub: "앞면이 시간을 보여주는 동안, 뒷면에는 당신의 문장이 남습니다.",
      scale: "각인면 지름 20mm · 실제 비율로 표시됩니다",
      label: "각인 문구",
      ph: "예) 2026.09.26\n사랑하는 당신에게",
      size: "글자 높이",
      warn: "⚠ 각인면을 넘칩니다. 크기를 줄이거나 문구를 짧게 해주세요.",
      long: "⚠ 주문서에 담기엔 문구가 깁니다. 조금만 줄여주세요.",
      note: "<b>화면은 참고용이며 실제와 똑같이 새겨지는 것을 보장하지 않습니다.</b> 굵기·자간·줄 간격이 다를 수 있고 크기도 각인 장비에서 조정됩니다. 전달되는 것은 <b>문구 · 서체 · 줄바꿈 위치 · 글자 높이</b>입니다.",
      apply: "이 문구로 신청하기",
      hint: "대부분 2.3~2.7mm 사이로 새깁니다 — 문구가 짧으면 크게, 길면 작게.",
      close: "닫기",
      dialog: "각인 미리보기",
      tagKo: "한글", tagEn: "영문", def: " · 기본",
      sizeWord: "높이"
    };

    // 서체는 두 몰 모두 4종. ⚠️ 영문몰이라고 한글 서체를 빼면 안 된다 —
    // 영문몰로 한글 각인 주문이 실제로 들어온다(윤동주 서시 27자, 2026-09-11).
    var FONTS = [
      { n: "나눔고딕", en: "Nanum Gothic", f: "'Nanum Gothic',sans-serif", t: "ko" },
      { n: "나눔명조", en: "Nanum Myeongjo", f: "'Nanum Myeongjo',serif", t: "ko" },
      { n: "Arial", en: "Arial", f: "Arial,Helvetica,sans-serif", t: "en" },
      { n: "Times New Roman", en: "Times New Roman", f: "'Times New Roman',Times,serif", t: "en" }
    ];
    var DEF = 3; // 설월 기본 = Times New Roman (사장님 2026-09-18)
    // 각인 프로그램은 pt 가 아니라 **글자 높이(mm)** 로 크기를 정한다(사장님 2026-09-26).
    // 실제로 가장 많이 쓰는 값: 짧은 문구 2.7mm · 긴 문구 2.3~2.5mm → 기본 2.5mm.
    var font = FONTS[DEF].f, fontName = EN ? FONTS[DEF].en : FONTS[DEF].n, mm = 2.5;

    function css() {
      if (document.getElementById("hrtEngCss")) return;
      var s = document.createElement("style");
      s.id = "hrtEngCss";
      s.textContent =
        '#hrtEngBtn{display:block;width:100%;box-sizing:border-box;margin:10px 0 2px;padding:13px 12px;' +
        'border:1.5px solid #111;border-radius:6px;background:#fff;color:#111;font-size:14px;font-weight:700;' +
        'cursor:pointer;letter-spacing:.01em;line-height:1.2;text-align:center}' +
        '#hrtEngBtn:hover{background:#111;color:#fff}' +
        '#hrtEngBtn:active{background:#111;color:#fff}' +
        '#hrtEngWrap{position:fixed;inset:0;z-index:99999;display:none;align-items:center;justify-content:center;padding:16px}' +
        '#hrtEngWrap.on{display:flex}' +
        '#hrtEngDim{position:absolute;inset:0;background:rgba(0,0,0,.55)}' +
        '#hrtEngBox{position:relative;background:#fff;color:#14161a;border-radius:12px;max-width:430px;width:100%;' +
        'max-height:94vh;display:flex;flex-direction:column;padding:16px 18px 12px;font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;line-height:1.6}' +
        '#hrtEngBox h3{font-family:"Nanum Myeongjo",serif;font-weight:400;font-size:19px;margin:0 0 5px;flex:none}' +
        '#hrtEngScroll{overflow-y:auto;flex:1;min-height:0;-webkit-overflow-scrolling:touch}' +
        '#hrtEngBox .sb{color:#6e7479;font-size:12.5px;margin:0 0 12px;line-height:1.6;flex:none}' +
        '#hrtEngX{position:absolute;top:12px;right:14px;border:0;background:none;font-size:22px;color:#6e7479;cursor:pointer;line-height:1}' +
        '#hrtEngStage{position:relative;width:100%;max-width:204px;margin:0 auto 3px;background:#f1f1ef;border-radius:10px;overflow:hidden}' +
        '#hrtEngStage img{display:block;width:100%;height:auto}' +
        '#hrtEngZone{position:absolute;left:50.3%;top:50%;transform:translate(-50%,-50%);width:26.5%;height:21%;' +
        'display:flex;align-items:center;justify-content:center;overflow:hidden;text-align:center}' +
        '#hrtEngOut{margin:0;color:#8d949a;white-space:pre-wrap;word-break:keep-all;overflow-wrap:break-word;line-height:1.28;text-shadow:0 1px 1px rgba(255,255,255,.45)}' +
        '#hrtEngScale{text-align:center;color:#6e7479;font-size:10.5px;margin:0 0 9px}' +
        '#hrtEngTxt{width:100%;min-height:44px;resize:vertical;padding:10px;border:1px solid #dcdcd8;border-radius:7px;font:inherit;font-size:14px;box-sizing:border-box}' +
        '#hrtEngBox .lb{display:block;font-size:11px;letter-spacing:.06em;color:#6e7479;margin:0 0 6px;text-transform:uppercase}' +
        '#hrtEngFonts{display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:9px}' +
        '#hrtEngFonts button{padding:5px 4px;border:1px solid #dcdcd8;border-radius:6px;background:#fff;color:#14161a;cursor:pointer;font-size:12.5px;line-height:1.25}' +
        '#hrtEngFonts button[aria-pressed="true"]{border-color:#111;box-shadow:0 0 0 1px #111}' +
        '#hrtEngFonts small{display:block;font-size:9px;color:#6e7479;margin-top:1px;font-family:-apple-system,sans-serif}' +
        '#hrtEngSizeRow{display:flex;align-items:baseline;justify-content:space-between;margin:8px 0 2px}' +
        '#hrtEngPt{font-size:17px;font-weight:600}#hrtEngPt span{font-size:12px;font-weight:400;color:#6e7479}' +
        '#hrtEngHint{font-size:10.5px;color:#6e7479;margin:4px 0 0;line-height:1.45}' +
        '#hrtEngSize{width:100%;accent-color:#111}' +
        '#hrtEngWarn{margin:8px 0 0;font-size:12px;color:#a8552a;display:none}#hrtEngWarn.on{display:block}' +
        '#hrtEngNote{flex:none;font-size:10.5px;color:#6e7479;margin:9px 0 0;padding-top:9px;border-top:1px solid #dcdcd8;line-height:1.45}' +
        '#hrtEngNote b{color:#14161a}' +
        '#hrtEngApply{width:100%;flex:none;margin-top:9px;padding:14px;border:0;border-radius:7px;background:#111;color:#fff;font-size:14px;font-weight:600;cursor:pointer}';
      document.head.appendChild(s);
      if (!document.getElementById("hrtEngFont")) {
        var l = document.createElement("link");
        l.id = "hrtEngFont"; l.rel = "stylesheet";
        l.href = "https://fonts.googleapis.com/css2?family=Nanum+Gothic&family=Nanum+Myeongjo&display=swap";
        document.head.appendChild(l);
      }
    }

    function build() {
      if (document.getElementById("hrtEngWrap")) return;
      var w = document.createElement("div");
      w.id = "hrtEngWrap";
      w.innerHTML =
        '<div id="hrtEngDim"></div><div id="hrtEngBox" role="dialog" aria-modal="true" aria-label="' + T.dialog + '">' +
        '<button id="hrtEngX" type="button" aria-label="' + T.close + '">&times;</button>' +
        '<h3>' + T.title + '</h3>' +
        '<p class="sb">' + T.sub + '</p>' +
        '<div id="hrtEngScroll">' +
        '<div id="hrtEngStage"><img src="' + IMG + '" alt="SEOLWOL caseback"><div id="hrtEngZone"><p id="hrtEngOut"></p></div></div>' +
        '<p id="hrtEngScale">' + T.scale + '</p>' +
        '<span class="lb">' + T.label + '</span>' +
        '<textarea id="hrtEngTxt" spellcheck="false"></textarea>' +
        '<div id="hrtEngFonts"></div>' +
        '<div id="hrtEngSizeRow"><span class="lb" style="margin:0">' + T.size + '</span>' +
        '<span id="hrtEngPt">2.5<span>mm</span></span></div>' +
        '<input type="range" id="hrtEngSize" min="1.5" max="4" value="2.5" step="0.1" aria-label="' + T.size + '">' +
        '<p id="hrtEngHint">' + T.hint + '</p>' +
        '<p id="hrtEngWarn"></p>' +
        '</div>' +
        '<p id="hrtEngNote">' + T.note + '</p>' +
        '<button id="hrtEngApply" type="button">' + T.apply + '</button></div>';
      document.body.appendChild(w);
      w.querySelector("#hrtEngTxt").placeholder = T.ph;

      var fw = w.querySelector("#hrtEngFonts");
      FONTS.forEach(function (o, i) {
        var b = document.createElement("button");
        b.type = "button";
        b.setAttribute("aria-pressed", i === DEF ? "true" : "false");
        b.innerHTML = (EN ? o.en : o.n) +
          "<small>" + (o.t === "ko" ? T.tagKo : T.tagEn) + (i === DEF ? T.def : "") + "</small>";
        b.onclick = function () {
          [].forEach.call(fw.children, function (x) { x.setAttribute("aria-pressed", "false"); });
          b.setAttribute("aria-pressed", "true");
          font = o.f; fontName = EN ? o.en : o.n; render();
        };
        fw.appendChild(b);
      });

      w.querySelector("#hrtEngDim").onclick = close;
      w.querySelector("#hrtEngX").onclick = close;
      w.querySelector("#hrtEngTxt").addEventListener("input", render);
      w.querySelector("#hrtEngSize").addEventListener("input", function () { mm = parseFloat(this.value); render(); });
      w.querySelector("#hrtEngApply").onclick = apply;
      document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
    }

    /** 1mm 가 화면에서 몇 px 인가. 원본 1093px 이미지에서 각인면(지름 20mm) = 320px → 1mm = 16px. */
    function pxPerMm() {
      var st = document.getElementById("hrtEngStage");
      return 16 * (st.clientWidth / 1093);
    }
    /** 주문서 각인란에 들어갈 한 줄. 문구 + 줄바꿈 위치(⏎) + 서체 + 글자 높이(mm). */
    function orderValue() {
      var v = document.getElementById("hrtEngTxt").value.replace(/\s+$/, "");
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
        var t = document.getElementById("hrtEngTxt").value;
        var out = document.getElementById("hrtEngOut");
        var zone = document.getElementById("hrtEngZone");
        out.textContent = t.trim() === "" ? "" : t;
        out.style.fontFamily = font;
        out.style.fontSize = (mm * pxPerMm()) + "px";
        document.getElementById("hrtEngPt").innerHTML = mm.toFixed(1) + "<span>mm</span>";
        // 가로 넘침은 줄바꿈으로 해소되니 세로만 본다.
        var over = out.scrollHeight > zone.clientHeight + 1;
        var tooLong = orderValue().length > limit();
        var warn = document.getElementById("hrtEngWarn");
        warn.textContent = tooLong ? T.long : T.warn;
        warn.className = (t.trim() !== "" && (over || tooLong)) ? "on" : "";
      } catch (e) {}
    }
    function open() {
      css(); build();
      document.getElementById("hrtEngWrap").classList.add("on");
      render();
      try { if (document.fonts && document.fonts.ready) document.fonts.ready.then(render); } catch (e) {}
      setTimeout(render, 400);
    }
    function close() { var w = document.getElementById("hrtEngWrap"); if (w) w.classList.remove("on"); }
    function apply() {
      try {
        var input = document.getElementById("add_option_0");
        if (!input) { close(); return; }
        var val = orderValue();
        if (!val) { document.getElementById("hrtEngTxt").focus(); return; }
        // 자르지 않는다 — 잘리면 서체·줄바꿈이 통째로 사라진 채 각인된다.
        if (val.length > limit()) { render(); document.getElementById("hrtEngTxt").focus(); return; }
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
        if (document.getElementById("hrtEngBtn")) return true;
        // 각인란이 너무 짧으면 미리보기 결과를 담을 수 없다 → 버튼 자체를 안 띄운다.
        // (영문몰이 30자였다. 카페24에서 100자로 올리면 그때부터 자동으로 나타난다.)
        if (limit() < 60) return true;
        css();
        var b = document.createElement("button");
        b.id = "hrtEngBtn"; b.type = "button"; b.textContent = T.btn;
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
