/*! Paulvice/Harriot 장바구니 이탈 추적 — '담기'를 우리 백엔드로 전송.
 *  캠페인 추적(2026-08-29): 문자 링크 /c/<code> 를 타고 오면 랜딩 URL 에 ?pvc=<code> 가 붙는다.
 *  이걸 localStorage 에 30일 보관해 담기 이벤트에 실어 보낸다 → 비로그인도 사람 단위로 이어붙는다.
 *  (대시보드와 쇼핑몰이 다른 도메인이라 쿠키로는 못 넘긴다 — URL 파라미터가 유일한 경로.)
 *  회원 식별: 카페24 프론트 SDK CAFE24API.getCustomerIDInfo (비동기). 회원ID 오기 전 담기는
 *  큐에 쌓았다가 조회 후 전송. 담기 감지: product_submit 래핑(주) + basket 네트워크/클릭(폴백).
 *  비로그인 추적(2026-08-30): 예전엔 member_id 없으면 버려서 장바구니의 절반 이상이
 *  기록되지 않았다(최근 30일 주문의 47%가 비회원 / 2개월 수집량 26건). 이제 브라우저에
 *  임의 익명ID(pv_aid, 180일)를 심어 비로그인도 센다. 이름·연락처가 아니라 난수다.
 *  전환 판정: 주문완료 페이지에 닿으면 같은 사람의 열린 담기를 닫는다. 비회원은 서버에서
 *  주문과 이어붙일 열쇠가 없어, 이 페이지 신호가 유일한 연결고리다.
 *  같은상품 2.5초 중복방지. 스킨엔 <script src=".../pv-cart.js"> 한 줄이면 됨.
 *  ⚠️ 스킨과 스크립트태그(전 페이지 주입)에 둘 다 실릴 수 있어 중복실행 가드가 있다.
 */
(function () {
  "use strict";
  if (window.__pvCartLoaded) return;   // 스킨 + 스크립트태그 이중 로드 방지
  window.__pvCartLoaded = true;
  var API = "https://paulvice-dashboard.vercel.app/api/crm/cart-event";
  var PV = window.__PV || {};
  var host = location.hostname || "";
  var isHarriot = /harriot/i.test(host);
  var mall = PV.mall || (isHarriot ? "harriot" : "paulvice");
  var CLIENT_ID = isHarriot ? "7eMH5F8YOqwTdkXwj54CNF" : "EQ0iU3bbCZNhLSdvtJg1eG";
  var SDK_VERSION = "2024-06-01";

  var memberId = null, resolved = false, pending = [];

  // ── 익명 식별자 ─────────────────────────────────────────────
  // 비로그인 방문자를 한 사람으로 묶기 위한 난수. 개인정보는 담지 않는다.
  var AKEY = "pv_aid", ATTL = 180 * 864e5;
  function anonId() {
    try {
      var raw = localStorage.getItem(AKEY);
      if (raw) {
        var o = JSON.parse(raw);
        if (o && o.a && Date.now() - (o.t || 0) < ATTL) return o.a;
      }
      var a = (Date.now().toString(36) + Math.random().toString(36).slice(2, 12)).replace(/[^a-z0-9]/g, "");
      localStorage.setItem(AKEY, JSON.stringify({ a: a, t: Date.now() }));
      return a;
    } catch (e) { return null; }   // 시크릿모드 등 저장 불가 → 익명추적 포기(담기 자체는 안 막는다)
  }

  // ── 캠페인 코드 (문자 링크로 유입된 사람 식별) ──────────────────
  var CKEY = "pv_campaign_code", CTTL = 30 * 864e5;
  function campaignCode() {
    try {
      var q = new URLSearchParams(location.search).get("pvc");
      if (q) { localStorage.setItem(CKEY, JSON.stringify({ c: q, t: Date.now() })); return q; }
      var raw = localStorage.getItem(CKEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || !o.c || Date.now() - (o.t || 0) > CTTL) { localStorage.removeItem(CKEY); return null; }
      return o.c;
    } catch (e) { return null; }
  }
  // 유입 즉시 저장(담기 전에 이탈해도 재방문 때 이어짐)
  try { campaignCode(); } catch (e) {}

  // ── 담아둔 것 스냅샷 (온사이트 리마인더용) ──────────────────
  // 재방문했을 때 "담아두신 거 있어요"를 서버 왕복 없이 즉시 띄우려고 브라우저에 남긴다.
  // 담긴 사실과 상품명뿐이고 개인정보는 없다. 읽는 쪽은 pv-hesitate.js.
  var SNAP_KEY = "pv_cart_snap", SNAP_MAX = 5;
  function saveSnap(ev) {
    try {
      var raw = localStorage.getItem(SNAP_KEY);
      var o = raw ? JSON.parse(raw) : null;
      var items = (o && o.items) || [];
      // 같은 상품은 갱신(중복 누적 방지). 상품번호가 없으면 이름으로 구분한다.
      var key = String(ev.productNo || ev.productName || "");
      items = items.filter(function (it) { return String(it.n || it.t || "") !== key; });
      items.unshift({ n: ev.productNo, t: ev.productName, q: ev.quantity, at: Date.now() });
      localStorage.setItem(SNAP_KEY, JSON.stringify({ items: items.slice(0, SNAP_MAX), t: Date.now() }));
    } catch (e) {}
  }
  function clearSnap() { try { localStorage.removeItem(SNAP_KEY); } catch (e) {} }

  function whenSdk(cb, tries) {
    tries = tries || 0;
    if (window.CAFE24API && typeof window.CAFE24API.getCustomerIDInfo === "function") return cb();
    // SDK 가 끝내 안 뜨면(상세 외 페이지 등) 비회원으로 확정하고 큐를 내보낸다.
    // 예전엔 여기서 그냥 포기해 큐가 영영 안 나갔다.
    if (tries > 20) { resolved = true; flush(); return; }
    setTimeout(function () { whenSdk(cb, tries + 1); }, 500);
  }
  whenSdk(function () {
    try { window.CAFE24API.init({ client_id: CLIENT_ID, version: SDK_VERSION }); } catch (e) {}
    try {
      window.CAFE24API.getCustomerIDInfo(function (err, data) {
        try { memberId = (data && data.id && data.id.member_id) || null; } catch (e) {}
        resolved = true;
        flush();   // 비로그인도 익명ID 로 보낸다(예전엔 여기서 버렸다)
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

  // 영문몰은 경로가 /shop2/ 로 시작한다. 국내(문자)와 해외(이메일)를 가르는 기준이라
  // 담기 시점에 실어 보낸다 — 나중에 서버에서 되짚을 방법이 없다.
  function shopNo() {
    try {
      var m = location.pathname.match(/^\/shop(\d+)\//i);
      return m ? Number(m[1]) : 1;
    } catch (e) { return 1; }
  }

  function send(ev) {
    ev.memberId = memberId; // 전송 시점의 회원ID(없으면 null)
    ev.shopNo = shopNo();   // 1=국내 · 2=영문
    ev.anonId = anonId();   // 비로그인 식별
    ev.campaignCode = campaignCode(); // 캠페인 유입이면 코드 동봉
    var payload = JSON.stringify(ev);
    try {
      // text/plain = CORS 안전목록(preflight 불필요) → 크로스오리진 beacon 성공. 서버 req.json()이 파싱.
      if (navigator.sendBeacon) navigator.sendBeacon(API, new Blob([payload], { type: "text/plain" }));
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
    saveSnap(ev);   // 전송 성공 여부와 무관하게 남긴다 — 리마인더는 이 기록만 있으면 뜬다
    // 회원ID 조회가 끝나기 전이면 큐에 담았다가 조회 후 보낸다(회원/비회원 라벨을 정확히 붙이려고).
    // 조회가 끝났으면 회원이든 아니든 바로 보낸다.
    if (resolved) send(ev); else pending.push(ev);
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
  window.addEventListener("pagehide", function () { flush(); }, false);

  // ── 주문완료 도달 → 전환 처리 ──────────────────────────────
  // 스크립트태그로 전 페이지에 실리므로 여기서 주문완료 페이지를 직접 감지한다.
  // order_id 는 있으면 좋고 없어도 된다 — "이 사람이 샀다"는 사실이 핵심이다.
  function orderIdFromPage() {
    try {
      var q = new URLSearchParams(location.search).get("order_id");
      if (q) return q;
      var m = (document.body.innerText || "").match(/\b(20\d{6}-\d{7})\b/);  // 카페24 주문번호 형식
      return m ? m[1] : null;
    } catch (e) { return null; }
  }
  if (/order[_/]?result|order_complete/i.test(location.pathname)) {
    var fire = function () {
      send({ mall: mall, type: "purchase", orderId: orderIdFromPage() });
    };
    clearSnap();   // 샀으면 리마인더가 뜰 이유가 없다
    // 회원ID 조회를 잠깐 기다린다(회원이면 회원ID로 닫는 게 정확). 못 기다려도 익명ID로 닫힌다.
    if (resolved) fire(); else setTimeout(fire, 1500);
  }

  // ── 장바구니를 직접 비운 경우 ────────────────────────────────
  // 스냅샷만 믿으면 이미 비운 장바구니를 두고 "담아두신 게 있어요"라고 하게 된다.
  // 장바구니 페이지에 왔을 때 실제로 비었으면 기록을 지운다.
  if (/\/order\/basket/i.test(location.pathname)) {
    setTimeout(function () {
      try {
        var rows = document.querySelectorAll(".xans-order-basketpackage tbody tr, .xans-order-normalpackage tbody tr, table.orderListTable tbody tr");
        var empty = document.querySelector(".xans-order-basketempty, .basketEmpty, td.empty");
        // 행이 하나도 없거나 '비어있음' 영역이 보이면 비운 것으로 본다.
        if (empty || rows.length === 0) clearSnap();
      } catch (e) {}
    }, 1200);
  }
})();
