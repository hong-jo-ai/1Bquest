/*! Paulvice/Harriot 장바구니 이탈 추적 — 로그인 회원의 '담기'를 우리 백엔드로 전송.
 *  회원 식별은 카페24 프론트 SDK(CAFE24API.getCustomerIDInfo)로 — 스킨 변수({$member_id})는
 *  상품상세 문맥에서 무효라 SDK 사용. 비로그인(member_id 없음)은 추적 안 함.
 *  담기 감지: ①basket 엔드포인트 네트워크 후킹 ②.actionCart 클릭 폴백. 같은상품 2.5초 중복방지.
 *  스킨에는 <script src=".../pv-cart.js"> 한 줄만 있으면 됨(window.__PV는 선택).
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

  var memberId = null;

  function whenSdk(cb, tries) {
    tries = tries || 0;
    if (window.CAFE24API && typeof window.CAFE24API.getCustomerIDInfo === "function") return cb();
    if (tries > 20) return; // ~10s 대기 후 포기
    setTimeout(function () { whenSdk(cb, tries + 1); }, 500);
  }
  whenSdk(function () {
    try { window.CAFE24API.init({ client_id: CLIENT_ID, version: SDK_VERSION }); } catch (e) {}
    try {
      window.CAFE24API.getCustomerIDInfo(function (err, data) {
        try { memberId = (data && data.id && data.id.member_id) || null; } catch (e) {}
      });
    } catch (e) {}
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

  var lastFire = {};
  function track() {
    if (!memberId) return; // 비로그인 → 추적 안 함
    var pno = productNo(), key = String(pno || "x"), now = Date.now();
    if (lastFire[key] && now - lastFire[key] < 2500) return;
    lastFire[key] = now;
    var payload = JSON.stringify({
      mall: mall, memberId: memberId, productNo: pno,
      productName: productName(), quantity: quantity(),
    });
    try {
      if (navigator.sendBeacon) navigator.sendBeacon(API, new Blob([payload], { type: "application/json" }));
      else fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, keepalive: true, mode: "cors" });
    } catch (e) {}
  }

  var BASKET_RE = /\/exec\/front\/order\/basket/i;
  if (window.fetch) {
    var of = window.fetch;
    window.fetch = function (input) {
      try { var u = typeof input === "string" ? input : (input && input.url) || ""; if (BASKET_RE.test(u)) setTimeout(track, 50); } catch (e) {}
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
    try { if (this.__pvBasket) setTimeout(track, 50); } catch (e) {}
    return os.apply(this, arguments);
  };
  document.addEventListener("click", function (e) {
    var t = e.target;
    for (var i = 0; i < 4 && t; i++) {
      if (t.classList && t.classList.contains("actionCart")) { setTimeout(track, 300); return; }
      t = t.parentElement;
    }
  }, true);
})();
