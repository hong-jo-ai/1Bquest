/**
 * 폴바이스 영문몰(shop_no=2, paulvice.kr) 방문 계측 — GA4 + 메타픽셀.
 *
 * 왜 필요한가: 국문몰엔 GA4·픽셀이 다 붙어 있는데 **영문몰만 아무것도 없었다**(2026-09-15 실측,
 * GA4 hostName=paulvice.kr 세션 최근 30일 0건). 그래서 9/15 첫 해외 주문이 어느 경로로 들어왔는지
 * 영영 알 수 없었다. 같은 GA4 속성을 쓰므로 hostName 으로 국문/영문이 자동 분리된다.
 *
 * 주입 방법 = **카페24 스크립트태그(shop_no=2, display_location=ALL)**. 스킨 파일은 건드리지 않는다
 * (영문몰 skin3 은 스마트디자인 에디터 저장이 FTP 파일을 덮어쓰는 함정이 있다).
 *
 * ⚠️ 이 파일이 보장하는 건 **PageView·유입경로까지**다. 구매/장바구니 같은 전자상거래 이벤트는
 *    카페24 기본 연동(관리자 → 마케팅)을 shop2 에도 켜야 정확히 잡힌다. 그때 이 파일은
 *    중복 가드 때문에 알아서 물러난다(아래 참조).
 */
(function () {
  var GA4_ID = "G-XM3HDPEVWY";       // 국문몰과 동일 속성 — hostName 으로 분리 집계
  var LOADER_ID = "AW-17364588868";  // 🔑 실제로 내려받아지는 유일한 gtag 컨테이너 (아래 참조)
  var PIXEL_ID = "7740091496041900"; // 폴바이스 메타 픽셀

  function has(selector) {
    try { return !!document.querySelector(selector); } catch (e) { return false; }
  }

  // ── GA4 ─────────────────────────────────────────────
  // 🔴 ORB 차단의 진짜 원인 (2026-09-15 확정):
  //    `gtag/js?id=G-XM3HDPEVWY` 는 **404 text/html** 을 돌려준다. 남의 사이트 G- ID 3개는 전부 200 이므로
  //    내 네트워크 문제가 아니라 **우리 계정 구조** 때문이다 — 우리 GA4 스트림(G-XM3HDPEVWY·G-QHBGSSBV3W)은
  //    독립 컨테이너가 아니라 **구글애즈 태그 AW-17364588868 의 목적지(destination)** 로 만들어졌다.
  //    실제로 AW 컨테이너(572KB) 안에 두 G- ID 가 모두 들어 있다.
  //    → 브라우저는 text/html 404 를 script 로 읽으려다 ORB 로 차단한다(net::ERR_BLOCKED_BY_ORB).
  //    삽입 방식(appendChild/insertBefore/정적)은 처음부터 무관했다. **URL 이 문제였다.**
  //    그래서 로더는 AW 로 받고, 국문몰과 똑같이 config 를 AW·G- 둘 다 호출한다.
  if (!has('script[src*="gtag/js?id=' + LOADER_ID + '"]')) {
    var s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + LOADER_ID;
    var first = document.getElementsByTagName("script")[0];
    if (first && first.parentNode) first.parentNode.insertBefore(s, first);
    else (document.head || document.documentElement).appendChild(s);

    window.dataLayer = window.dataLayer || [];
    if (typeof window.gtag !== "function") {
      window.gtag = function () { window.dataLayer.push(arguments); };
    }
    window.gtag("js", new Date());
    window.gtag("config", LOADER_ID); // 컨테이너 초기화 — 이게 있어야 목적지 GA4 가 붙는다
    window.gtag("config", GA4_ID);
  }

  // ── 메타 픽셀 ────────────────────────────────────────
  // fbq 가 이미 있으면(카페24 페이스북 채널 앱) 로더를 다시 깔지 않고, 우리 픽셀이 없을 때만 init.
  if (!window.fbq) {
    /* eslint-disable */
    !function (f, b, e, v, n, t, s) {
      if (f.fbq) return; n = f.fbq = function () {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
      };
      if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = "2.0"; n.queue = [];
      t = b.createElement(e); t.async = !0; t.src = v;
      s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
    }(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
    /* eslint-enable */
  }
  try {
    var already = (window.fbq && window.fbq.getState && window.fbq.getState().pixels || [])
      .some(function (p) { return String(p.id) === PIXEL_ID; });
    if (!already) {
      window.fbq("init", PIXEL_ID);
      window.fbq("track", "PageView");
    }
  } catch (e) {
    // getState 가 없는 버전이면 그냥 init (fbq 는 같은 id 중복 init 을 무시한다)
    try { window.fbq("init", PIXEL_ID); window.fbq("track", "PageView"); } catch (e2) {}
  }
})();
