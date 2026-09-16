/*! Paulvice/Harriot 상단 띠배너 — 공지 한 줄을 페이지 맨 위에 얹는다.
 *
 *  왜 우리가 만들었나: 상단 띠가 두 몰 다 우리 손 밖에 있었다. 폴바이스는 배너매니저 앱
 *  (관리자 UI 전용·API 없음)이 채우는 자리였고, 해리엇은 아예 꺼져 있었다.
 *  사장님 지시(2026-09-16)로 앱에서 떼어내고 이 스크립트로 옮겼다. 이제 문구·기간 변경이
 *  KV 설정만으로 끝난다 — 스킨을 다시 만지지 않는다.
 *
 *  ⚠️ 절대 규칙
 *   ① **페일오픈**: 어디서 실패하든 조용히 끝낸다. 주입 스크립트 하나가 해리엇 영문몰 결제를
 *      막은 적이 있다. 배너가 안 뜨는 건 사고가 아니지만 페이지가 깨지는 건 사고다.
 *   ② **가리지 않는다**: 팝업이 아니라 문서 맨 위에 **자리를 차지하는** 띠다. 2026-07 웰컴팝업이
 *      상세페이지 구매버튼을 덮어 주문이 5~8건/일 → 1~3건/일로 떨어진 전례가 있다.
 *      position:fixed 를 쓰지 않는 이유가 이것이다.
 *   ③ **결제 흐름에선 안 뜬다**: 주문서·로그인에서 화면을 흔들지 않는다.
 *   ④ 기간·몰 판정은 **서버가** 한다. 여기서 날짜를 계산하지 않는다(브라우저 시계·캐시 불신).
 */
(function () {
  "use strict";
  try {
    if (window.__pvNoticeLoaded) return;
    window.__pvNoticeLoaded = true;

    var BASE = "https://paulvice-dashboard.vercel.app";
    var host = (location.hostname || "").toLowerCase();
    var mall = /harriot/.test(host) ? "harriot" : "paulvice";
    var SNOOZE_KEY = "pv_notice_snooze";

    // 결제·로그인 흐름에서는 어떤 개입도 하지 않는다.
    if (/\/order\/|\/member\/login|\/member\/join/i.test(location.pathname)) return;

    function snoozedUntil() {
      try { return parseInt(localStorage.getItem(SNOOZE_KEY) || "0", 10) || 0; } catch (e) { return 0; }
    }
    function snooze(hours) {
      try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + hours * 3600000)); } catch (e) {}
    }

    function render(n, snoozeHours) {
      if (!n || !n.text) return;
      if (n.dismissible && Date.now() < snoozedUntil()) return;

      var bar = document.createElement("div");
      bar.id = "pvNoticeBar";
      bar.setAttribute("role", "region");
      bar.setAttribute("aria-label", "공지");
      bar.style.cssText = [
        "box-sizing:border-box", "width:100%", "position:relative", "z-index:900",
        "background:" + (n.bg || "#111"), "color:" + (n.fg || "#fff"),
        "font-size:13px", "line-height:1.45", "letter-spacing:-0.01em",
        "padding:9px 40px 9px 16px", "text-align:center",
        "font-family:inherit",
      ].join(";");

      var inner;
      if (n.href) {
        inner = document.createElement("a");
        inner.href = n.href;
        inner.style.cssText = "color:inherit;text-decoration:underline;text-underline-offset:2px";
      } else {
        inner = document.createElement("span");
      }
      // ⚠️ textContent — 설정값을 HTML 로 넣지 않는다.
      inner.textContent = n.text;
      bar.appendChild(inner);

      if (n.dismissible) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.setAttribute("aria-label", "공지 닫기");
        btn.textContent = "×";
        btn.style.cssText = [
          "position:absolute", "right:10px", "top:50%", "transform:translateY(-50%)",
          "background:none", "border:0", "color:inherit", "font-size:18px",
          "line-height:1", "cursor:pointer", "padding:4px 6px", "opacity:.75",
        ].join(";");
        btn.addEventListener("click", function () {
          snooze(snoozeHours || 24);
          if (bar.parentNode) bar.parentNode.removeChild(bar);
        });
        bar.appendChild(btn);
      }

      // 문서 맨 위. 덮지 않고 아래를 밀어낸다.
      if (document.body.firstChild) document.body.insertBefore(bar, document.body.firstChild);
      else document.body.appendChild(bar);
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
          } catch (e) { /* 페일오픈 */ }
        };
        xhr.onerror = function () {};
        xhr.ontimeout = function () {};
        xhr.send();
      } catch (e) { /* 페일오픈 */ }
    }

    if (document.body) load();
    else document.addEventListener("DOMContentLoaded", load);
  } catch (e) { /* 페일오픈 — 무슨 일이 있어도 페이지를 깨뜨리지 않는다 */ }
})();
