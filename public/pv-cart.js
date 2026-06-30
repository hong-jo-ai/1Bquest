/*! Paulvice/Harriot 장바구니 이탈 추적 — 로그인 회원의 '담기'를 우리 백엔드로 전송.
 *  회원 식별: 카페24 프론트 SDK CAFE24API.getCustomerIDInfo (비동기). 회원ID 오기 전 담기는
 *  큐에 쌓았다가 조회 후 전송. 담기 감지: product_submit 래핑(주) + basket 네트워크/클릭(폴백).
 *  비로그인(member_id 없음)은 추적 안 함. 같은상품 2.5초 중복방지.
 *  스킨엔 <script src=".../pv-cart.js"> 한 줄만 있으면 됨(window.__PV는 선택).
 */
(function () {
  "use strict";
  var API = "https://paulvice-dashboard.vercel.app/api/crm/cart-event";
  var PV = window.__PV || {};
  var host = location.hostname || "";
  var isHarriot = /harriot/i.test(host);
  var mall = PV.mall || (isHarriot ? "harriot" : "paulvice");
  var CLIENT_ID = isHarriot ? "7eMH5F8YOqwTdkXwj54CNF" : "EQ0iU3bbCZNhLSdvtJg1eG";
  var SDK_VERSION = "2024-06-01";

  var memberId = null, resolved = false, pending = [];

  function whenSdk(cb, tries) {
    tries = tries || 0;
    if (window.CAFE24API && typeof window.CAFE24API.getCustomerIDInfo === "function") return cb();
    if (tries > 20) return;
    setTimeout(function () { whenSdk(cb, tries + 1); }, 500);
  }
  whenSdk(function () {
    try { window.CAFE24API.init({ client_id: CLIENT_ID, version: SDK_VERSION }); } catch (e) {}
    try {
      window.CAFE24API.getCustomerIDInfo(function (err, data) {
        try { memberId = (data && data.id && data.id.member_id) || null; } catch (e) {}
        resolved = true;
        if (memberId) flush(); else pending.length = 0; // 비로그인 → 큐 폐기
      });
    } catch (e) { resolved = true; }
  });

  function productNo() {
    var raw = window.iProductNo != null ? window.iProductNo : PV.productNo;
    var n = parseInt(String(raw == null ? "" : raw).replace(/\D/g, ""), 10);
    return n > 0 ? n : null;
  }
  function productName() {
    var el = document.querySelector(".headingArea .name, .headingArea h2, .infoArea .name, .xans-product-detail .name, .product_name");
    return el ? (el.textContent || "").trim().slice(0, 200) : null;
  }
  function quantity() {
    var q = document.querySelector("#quantity, input[name='quantity'], input[name='quantity_opt[]']");
    var v = q ? parseInt(q.value, 10) : 1;
    return v > 0 ? v : 1;
  }

  function send(ev) {
    ev.memberId = memberId; // 전송 시점의 회원ID
    var payload = JSON.stringify(ev);
    try {
      if (navigator.sendBeacon) navigator.sendBeacon(API, new Blob([payload], { type: "application/json" }));
      else fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, keepalive: true, mode: "cors" });
    } catch (e) {}
  }
  function flush() { while (pending.length) send(pending.shift()); }

  var lastFire = {};
  function track() {
    var pno = productNo(), key = String(pno || "x"), now = Date.now();
    if (lastFire[key] && now - lastFire[key] < 2500) return;
    lastFire[key] = now;
    var ev = { mall: mall, productNo: pno, productName: productName(), quantity: quantity() };
    if (memberId) send(ev);
    else if (!resolved) pending.push(ev); // 회원ID 조회 전 → 큐잉(조회 후 flush)
    // resolved && !memberId → 비로그인 → 버림
  }

  // ① product_submit 래핑 — 카페24 담기 정규 함수(가장 확실, AJAX/폼 무관)
  function wrapSubmit(tries) {
    tries = tries || 0;
    if (typeof window.product_submit === "function") {
      if (!window.product_submit.__pv) {
        var orig = window.product_submit;
        var w = function (type, url) {
          try { if (/basket/i.test(String(url || ""))) track(); } catch (e) {}
          return orig.apply(this, arguments);
        };
        w.__pv = true;
        window.product_submit = w;
      }
      return;
    }
    if (tries > 20) return;
    setTimeout(function () { wrapSubmit(tries + 1); }, 500);
  }
  wrapSubmit();

  // ② basket 엔드포인트 네트워크 후킹(폴백)
  var BASKET_RE = /\/exec\/front\/order\/basket/i;
  if (window.fetch) {
    var of = window.fetch;
    window.fetch = function (input) {
      try { var u = typeof input === "string" ? input : (input && input.url) || ""; if (BASKET_RE.test(u)) track(); } catch (e) {}
      return of.apply(this, arguments);
    };
  }
  var oo = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, url) {
    try { if (BASKET_RE.test(String(url || ""))) this.__pvBasket = true; } catch (e) {}
    return oo.apply(this, arguments);
  };
  var os = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function () {
    try { if (this.__pvBasket) track(); } catch (e) {}
    return os.apply(this, arguments);
  };

  // ③ .actionCart 클릭(폴백)
  document.addEventListener("click", function (e) {
    var t = e.target;
    for (var i = 0; i < 4 && t; i++) {
      if (t.classList && t.classList.contains("actionCart")) { track(); return; }
      t = t.parentElement;
    }
  }, true);

  // 페이지 떠나기 직전(담기→basket.html 이동 등) 큐에 남은 게 있으면 마지막 전송 시도.
  window.addEventListener("pagehide", function () { if (memberId) flush(); }, false);
})();
