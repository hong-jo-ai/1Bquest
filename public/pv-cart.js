/*! Paulvice/Harriot 장바구니 이탈 추적 — 로그인 회원의 '담기'를 우리 백엔드로 전송.
 *  스킨에서 window.__PV = { mall, memberId, productNo, productName } 를 먼저 세팅해야 함
 *  ({$member_id} 는 서버렌더 변수라 client 에서 직접 못 얻음).
 *  담기 감지: ①카페24 basket 엔드포인트 네트워크 후킹(정확) ②.actionCart 클릭 폴백.
 *  비로그인(memberId 없음)은 추적 안 함. 같은 상품 2.5초 내 중복 전송 방지.
 */
(function () {
  "use strict";
  var API = "https://paulvice-dashboard.vercel.app/api/crm/cart-event";
  var cfg = window.__PV || {};

  // 몰: __PV.mall 우선, 없으면 호스트로 판별.
  var host = location.hostname || "";
  var mall = cfg.mall || (/harriot/i.test(host) ? "harriot" : "paulvice");
  var memberId = (cfg.memberId || "").toString().trim();
  if (!memberId) return; // 비로그인 → 추적 안 함

  function productNo() {
    var n = cfg.productNo || window.iProductNo || "";
    n = parseInt(String(n).replace(/\D/g, ""), 10);
    return n > 0 ? n : null;
  }
  function productName() {
    if (cfg.productName) return String(cfg.productName).slice(0, 200);
    var el = document.querySelector(".headingArea h2, .infoArea .name, .xans-product-detail .name, .product_name");
    return el ? (el.textContent || "").trim().slice(0, 200) : null;
  }
  function quantity() {
    var q = document.querySelector("#quantity, input[name='quantity'], input[name='quantity_opt[]']");
    var v = q ? parseInt(q.value, 10) : 1;
    return v > 0 ? v : 1;
  }

  var lastFire = {}; // productNo -> ts (중복방지)
  function track() {
    var pno = productNo();
    var key = String(pno || "x");
    var now = Date.now();
    if (lastFire[key] && now - lastFire[key] < 2500) return;
    lastFire[key] = now;

    var payload = JSON.stringify({
      mall: mall, memberId: memberId, productNo: pno,
      productName: productName(), quantity: quantity(),
    });
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(API, new Blob([payload], { type: "application/json" }));
      } else {
        fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, keepalive: true, mode: "cors" });
      }
    } catch (e) { /* 무시 */ }
  }

  var BASKET_RE = /\/exec\/front\/order\/basket/i;

  // ① fetch 후킹
  if (window.fetch) {
    var of = window.fetch;
    window.fetch = function (input) {
      try {
        var u = typeof input === "string" ? input : (input && input.url) || "";
        if (BASKET_RE.test(u)) setTimeout(track, 50);
      } catch (e) {}
      return of.apply(this, arguments);
    };
  }
  // ① XHR 후킹
  var oo = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    try { if (BASKET_RE.test(String(url || ""))) this.__pvBasket = true; } catch (e) {}
    return oo.apply(this, arguments);
  };
  var os = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function () {
    try { if (this.__pvBasket) setTimeout(track, 50); } catch (e) {}
    return os.apply(this, arguments);
  };

  // ② 폴백: 장바구니 버튼 클릭(네트워크 후킹이 못 잡는 form-submit 대비)
  document.addEventListener("click", function (e) {
    var t = e.target;
    for (var i = 0; i < 4 && t; i++) {
      if (t.classList && t.classList.contains("actionCart")) { setTimeout(track, 300); return; }
      t = t.parentElement;
    }
  }, true);
})();
