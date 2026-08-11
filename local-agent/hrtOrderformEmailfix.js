/* HARRIOT 영문몰 주문서 — 이메일 단일입력 박스 (pv-emailfix v2)
 *
 * v1 사고(2026-08-12): CSS 로 카페24 기본 입력칸(#oemail1/#oemail2/.mailAddress)을
 *   "무조건" 먼저 숨겨놓고, 커스텀 박스는 조건이 맞을 때만 넣었다.
 *   → 조건이 안 맞는 화면(회원 로그인 주문서 등)에서 입력칸이 통째로 사라지고
 *     카페24 검증만 살아남아 "orderer email is a required field" 로 결제가 막혔다.
 *
 * v2 원칙: **커스텀 박스를 실제로 넣는 데 성공한 경우에만** 원래 입력칸을 숨긴다.
 *   실패하면 카페24 기본 2칸 UI가 그대로 보인다(= 최악이어도 주문은 된다).
 *
 * v2.1: 숨김을 인라인 style 로 하면 카페24 자체 JS 가 나중에 display 를 덮어써서
 *   기본칸이 다시 튀어나온다(박스까지 3칸). 그래서 스타일시트 !important 를 쓰되,
 *   **박스 삽입에 성공한 wrapper 에만 붙는 .pv-emailfixed 클래스로 스코프**를 건다.
 *   → v1 처럼 무조건 숨기지 않으면서도 카페24 JS 의 인라인 덮어쓰기를 이긴다.
 */
;(function () {
  // 클래스가 붙은 wrapper 안에서만 동작하는 규칙 — 붙이기 전엔 아무것도 숨기지 않는다
  function css() {
    if (document.getElementById("pv-emailfix-scoped")) return;
    var st = document.createElement("style");
    st.id = "pv-emailfix-scoped";
    st.textContent = ".ec-base-mail.pv-emailfixed #oemail1,.ec-base-mail.pv-emailfixed #oemail2," +
                     ".ec-base-mail.pv-emailfixed .mailId,.ec-base-mail.pv-emailfixed .mailAddress{display:none !important;}";
    (document.head || document.documentElement).appendChild(st);
  }

  function bind(e1, e2, box) {
    function sync() {
      var v = (box.value || "").trim();
      var at = v.lastIndexOf("@");
      if (at > 0) { e1.value = v.slice(0, at); e2.value = v.slice(at + 1); }
      else { e1.value = v; e2.value = ""; }
      // 도메인 select 형태(회원 주문서 등)도 함께 맞춰준다
      if (e2.tagName === "SELECT") {
        var d = v.slice(at + 1), hit = false;
        for (var i = 0; i < e2.options.length; i++) if (e2.options[i].value === d) { e2.selectedIndex = i; hit = true; break; }
        if (!hit && e2.options.length) e2.selectedIndex = 0; // 직접입력
      }
    }
    box.addEventListener("input", sync);
    box.addEventListener("change", sync);
    box.addEventListener("blur", sync);
    var f = e1.form; if (f) f.addEventListener("submit", sync, true);
    document.addEventListener("click", function (ev) {
      var t = ev.target;
      if (t && /order|payment|checkout|submit/i.test((t.textContent || "") + (t.value || "") + (t.className || ""))) sync();
    }, true);
  }

  function fix() {
    var ws = document.querySelectorAll(".ec-base-mail");
    for (var i = 0; i < ws.length; i++) {
      var w = ws[i];
      if (w.querySelector(".pv-email-box")) continue;
      var e1 = w.querySelector("#oemail1") || w.querySelector(".mailId");
      var e2 = w.querySelector("#oemail2") || w.querySelector(".mailAddress");
      if (!e1 || !e2) continue; // ← 못 찾으면 아무것도 건드리지 않는다(기본 UI 유지)

      var box = document.createElement("input");
      box.type = "email";
      box.className = "pv-email-box";
      box.placeholder = "you@example.com";
      box.autocomplete = "email";
      box.setAttribute("inputmode", "email");
      box.style.cssText = "width:100%;max-width:360px;min-width:220px;box-sizing:border-box;height:34px;padding:2px 10px;border:1px solid #ccc;border-radius:2px;font-size:14px;vertical-align:middle;background:#fff";

      // 회원 주문서처럼 값이 이미 채워져 있으면 박스에 옮겨 보여준다
      var pre = (e1.value || "") + (e2.value ? "@" + e2.value : "");
      if (pre.indexOf("@") > 0) box.value = pre;

      var cn = w.childNodes;
      for (var k = 0; k < cn.length; k++) if (cn[k].nodeType === 3) cn[k].textContent = "";
      w.insertBefore(box, w.firstChild);

      // ★ 삽입에 성공한 wrapper 에만 클래스를 붙여 숨긴다(카페24 JS 의 인라인 덮어쓰기에 안 밀림)
      css();
      w.classList.add("pv-emailfixed");

      bind(e1, e2, box);
    }
  }

  function boot() {
    fix();
    // 늦게 그려지는 주문서 영역(배송지 탭 전환 등)까지 계속 커버
    try {
      new MutationObserver(function () { fix(); }).observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) {
      var n = 0, iv = setInterval(function () { fix(); if (++n > 40) clearInterval(iv); }, 1500);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
