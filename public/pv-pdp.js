/*! 폴바이스 상세페이지 레이아웃 수리 — 2026-09-26
 *  각인 미리보기(pv-engrave.js)와 **분리**해 둔다. 섞었다가 영문몰을 한 번 깨뜨렸다.
 *  롤백도 따로 된다.
 *
 *  ① 각인 입력칸이 짓눌린다
 *     카페24 스킨이 옵션 행을 표로 그리는데, 바깥 tbody 가 `display:block` 이라
 *     그 안의 <tr> 이 **익명 테이블**이 되어 shrink-to-fit 으로 줄어든다.
 *     실측 — 국문몰 모바일: 컨테이너 468 / 입력칸 260
 *            영문몰 모바일: 컨테이너 468 / 라벨 100 + 입력칸 **28px**(글자를 칠 수 없다)
 *     영문몰이 더 심한 건 라벨이 길어서다("Engraving text (leave blank for none)[Select]").
 *
 *  ② 하단 고정바의 'View Reviews' 가 잘린다 (영문몰)
 *     왼쪽 버튼이 85px 인데 영문 글자가 94px → 양옆으로 삐져나가 화면 밖에서 잘린다.
 *     한글 "리뷰 보기"는 들어가서 국문몰에선 안 보이던 문제다.
 *
 *  원칙: **망가진 경우에만** 손댄다. 멀쩡한 레이아웃(데스크탑 좌우 배치 등)은 그대로 둔다.
 *  페일오픈.
 */
(function () {
  "use strict";
  try {
    /* ── ① 각인 입력칸 ───────────────────────────────────────── */
    function fixOptionRow() {
      var input = document.getElementById("add_option_0");
      if (!input || input.getAttribute("data-pvfix")) return !!input;
      var row = input.closest ? input.closest("tr") : null;
      if (!row) return true;

      // 기준 폭 = 표 바깥의 진짜 블록 컨테이너
      var host = row.parentElement;
      while (host && /^(TABLE|TBODY|THEAD|TR|TD|TH)$/.test(host.tagName)) host = host.parentElement;
      var full = host ? host.getBoundingClientRect().width : 0;
      if (!full) return true;
      if (input.getBoundingClientRect().width >= full * 0.8) return true;  // 이미 충분하면 손대지 않는다

      var cells = row.children, stacked = true;
      for (var c = 0; c < cells.length; c++) {
        if (getComputedStyle(cells[c]).display !== "block") { stacked = false; break; }
      }
      // 좌우 배치인데 입력칸이 컨테이너 절반도 안 되면 위아래로 쌓는다(라벨이 길어 짓눌린 경우).
      if (!stacked) {
        if (input.getBoundingClientRect().width >= full * 0.5) return true;
        for (var k = 0; k < cells.length; k++) {
          cells[k].style.display = "block";
          cells[k].style.width = "100%";
          cells[k].style.boxSizing = "border-box";
        }
      }
      // 표 사슬을 컨테이너 폭까지 편다.
      var TABLEISH = { TABLE: 1, TBODY: 1, THEAD: 1, TR: 1, TD: 1, TH: 1 };
      var node = input.parentElement, n = 0;
      while (node && TABLEISH[node.tagName] && n++ < 12) {
        node.style.width = "100%";
        node.style.boxSizing = "border-box";
        // 표 문맥이 끊긴 <tr>(부모가 block)은 블록으로 바꿔야 폭이 내려온다.
        if (node.tagName === "TR" && node.parentElement &&
            getComputedStyle(node.parentElement).display === "block") {
          node.style.display = "block";
        }
        node = node.parentElement;
      }
      input.style.width = "100%";
      input.style.boxSizing = "border-box";
      input.setAttribute("data-pvfix", "1");
      return true;
    }

    /* ── ② 하단 고정바 버튼 잘림 ─────────────────────────────── */
    function fixFooter() {
      var t = document.querySelector(".mobile-fix-footer .fix-toggle-txt");
      if (!t) return;
      var btn = t.parentElement;
      while (btn && !/^(A|BUTTON|SPAN)$/.test(btn.tagName)) btn = btn.parentElement;
      if (!btn || btn.getAttribute("data-pvfix")) return;
      var need = t.getBoundingClientRect().width;
      var have = btn.getBoundingClientRect().width;
      if (!need || need <= have - 8) return;          // 안 잘리면 그대로
      var bar = btn.parentElement;
      if (!bar) return;
      btn.style.flex = "0 0 auto";
      btn.style.width = "auto";
      btn.style.minWidth = Math.ceil(need + 28) + "px";
      btn.style.paddingLeft = "14px";
      btn.style.paddingRight = "14px";
      // 🔑 형제(구매하기)가 **고정 폭**이라 왼쪽만 넓히면 합이 넘쳐 줄바꿈된다.
      //    실측: 왼쪽 85→123 인데 구매하기가 415 고정 → 538 > 500 → 아래로 밀렸다.
      //    남은 폭을 형제가 먹도록 유연하게 바꾼다.
      for (var i = 0; i < bar.children.length; i++) {
        var sib = bar.children[i];
        if (sib === btn) continue;
        sib.style.flex = "1 1 0%";
        sib.style.width = "auto";
        sib.style.minWidth = "0";
      }
      bar.style.flexWrap = "nowrap";
      btn.setAttribute("data-pvfix", "1");
    }

    /* ── ③ 내부 스크롤 상자가 각인칸을 자른다 (해리엇과 같은 고장) ──
     *   영문몰 데스크탑 실측: `div.opt-content { max-height:381px; overflow:auto }` 안에
     *   각인칸이 있고 88px 가 상자 밖으로 숨어 있었다. 그 자리를 TOTAL 블록이 덮는다.
     */
    function unclip() {
      var input = document.getElementById("add_option_0");
      if (!input) return;
      var e = input.parentElement;
      while (e && e !== document.documentElement) {
        var c = getComputedStyle(e);
        if ((c.overflowY === "auto" || c.overflowY === "scroll") && e.scrollHeight > e.clientHeight + 1) {
          e.style.maxHeight = "none";
          e.style.height = "auto";
          e.style.overflow = "visible";
        }
        e = e.parentElement;
      }
    }

    /* ── ④ sticky 칼럼이 뷰포트보다 크면 바닥(구매 버튼)이 영원히 안 보인다 ──
     *   ③으로 칼럼이 더 높아지므로 같이 고쳐야 한다. 칼럼이 화면에 들어가면 손대지 않는다.
     */
    function fitSticky() {
      var input = document.getElementById("add_option_0");
      if (!input) return;
      var e = input.parentElement, col = null;
      while (e && e !== document.documentElement) {
        if (getComputedStyle(e).position === "sticky") { col = e; break; }
        e = e.parentElement;
      }
      if (!col) return;
      if (!col.getAttribute("data-pvtop")) {
        col.setAttribute("data-pvtop", String(parseFloat(getComputedStyle(col).top) || 0));
      }
      var base = parseFloat(col.getAttribute("data-pvtop")) || 0;
      var h = col.getBoundingClientRect().height;
      col.style.top = Math.round(Math.min(base, window.innerHeight - h - 16)) + "px";
    }

    function run() {
      try { fixOptionRow(); } catch (e) {}
      try { unclip(); } catch (e) {}
      try { fixSticky(); } catch (e) {}
      try { fixFooter(); } catch (e) {}
    }
    function fixSticky() { fitSticky(); }

    run();
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
    window.addEventListener("load", run);
    window.addEventListener("resize", run);
    var n = 0;
    var timer = setInterval(function () { run(); if (++n > 16) clearInterval(timer); }, 500);
  } catch (e) { /* 페일오픈 */ }
})();
