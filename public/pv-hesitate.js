/*! Paulvice/Harriot 망설임 팝업 — 오래 보고도 못 정한 사람에게 후기를 보여준다.
 *
 *  ⚠️ 전례: 2026-07-01 웰컴팝업을 켰다가 카페24 주문이 5~8건/일 → 1~3건/일로 급락해
 *     7/8 에 껐다. 광고가 상품 상세로 유입되는데 착지 1초 뒤 바텀시트가 가격·구매버튼을
 *     가려서였다. 그래서 이 스크립트는 다음을 절대 규칙으로 삼는다.
 *
 *   ① 착지 직후 절대 안 뜬다. 체류 45초 + 스크롤 60% + 담기/구매 클릭 없음이 모두 충족돼야 한다.
 *      = "관심은 있는데 못 정하고 있다"가 확인된 뒤에만 개입한다.
 *   ② 구매 CTA 를 가리지 않는다. 모바일 하단 고정 버튼 영역을 비우고 그 위에 띄운다.
 *   ③ 홀드아웃(기본 10%)에겐 안 띄우고 조건 충족만 기록한다 → 팝업이 도움이 됐는지 해가 됐는지
 *      감이 아니라 숫자로 비교한다.
 *   ④ 설정은 서버(KV)에서 읽는다. 문제가 보이면 배포 없이 즉시 끌 수 있어야 한다.
 *
 *  오퍼는 쿠폰이 아니라 **후기**다(사장님 결정 2026-08-30). 공홈은 이미 평균 17.7%
 *  상시할인 중이라 추가 할인은 마진만 깎는다. 망설임의 원인을 '가격'이 아니라
 *  '확신 부족'으로 보고, 실제 구매자들의 평가로 그걸 푼다.
 */
(function () {
  "use strict";
  if (window.__pvHesitateLoaded) return;
  window.__pvHesitateLoaded = true;

  var BASE = "https://paulvice-dashboard.vercel.app";
  var API_CFG = BASE + "/api/storefront/popup";
  var API_REVIEW = BASE + "/api/reviews/widget";
  var host = location.hostname || "";
  var isHarriot = /harriot/i.test(host);
  var mall = isHarriot ? "harriot" : "paulvice";
  var SNOOZE_KEY = "pv_hesitate_snooze";
  var SHOWN_KEY = "pv_hesitate_shown";   // 세션당 1회

  // 상품 상세가 아니면 아무것도 하지 않는다.
  if (!/\/product\//i.test(location.pathname)) return;

  function productNo() {
    var raw = window.iProductNo != null ? window.iProductNo : null;
    var n = parseInt(String(raw == null ? "" : raw).replace(/\D/g, ""), 10);
    if (n > 0) return n;
    try {
      var q = new URLSearchParams(location.search).get("product_no");
      var m = parseInt(String(q || "").replace(/\D/g, ""), 10);
      return m > 0 ? m : null;
    } catch (e) { return null; }
  }

  // pv-cart.js 와 같은 익명ID 를 쓴다 — 팝업을 본 사람이 샀는지 이어붙이려면 같은 축이어야 한다.
  function anonId() {
    try {
      var raw = localStorage.getItem("pv_aid");
      if (raw) { var o = JSON.parse(raw); if (o && o.a) return o.a; }
    } catch (e) {}
    return null;
  }

  // 익명ID 해시로 홀드아웃을 고정 배정한다. 매번 새로 뽑으면 같은 사람이 오락가락해 비교가 깨진다.
  function inHoldout(id, ratio) {
    if (!id || !ratio) return false;
    var h = 0;
    for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return (h % 1000) / 1000 < ratio;
  }

  function post(event, extra) {
    try {
      var body = JSON.stringify(Object.assign({
        mall: mall, popup: "hesitation", anonId: anonId(),
        productNo: productNo(), event: event, path: location.pathname,
      }, extra || {}));
      if (navigator.sendBeacon) navigator.sendBeacon(API_CFG, new Blob([body], { type: "text/plain" }));
      else fetch(API_CFG, { method: "POST", body: body, keepalive: true, mode: "cors" });
    } catch (e) {}
  }

  function snoozed() {
    try {
      var v = localStorage.getItem(SNOOZE_KEY);
      return v && Date.now() < Number(v);
    } catch (e) { return false; }
  }
  function snooze(hours) {
    try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + hours * 3600e3)); } catch (e) {}
  }

  // ── 구매 의사 감지 ─────────────────────────────────────────
  // 담기·바로구매를 눌렀으면 망설이는 게 아니다. 그 뒤론 절대 띄우지 않는다.
  var acted = false;
  function markActed() { acted = true; }
  document.addEventListener("click", function (e) {
    var t = e.target;
    for (var i = 0; i < 5 && t; i++) {
      var cls = (t.className && String(t.className)) || "";
      if (/actionCart|btnBuy|btnSubmit|action_cart|buy_now/i.test(cls)) return markActed();
      t = t.parentElement;
    }
  }, true);
  // ⚠️ product_submit 을 감싸지 않는다. pv-cart.js 가 이미 감싸고 __pv 마크로 중복을 막는데,
  //    여기서 또 감싸면 그 마크가 사라져 pv-cart 가 재래핑하고 담기가 두 번 집계된다.
  //    클릭 감지만으로 충분하다 — 담기·구매는 결국 클릭에서 시작한다.

  var maxScroll = 0;
  window.addEventListener("scroll", function () {
    try {
      var h = document.documentElement.scrollHeight - window.innerHeight;
      if (h > 0) maxScroll = Math.max(maxScroll, window.scrollY / h);
    } catch (e) {}
  }, { passive: true });

  // ── 팝업 ──────────────────────────────────────────────────
  // 폴바이스 BI: 모노톤(#111 / #fff / #B1AAA2)·세리프 헤드라인·골드 금지.
  function render(data) {
    var s = data.summary || {}, ai = data.aiSummary || {};
    var wrap = document.createElement("div");
    wrap.id = "pvHesitate";
    wrap.innerHTML = [
      '<div class="pvh-dim"></div>',
      '<div class="pvh-box" role="dialog" aria-label="구매 후기 요약">',
      '  <button class="pvh-x" aria-label="닫기">&times;</button>',
      '  <div class="pvh-head">이 시계를 산 분들은</div>',
      '  <div class="pvh-score"><b>' + (s.avg || 0).toFixed(1) + '</b>',
      '    <span class="pvh-stars">' + "★".repeat(Math.round(s.avg || 0)) + '</span>',
      '    <span class="pvh-cnt">후기 ' + (s.count || 0) + '개' + (s.photoCount ? ' · 사진 ' + s.photoCount : '') + '</span>',
      '  </div>',
      ai.summary ? '  <p class="pvh-sum">' + ai.summary + '</p>' : '',
      (ai.keywords && ai.keywords.length)
        ? '  <div class="pvh-kw">' + ai.keywords.slice(0, 4).map(function (k) { return '<span>' + k + '</span>'; }).join("") + '</div>'
        : '',
      '  <button class="pvh-cta">후기 자세히 보기</button>',
      '  <button class="pvh-later">괜찮아요</button>',
      '</div>',
    ].join("");

    var css = document.createElement("style");
    css.textContent = [
      "#pvHesitate{position:fixed;inset:0;z-index:99999;font-family:'Pretendard',-apple-system,sans-serif}",
      "#pvHesitate .pvh-dim{position:absolute;inset:0;background:rgba(17,17,17,.45)}",
      // ⚠️ bottom 여백 — 모바일 하단 고정 CART/BUY 버튼을 가리지 않기 위한 것. 줄이지 말 것.
      "#pvHesitate .pvh-box{position:absolute;left:50%;top:50%;transform:translate(-50%,-58%);",
      "  width:min(88vw,380px);max-height:70vh;overflow:auto;background:#fff;border-radius:16px;",
      "  padding:26px 22px 18px;box-shadow:0 18px 50px rgba(0,0,0,.22);text-align:center}",
      "#pvHesitate .pvh-x{position:absolute;right:12px;top:8px;border:0;background:none;font-size:24px;color:#B1AAA2;cursor:pointer;line-height:1}",
      "#pvHesitate .pvh-head{font-family:'Nanum Myeongjo',serif;font-size:19px;color:#111;letter-spacing:-.01em}",
      "#pvHesitate .pvh-score{margin:12px 0 4px;display:flex;align-items:baseline;justify-content:center;gap:6px}",
      "#pvHesitate .pvh-score b{font-size:30px;color:#111;line-height:1}",
      "#pvHesitate .pvh-stars{color:#111;letter-spacing:1px;font-size:13px}",
      "#pvHesitate .pvh-cnt{display:block;width:100%;margin-top:6px;font-size:12px;color:#B1AAA2}",
      "#pvHesitate .pvh-sum{margin:14px 2px 0;font-size:13.5px;line-height:1.65;color:#333;text-align:left}",
      "#pvHesitate .pvh-kw{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin:14px 0 4px}",
      "#pvHesitate .pvh-kw span{font-size:11.5px;color:#555;background:#F4F2F0;border-radius:999px;padding:5px 10px}",
      "#pvHesitate .pvh-cta{margin-top:18px;width:100%;padding:13px;border:0;border-radius:10px;background:#111;color:#fff;font-size:14px;cursor:pointer}",
      "#pvHesitate .pvh-later{margin-top:8px;width:100%;padding:8px;border:0;background:none;color:#B1AAA2;font-size:12.5px;cursor:pointer}",
    ].join("");
    document.head.appendChild(css);
    document.body.appendChild(wrap);

    function close(kind) {
      post(kind);
      snooze(CFG.hesitation.snoozeHours);
      try { wrap.remove(); } catch (e) {}
    }
    wrap.querySelector(".pvh-x").onclick = function () { close("dismiss"); };
    wrap.querySelector(".pvh-later").onclick = function () { close("dismiss"); };
    wrap.querySelector(".pvh-dim").onclick = function () { close("dismiss"); };
    wrap.querySelector(".pvh-cta").onclick = function () {
      post("click");
      snooze(CFG.hesitation.snoozeHours);
      try { wrap.remove(); } catch (e) {}
      // 상세페이지의 리뷰 위젯으로 데려간다 — 팝업에서 다 보여주려 하면 창이 커져 되레 방해된다.
      var el = document.querySelector("#pvReviews, .pv-reviews, #prdReview, .xans-product-review");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    post("shown");
  }

  // ── 실행 ──────────────────────────────────────────────────
  var CFG = null;
  var started = Date.now();

  function eligible() {
    if (acted) return false;
    if (Date.now() - started < CFG.hesitation.dwellMs) return false;
    if (maxScroll < CFG.hesitation.scrollPct) return false;
    if (document.hidden) return false;   // 탭을 안 보고 있는 동안 쌓인 시간은 망설임이 아니다
    return true;
  }

  fetch(API_CFG, { mode: "cors" })
    .then(function (r) { return r.json(); })
    .then(function (cfg) {
      CFG = cfg;
      if (!cfg.enabled || !cfg.hesitation || !cfg.hesitation.enabled) return;
      if (snoozed()) return;
      try { if (sessionStorage.getItem(SHOWN_KEY)) return; } catch (e) {}

      var pno = productNo();
      if (!pno) return;
      var held = inHoldout(anonId(), cfg.holdout);

      var timer = setInterval(function () {
        if (!eligible()) return;
        clearInterval(timer);
        try { sessionStorage.setItem(SHOWN_KEY, "1"); } catch (e) {}
        // 조건 충족은 홀드아웃이든 아니든 기록한다 — 이게 비교의 분모다.
        post("eligible", { holdout: held });
        if (held) return;

        fetch(API_REVIEW + "?mall=" + mall + "&product_no=" + pno + "&limit=1", { mode: "cors" })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            // 후기가 적으면 띄우지 않는다. 근거가 약한 설득은 오히려 의심을 부른다.
            if (!d || !d.ok || !d.summary || (d.summary.count || 0) < CFG.hesitation.minReviews) return;
            render(d);
          })
          .catch(function () {});
      }, 2000);
    })
    .catch(function () { /* 설정을 못 읽으면 아무것도 하지 않는다 — 페일클로즈 */ });
})();
