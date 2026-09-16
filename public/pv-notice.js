/*! Paulvice/Harriot 상단 띠배너 — 공지 한 줄을 헤더 **위에 자리를 만들어** 얹는다.
 *
 *  왜 우리가 만들었나: 상단 띠가 두 몰 다 우리 손 밖이었다. 폴바이스는 배너매니저 앱
 *  (관리자 UI 전용·API 없음)이 채우는 자리였고, 해리엇은 아예 꺼져 있었다.
 *  사장님 지시(2026-09-16)로 앱에서 떼어내고 이 스크립트로 옮겼다.
 *
 *  🔴 첫 버전의 실패(2026-09-16, 사장님 지적 "로고랑 메뉴를 가리고 있어"):
 *     내 마크업을 만들어 document.body 맨 앞에 끼워 넣었다. 그런데 폴바이스는
 *     `.header__wrap { position:absolute; top:0 }` 이라 헤더가 문서 흐름 밖에서 항상
 *     화면 최상단에 붙는다. 내 띠가 자리를 차지해도 헤더는 0 에 남아 **겹쳐서 덮었다.**
 *     → 교훈: **스킨이 이미 갖고 있는 띠 자리를 쓴다.** 새 마크업을 발명하지 않는다.
 *
 *  ── 몰별 처방(구조가 다르다. 한 방식으로 통일하면 한쪽이 깨진다) ──────────────
 *  · 폴바이스: 스킨 CSS 에 `.top-banner`(position:relative, height:34px, 기본 display:none)
 *    와 `.on`(display:block), `__wrap/__content/__link`(검정 바탕 흰 글씨)가 **전부 정의돼 있다.**
 *    그 클래스 구조를 그대로 만들어 **헤더 앞 형제**로 넣으면 34px 자리가 생기고 헤더가 밀린다.
 *    색·크기·모바일 분기를 내가 지정하지 않는다 — 스킨이 이미 갖고 있다.
 *  · 해리엇: 띠 전용 CSS 가 없다. 헤더 앞에 자리를 만들되 **최소한의 인라인 스타일**로 그린다.
 *
 *  ⚠️ 절대 규칙
 *   ① **페일오픈**: 어디서 실패하든 조용히 끝낸다(주입 스크립트가 해리엇 영문몰 결제를 막은 전례).
 *   ② **가리지 않는다**: position:fixed 금지. 자리를 차지해 아래를 밀어낸다.
 *   ③ **결제 흐름에선 안 뜬다**.
 *   ④ 기간·몰 판정은 **서버가** 한다. 설정값은 textContent 로만 박는다.
 */
(function () {
  "use strict";
  try {
    if (window.__pvNoticeLoaded) return;
    window.__pvNoticeLoaded = true;

    var BASE = "https://paulvice-dashboard.vercel.app";
    var host = (location.hostname || "").toLowerCase();
    var isHarriot = /harriot/.test(host);
    var mall = isHarriot ? "harriot" : "paulvice";
    var SNOOZE_KEY = "pv_notice_snooze";

    if (/\/order\/|\/member\/login|\/member\/join/i.test(location.pathname)) return;

    function snoozedUntil() {
      try { return parseInt(localStorage.getItem(SNOOZE_KEY) || "0", 10) || 0; } catch (e) { return 0; }
    }
    function snooze(h) {
      try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + h * 3600000)); } catch (e) {}
    }

    /** 띠를 넣을 자리 = 헤더 바로 앞. 없으면 body 맨 앞(최후). */
    function anchor() {
      var sel = isHarriot
        ? ["#promotionBanner", ".header_warp", "#header", "header"]
        : ["header.header", ".header", "header"];
      for (var i = 0; i < sel.length; i++) {
        var el = document.querySelector(sel[i]);
        if (el) return el;
      }
      return null;
    }

    function buildPaulvice(n) {
      // 스킨 클래스를 그대로 쓴다 — 색·높이·모바일 분기는 CSS 가 갖고 있다.
      var bar = document.createElement("div");
      bar.id = "pvNoticeBar";
      bar.className = "top-banner relative on";
      bar.setAttribute("role", "banner");

      var wrap = document.createElement("div");
      wrap.className = "top-banner__wrap flex flex--v-center flex--h-center";

      var content = document.createElement("div");
      content.className = "top-banner__content";

      var link = document.createElement(n.href ? "a" : "span");
      link.className = "top-banner__link";
      if (n.href) link.href = n.href;
      link.textContent = n.text;

      content.appendChild(link);
      wrap.appendChild(content);
      bar.appendChild(wrap);
      return bar;
    }

    function buildHarriot(n) {
      // 해리엇은 띠 CSS 가 없다 — 최소한의 인라인으로 그린다(자리를 차지하는 relative).
      var bar = document.createElement("div");
      bar.id = "pvNoticeBar";
      bar.setAttribute("role", "banner");
      bar.style.cssText = [
        "position:relative", "box-sizing:border-box", "width:100%",
        "background:" + (n.bg || "#111"), "color:" + (n.fg || "#fff"),
        "font-size:13px", "line-height:1.45", "padding:9px 40px 9px 16px",
        "text-align:center", "z-index:1",
      ].join(";");
      var inner = document.createElement(n.href ? "a" : "span");
      if (n.href) { inner.href = n.href; inner.style.cssText = "color:inherit;text-decoration:underline"; }
      inner.textContent = n.text;
      bar.appendChild(inner);
      return bar;
    }

    function render(n, snoozeHours) {
      if (!n || !n.text) return;
      if (n.dismissible && Date.now() < snoozedUntil()) return;
      if (document.getElementById("pvNoticeBar")) return;

      var host = anchor();
      if (!host || !host.parentNode) return;   // 자리를 못 찾으면 아무것도 하지 않는다(페일오픈)

      var bar = isHarriot ? buildHarriot(n) : buildPaulvice(n);

      if (n.dismissible) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.setAttribute("aria-label", "공지 닫기");
        btn.textContent = "×";
        btn.style.cssText = [
          "position:absolute", "right:12px", "top:50%", "transform:translateY(-50%)",
          "background:none", "border:0", "color:#fff", "font-size:18px",
          "line-height:1", "cursor:pointer", "padding:4px 6px", "opacity:.75", "z-index:2",
        ].join(";");
        btn.addEventListener("click", function () {
          snooze(snoozeHours || 24);
          if (bar.parentNode) bar.parentNode.removeChild(bar);
        });
        bar.appendChild(btn);
      }

      // 헤더 **앞 형제**로 삽입 — 자리가 생기면서 헤더가 아래로 밀린다.
      host.parentNode.insertBefore(bar, host);
    }

    function load() {
      try {
        var xhr = new XMLHttpRequest();
        xhr.open("GET", BASE + "/api/storefront/notice?mall=" + mall, true);
        xhr.timeout = 8000;
        xhr.onload = function () {
          try {
            if (xhr.status < 200 || xhr.status >= 300) return;
            var j = JSON.parse(xhr.responseText || "{}");
            render(j.notice, j.snoozeHours);
          } catch (e) {}
        };
        xhr.onerror = function () {};
        xhr.ontimeout = function () {};
        xhr.send();
      } catch (e) {}
    }

    // 헤더가 늦게 그려지는 스킨이 있어 DOM 준비 후에 붙인다.
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load);
    else load();
  } catch (e) { /* 페일오픈 — 무슨 일이 있어도 페이지를 깨뜨리지 않는다 */ }
})();
