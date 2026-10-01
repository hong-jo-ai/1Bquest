/*! 해리엇 설월(#136) 품절 안내 + 영문몰 재입고 메일 신청 — 2026-10-01
 *
 *  설월 상세에서, **품절일 때만** 동작한다. 재고가 있거나 다른 상품이면 아무것도 하지 않는다.
 *   - 영문몰(shop2): 스킨에 재입고 버튼이 없다(SOLD OUT · WISH LIST 뿐) → 수요를 받을 수단이 없었다.
 *       구매 버튼 자리 위에 안내 문구 + 이메일 입력칸, 모바일 하단 고정바에 NOTIFY ME.
 *       POST /api/harriot/waitlist { list:"restock" } → KV `harriot:seolwol:restock:v1` (출시 대기명단과 별도).
 *       품절 화면에 남는 PayPal Buy Now 버튼(#appPaymentButtonBox)은 숨긴다.
 *   - 국문몰(shop1): 안내 문구만 넣는다. 카페24 재입고 알림 버튼(SMS 자동발송)은 건드리지 않는다.
 *
 *  품절 판정 — 카페24 가 서버에서 그려 주는 마크업(스킨 roma, 기원 흑색 #121 품절 실화면으로 확인 2026-10-01):
 *       재고 있음   .productAction .action_button .sub_sold.displaynone   +  a.btnSubmit(BUY IT NOW) 노출
 *       품절        .productAction .action_button .sub_sold (displaynone 없음) + a.btnSubmit.displaynone
 *     ⚠️ 요소 **자기 class** 만 본다. 모바일 UA 로 받으면 카페24 서버가 부모(.action_button)에 displaynone 을
 *        붙이고 .ec-base-button.soldout 블록과 하단 고정바(#orderFixArea)의 둘째 칸을 대신 그린다 —
 *        "화면에 보이는가"로 판정하면 기기마다 답이 달라진다. 위 두 요소의 자기 class 는 PC·모바일이 같다.
 *     두 신호가 다 맞아야 품절로 본다(하나라도 어긋나면 아무것도 안 한다).
 *
 *  상품번호 — 카페24는 주소가 두 벌이다: /product/detail.html?product_no=136 · /product/<이름>/136/
 *  몰 언어   — `<html lang>` 은 두 몰 다 ko 라 못 쓴다. shop 번호 → 도메인 → 경로(/shop2/) 순으로 가른다.
 *
 *  페일오픈: 어디서 실패하든 조용히 끝낸다. 전역 변수를 만들지 않는다. 롤백 = 스크립트태그 삭제.
 *  hrt-pdp.js(데스크탑 sticky 칼럼 보정)와의 관계: 블록이 칼럼 높이를 늘리면 그쪽 ResizeObserver 가
 *  top 을 다시 맞춘다 — 이 파일은 칼럼의 style 을 건드리지 않는다.
 *  고친 뒤에는 스크립트태그 `?v=` 를 올릴 것(안 올리면 고객은 옛 파일을 받는다).
 */
(function () {
  "use strict";
  try {
    var TARGET_NO = "136";
    var API = "https://paulvice-dashboard.vercel.app/api/harriot/waitlist";
    var MARK = "data-hrt-soldout";   // 중복 주입 가드(전역 변수 대신 <html> 속성)

    // 재고가 있을 때의 한 줄 안내(사장님 2026-10-01: "품절임박" 스티커 대신 사실만 적은 한 줄).
    // 켜는 법 = NOTICE_ON 을 true 로 바꾸고 스크립트태그 ?v= 를 올린다. 품절되면 아래 품절 블록이 대신 뜬다.
    // 🔴 리오더가 입고되면 이 문구는 틀린 말이 된다 → NOTICE_ON 을 끄거나 문구를 바꿀 것. 잊어도 NOTICE_UNTIL 뒤엔 안 뜬다.
    var NOTICE_ON = false;
    var NOTICE_UNTIL = Date.parse("2026-11-10T00:00:00+09:00");
    var NOTICE = {
      ko: "1차 생산분이 얼마 남지 않았습니다. 다음 입고는 11월 이후입니다.",
      en: "Only a few of the first batch remain. The next batch will not arrive before November."
    };

    var root = document.documentElement;
    if (!root || root.getAttribute(MARK)) return;

    function productNo() {
      try {
        var q = (location.search.match(/[?&]product_no=(\d+)/) || [])[1];
        if (q) return q;
        var m = location.pathname.match(/\/product\/[^\/?]+\/(\d+)(?:[\/?]|$)/);
        if (m) return m[1];
        var c = document.querySelector('link[rel="canonical"]');
        if (c) { m = String(c.getAttribute("href") || "").match(/\/product\/[^\/?]+\/(\d+)(?:[\/?]|$)/); if (m) return m[1]; }
      } catch (e) {}
      return null;
    }
    if (productNo() !== TARGET_NO) return;
    root.setAttribute(MARK, "1");

    function isEn() {
      try {
        var n = window.CAFE24 && window.CAFE24.SDE_SHOP_NUM;
        if (String(n) === "2") return true;
        if (String(n) === "1") return false;
      } catch (e) {}
      if (/(^|\.)harriotwatches\.com$/i.test(location.hostname)) return true;
      if (/(^|\/)shop2(\/|$)/.test(location.pathname)) return true;
      return false;
    }

    // 요소 자기 class 에 displaynone 이 없는가(부모는 안 본다 — 위 주석 참고)
    function on(el) { return !!el && !/(^|\s)displaynone(\s|$)/.test(String(el.className || "")); }

    function actionArea() {
      return document.querySelector("#cd-nav .xans-product-action.productAction") ||
             document.querySelector(".xans-product-action.productAction");
    }
    function isSoldOut(area) {
      var mark = area.querySelector(".action_button .sub_sold");
      var buy = area.querySelector(".action_button a.btnSubmit");
      if (!mark || !buy) return false;
      return on(mark) && !on(buy);
    }

    var COPY = {
      ko: {
        p1: "설월의 다음 입고를 준비하고 있습니다. 입고일은 정해지는 대로 알려드리겠습니다.",
        p2: "아래 ‘재입고 알림 신청’을 눌러 두시면, 입고되는 날 문자로 안내드립니다."
      },
      en: {
        head: "Sold out",
        p1: "We are preparing the next batch of SEOLWOL. We will share a date once it is certain.",
        p2: "Leave your email and we will write to you the day it returns.",
        ph: "Email address",
        btn: "Notify me",
        note: "We will use this address only to tell you SEOLWOL is back in stock.",
        agree: "I agree to Harriot collecting my email address to notify me when SEOLWOL is back in stock.",
        need: "Please tick the box to continue.",
        ok: "Thank you. We will write to you the day SEOLWOL returns.",
        bad: "Please check the email address.",
        fail: "Something went wrong. Please try again in a moment.",
        bar: "NOTIFY ME"
      }
    };

    function css() {
      if (document.getElementById("hrtSoCss")) return;
      var s = document.createElement("style"); s.id = "hrtSoCss";
      s.textContent = [
        "#hrtSo{margin:18px 0 14px;padding:16px 16px 15px;border:1px solid #111;background:#fff;color:#111;text-align:left;box-sizing:border-box;max-width:100%;font-family:inherit}",
        "#hrtSo *{box-sizing:border-box;font-family:inherit}",
        "#hrtSo .hrtSoH{font-size:12px;letter-spacing:.22em;font-weight:700;text-transform:uppercase;margin:0 0 8px;color:#111}",
        "#hrtSo p{margin:0;padding:0;font-size:13px;line-height:1.7;color:#333;word-break:keep-all;overflow-wrap:break-word}",
        "#hrtSo p+p{margin-top:4px}",
        "#hrtSo form{display:flex;gap:8px;margin:12px 0 0;padding:0}",
        "#hrtSo input[type=email]{flex:1 1 auto;width:auto;min-width:0;height:44px;margin:0;padding:0 12px;border:1px solid #111;border-radius:0;font-size:16px;line-height:normal;background:#fff;color:#111;-webkit-appearance:none;appearance:none}",
        "#hrtSo button{flex:0 0 auto;width:auto;height:44px;margin:0;padding:0 18px;border:1px solid #111;border-radius:0;background:#111;color:#fff;font-size:13px;font-weight:500;letter-spacing:.08em;cursor:pointer;white-space:nowrap}",
        "#hrtSo button[disabled]{opacity:.5;cursor:default}",
        "#hrtSo .hrtSoN{margin-top:8px;font-size:11.5px;line-height:1.6;color:#777}",
        "#hrtSo label.hrtSoC{display:flex;align-items:flex-start;gap:8px;margin:10px 0 0;padding:0;font-size:12px;line-height:1.6;color:#333;cursor:pointer}",
        "#hrtSo label.hrtSoC input{flex:0 0 auto;width:16px;height:16px;margin:2px 0 0;padding:0;border:1px solid #111;border-radius:0;accent-color:#111;-webkit-appearance:checkbox;appearance:auto}",
        "#hrtSo .hrtSoM{margin-top:10px;font-size:13px;line-height:1.6;color:#111}",
        "#hrtSo .hrtSoM.err{color:#a00}",
        // 품절 판정이 참일 때만 붙는 class 로 스코프한다. 카페24 앱이 inline display:block 을 다시 써도 이긴다.
        ".hrtSoOn #appPaymentButtonBox{display:none !important}"
      ].join("");
      (document.head || root).appendChild(s);
    }

    function utm(k) {
      try { var v = new URLSearchParams(location.search).get(k); return v ? String(v).slice(0, 120) : null; }
      catch (e) { return null; }
    }

    function buildForm(box, T, lead) {
      var form = document.createElement("form"); form.setAttribute("novalidate", "novalidate");
      var input = document.createElement("input"); input.type = "email"; input.placeholder = T.ph;
      input.setAttribute("autocomplete", "email"); input.setAttribute("inputmode", "email");
      input.setAttribute("aria-label", T.ph); input.setAttribute("maxlength", "254");
      var btn = document.createElement("button"); btn.type = "submit"; btn.textContent = T.btn;
      form.appendChild(input); form.appendChild(btn); box.appendChild(form);
      // 개인정보 수집 동의 체크박스(사장님 2026-10-01) — 체크해야 신청된다. 기본값은 해제.
      var lab = document.createElement("label"); lab.className = "hrtSoC";
      var chk = document.createElement("input"); chk.type = "checkbox"; chk.id = "hrtSoAgree";
      var labT = document.createElement("span"); labT.textContent = T.agree;
      lab.appendChild(chk); lab.appendChild(labT); box.appendChild(lab);
      var note = document.createElement("div"); note.className = "hrtSoN"; note.textContent = T.note; box.appendChild(note);
      var msg = document.createElement("div"); msg.className = "hrtSoM"; msg.style.display = "none";
      msg.setAttribute("role", "status"); msg.setAttribute("aria-live", "polite"); box.appendChild(msg);

      function say(t, err) { msg.textContent = t; msg.className = "hrtSoM" + (err ? " err" : ""); msg.style.display = "block"; }

      form.addEventListener("submit", function (e) {
        try { e.preventDefault(); } catch (e0) {}
        try {
          if (btn.disabled) return;
          var v = String(input.value || "").trim();
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) { say(T.bad, true); try { input.focus(); } catch (e1) {} return; }
          if (!chk.checked) { say(T.need, true); try { chk.focus(); } catch (e5) {} return; }
          btn.disabled = true;
          var opt = {
            method: "POST", mode: "cors", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              list: "restock", productNo: Number(TARGET_NO), mall: "en", contact: v,
              // 체크박스로 수집 동의를 받고, 이용 목적은 그 아래에 적어 두었다(T.note). 광고성 수신 동의는 받지 않는다.
              consentPrivacy: !!chk.checked, consentMarketing: false,
              utmSource: utm("utm_source"), utmMedium: utm("utm_medium"),
              utmCampaign: utm("utm_campaign"), utmContent: utm("utm_content"),
              referrer: document.referrer ? String(document.referrer).slice(0, 300) : null,
              page: String(location.pathname).slice(0, 200)
            })
          };
          var timer = null;
          try {
            if (window.AbortController) {
              var ac = new AbortController(); opt.signal = ac.signal;
              timer = setTimeout(function () { try { ac.abort(); } catch (e2) {} }, 15000);
            }
          } catch (e3) {}
          fetch(API, opt)
            .then(function (r) { return r.json().catch(function () { return {}; }); })
            .then(function (d) {
              if (timer) clearTimeout(timer);
              if (d && d.ok) {
                // 신청이 끝나면 입력 안내("Leave your email…")와 입력칸을 접고 감사 문구만 남긴다.
                form.style.display = "none"; note.style.display = "none"; lab.style.display = "none";
                if (lead) lead.style.display = "none";
                say(T.ok, false);
              }
              else { btn.disabled = false; say(d && d.reason === "invalid_contact" ? T.bad : T.fail, true); }
            })
            .catch(function () {
              // 실패를 성공으로 위장하지 않는다 — 조용히 삼키면 명단이 비어도 아무도 모른다.
              if (timer) clearTimeout(timer);
              btn.disabled = false; say(T.fail, true);
            });
        } catch (er) { try { btn.disabled = false; say(T.fail, true); } catch (e4) {} }
      });
      return { input: input, btn: btn };
    }

    // 재고가 있을 때: 구매 버튼 위 한 줄 안내. 구매 버튼이 실제로 보일 때만 넣는다(구조를 못 읽으면 아무것도 안 한다).
    function mountNotice(area) {
      if (!NOTICE_ON || !(Date.now() < NOTICE_UNTIL)) return;
      if (document.getElementById("hrtSoNote")) return;
      var buy = area.querySelector(".action_button a.btnSubmit");
      if (!on(buy)) return;
      var d = document.createElement("div"); d.id = "hrtSoNote";
      d.textContent = isEn() ? NOTICE.en : NOTICE.ko;
      d.style.cssText = "margin:16px 0 12px;padding:11px 14px;border:1px solid #111;background:#fff;color:#111;font-size:13px;line-height:1.7;text-align:left;word-break:keep-all;overflow-wrap:break-word;box-sizing:border-box;max-width:100%";
      area.parentNode.insertBefore(d, area);
    }

    // 스킨 버튼의 모서리 둥글기를 따라간다(못 읽으면 각진 그대로).
    function matchSkin(area, parts) {
      try {
        var ref = area.querySelector("#actionWish") || area.querySelector("#actionWishSoldout");
        var r = ref && getComputedStyle(ref).borderRadius;
        if (r && /^\d+(\.\d+)?px$/.test(r) && parseFloat(r) <= 22) {
          parts.input.style.borderRadius = r; parts.btn.style.borderRadius = r;
        }
      } catch (e) {}
    }

    // 영문몰 모바일 하단 고정바: SOLD OUT | NOTIFY ME | WISH LIST (국문몰의 '재입고 알림' 자리와 같은 순서)
    function addBarButton(box, parts) {
      try {
        if (document.getElementById("hrtSoBar")) return;
        var wish = document.querySelector("#orderFixArea [id='actionWishSoldout']");
        var col = wish && wish.parentNode;
        if (!col) return;
        var a = document.createElement("button"); a.type = "button"; a.id = "hrtSoBar";
        a.className = "btnNormal sizeM"; a.textContent = COPY.en.bar;
        a.addEventListener("click", function () {
          try { box.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e1) { try { box.scrollIntoView(); } catch (e2) {} }
          setTimeout(function () { try { parts.input.focus({ preventScroll: true }); } catch (e3) {} }, 500);
        });
        col.insertBefore(a, wish);
      } catch (e) {}
    }

    // true = 더 볼 것 없음(넣었거나, 품절이 아니거나, 넣을 조건이 안 됨) / false = 아직 구매 영역이 없다
    function mount() {
      if (document.getElementById("hrtSo")) return true;
      var area = actionArea();
      if (!area || !area.parentNode) return false;
      if (!isSoldOut(area)) { try { mountNotice(area); } catch (e) {} return true; }   // 재고가 있으면 한 줄 안내만(꺼져 있으면 아무것도 안 함)

      var en = isEn();
      var T = en ? COPY.en : COPY.ko;
      if (!en) {
        // 국문 문구는 '재입고 알림 신청' 버튼을 가리킨다 — 그 버튼이 없으면 문구도 넣지 않는다.
        var rb = area.querySelector('[name="btn_restock_main"]') || area.querySelector('[name="btn_restock"]');
        if (!on(rb)) return true;
      }

      css();
      var box = document.createElement("div"); box.id = "hrtSo";
      if (T.head) { var h = document.createElement("div"); h.className = "hrtSoH"; h.textContent = T.head; box.appendChild(h); }
      var p1 = document.createElement("p"); p1.textContent = T.p1; box.appendChild(p1);
      var p2 = document.createElement("p"); p2.textContent = T.p2; box.appendChild(p2);

      var parts = null;
      if (en) parts = buildForm(box, T, p2);

      area.parentNode.insertBefore(box, area);

      if (en) {
        matchSkin(area, parts);
        addBarButton(box, parts);
        // PayPal Buy Now 숨김 — 품절 판정이 참이고 영문몰일 때만 class 가 붙는다.
        try { area.classList.add("hrtSoOn"); } catch (e) {}
      }
      return true;
    }

    function run() { try { return mount(); } catch (e) { return true; } }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
    if (!run()) {
      // 스크립트가 구매 영역보다 먼저 실행된 경우에만 잠깐 기다린다(최대 6초).
      var n = 0;
      var t = setInterval(function () { if (run() || ++n > 12) clearInterval(t); }, 500);
    }
  } catch (e) { /* 페일오픈 */ }
})();
