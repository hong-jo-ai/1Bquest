/*! 해리엇 설월(#136) 각인 미리보기 — 2026-09-25
 *  설계 원칙(전례 기반):
 *   1) 페일오픈: 어디서 실패하든 조용히 끝낸다. 기존 각인 입력란은 그대로 동작해야 한다.
 *   2) 가리지 않는다: 모달은 명시적 클릭으로만 열린다. 구매 버튼을 덮지 않는다.
 *   3) 설월 상세페이지에서만 동작. 그 외 페이지에서는 아무것도 하지 않는다.
 *  롤백: 카페24 스크립트태그만 삭제하면 원상복구.
 */
(function () {
  "use strict";
  try {
    if (!/\/product\/detail\.html/.test(location.pathname)) return;
    var pno = (location.search.match(/[?&]product_no=(\d+)/) || [])[1];
    if (pno !== "136") return;

    var IMG = "https://ecimg.cafe24img.com/pg2772b24326326016/harriotkorea/web/upload/engrave/caseback.jpg";
    var FONTS = [
      { n: "나눔고딕", f: "'Nanum Gothic',sans-serif", t: "한글" },
      { n: "나눔명조", f: "'Nanum Myeongjo',serif", t: "한글" },
      { n: "Arial", f: "Arial,Helvetica,sans-serif", t: "영문" },
      { n: "Times New Roman", f: "'Times New Roman',Times,serif", t: "영문" }
    ];
    var font = FONTS[3].f, fontName = FONTS[3].n, pt = 7;

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
        '#hrtEngStage{position:relative;width:100%;max-width:184px;margin:0 auto 4px;background:#f1f1ef;border-radius:10px;overflow:hidden}' +
        '#hrtEngStage img{display:block;width:100%;height:auto}' +
        '#hrtEngZone{position:absolute;left:50.3%;top:50%;transform:translate(-50%,-50%);width:26.5%;height:21%;' +
        'display:flex;align-items:center;justify-content:center;overflow:hidden;text-align:center}' +
        '#hrtEngOut{margin:0;color:#8d949a;white-space:pre-wrap;word-break:keep-all;overflow-wrap:break-word;line-height:1.28;text-shadow:0 1px 1px rgba(255,255,255,.45)}' +
        '#hrtEngScale{text-align:center;color:#6e7479;font-size:10.5px;margin:0 0 12px}' +
        '#hrtEngTxt{width:100%;min-height:48px;resize:vertical;padding:10px;border:1px solid #dcdcd8;border-radius:7px;font:inherit;font-size:14px;box-sizing:border-box}' +
        '#hrtEngBox .lb{display:block;font-size:11px;letter-spacing:.06em;color:#6e7479;margin:0 0 6px;text-transform:uppercase}' +
        '#hrtEngFonts{display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-top:11px}' +
        '#hrtEngFonts button{padding:8px 5px;border:1px solid #dcdcd8;border-radius:7px;background:#fff;color:#14161a;cursor:pointer;font-size:14px}' +
        '#hrtEngFonts button[aria-pressed="true"]{border-color:#111;box-shadow:0 0 0 1px #111}' +
        '#hrtEngFonts small{display:block;font-size:10px;color:#6e7479;margin-top:3px;font-family:-apple-system,sans-serif}' +
        '#hrtEngSizeRow{display:flex;align-items:baseline;justify-content:space-between;margin:12px 0 4px}' +
        '#hrtEngPt{font-size:17px;font-weight:600}#hrtEngPt span{font-size:12px;font-weight:400;color:#6e7479}' +
        '#hrtEngMm{font-size:11px;color:#6e7479}' +
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
        '<div id="hrtEngDim"></div><div id="hrtEngBox" role="dialog" aria-modal="true" aria-label="각인 미리보기">' +
        '<button id="hrtEngX" type="button" aria-label="닫기">&times;</button>' +
        '<h3>당신의 시간을 새깁니다</h3>' +
        '<p class="sb">앞면이 시간을 보여주는 동안, 뒷면에는 당신의 문장이 남습니다.</p>' +
        '<div id="hrtEngScroll">' +
        '<div id="hrtEngStage"><img src="' + IMG + '" alt="설월 케이스백"><div id="hrtEngZone"><p id="hrtEngOut"></p></div></div>' +
        '<p id="hrtEngScale">각인면 지름 20mm · 실제 비율로 표시됩니다</p>' +
        '<span class="lb">각인 문구</span>' +
        '<textarea id="hrtEngTxt" placeholder="예) 2026.09.25&#10;사랑하는 당신에게" spellcheck="false"></textarea>' +
        '<div id="hrtEngFonts"></div>' +
        '<div id="hrtEngSizeRow"><span class="lb" style="margin:0">글자 크기 기준</span>' +
        '<div><span id="hrtEngPt">7.0<span>pt</span></span> <span id="hrtEngMm">≈ 2.5mm</span></div></div>' +
        '<input type="range" id="hrtEngSize" min="3" max="14" value="7" step="0.5" aria-label="글자 크기 기준">' +
        '<p id="hrtEngWarn">⚠ 각인면을 넘칩니다. 크기를 줄이거나 문구를 짧게 해주세요.</p>' +
        '</div>' +
        '<p id="hrtEngNote"><b>화면은 참고용이며 실제와 똑같이 새겨지는 것을 보장하지 않습니다.</b> 굵기·자간·줄 간격이 다를 수 있고 크기도 각인 장비에서 조정됩니다. 전달되는 것은 <b>문구 · 서체 · 줄바꿈 위치 · 크기 기준</b>입니다.</p>' +
        '<button id="hrtEngApply" type="button">이 문구로 신청하기</button></div>';
      document.body.appendChild(w);

      var fw = w.querySelector("#hrtEngFonts");
      FONTS.forEach(function (o, i) {
        var b = document.createElement("button");
        b.type = "button";
        b.setAttribute("aria-pressed", i === 3 ? "true" : "false");
        b.innerHTML = o.n + "<small>" + o.t + (i === 3 ? " · 기본" : "") + "</small>";
        b.onclick = function () {
          [].forEach.call(fw.children, function (x) { x.setAttribute("aria-pressed", "false"); });
          b.setAttribute("aria-pressed", "true");
          font = o.f; fontName = o.n; render();
        };
        fw.appendChild(b);
      });

      w.querySelector("#hrtEngDim").onclick = close;
      w.querySelector("#hrtEngX").onclick = close;
      w.querySelector("#hrtEngTxt").addEventListener("input", render);
      w.querySelector("#hrtEngSize").addEventListener("input", function () { pt = parseFloat(this.value); render(); });
      w.querySelector("#hrtEngApply").onclick = apply;
      document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
    }

    function pxPerPt() {
      var st = document.getElementById("hrtEngStage");
      return 0.3528 * 16 * (st.clientWidth / 1093);
    }
    function render() {
      try {
        var t = document.getElementById("hrtEngTxt").value;
        var out = document.getElementById("hrtEngOut");
        var zone = document.getElementById("hrtEngZone");
        out.textContent = t.trim() === "" ? "" : t;
        out.style.fontFamily = font;
        out.style.fontSize = (pt * pxPerPt()) + "px";
        document.getElementById("hrtEngPt").innerHTML = pt.toFixed(1) + "<span>pt</span>";
        document.getElementById("hrtEngMm").textContent = "≈ " + (pt * 0.3528).toFixed(1) + "mm";
        var over = out.scrollHeight > zone.clientHeight + 1;
        document.getElementById("hrtEngWarn").className = (over && t.trim() !== "") ? "on" : "";
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
        var v = document.getElementById("hrtEngTxt").value.replace(/\s+$/, "");
        var input = document.getElementById("add_option_0");
        if (!input) { close(); return; }
        if (!v.trim()) { document.getElementById("hrtEngTxt").focus(); return; }
        var lines = v.split("\n").map(function (s) { return s.trim(); }).filter(function (s) { return s !== ""; });
        var val = lines.join(" ⏎ ") + "  [" + fontName + " · 크기기준 " + pt.toFixed(1) + "pt]";
        if (val.length > 100) val = val.slice(0, 100);
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
        css();
        var b = document.createElement("button");
        b.id = "hrtEngBtn"; b.type = "button"; b.textContent = "각인 미리보기";
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
