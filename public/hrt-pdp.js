/*! 해리엇 상세페이지(데스크탑) 두 가지 고장 수리 — 2026-09-26
 *
 *  ① 각인 입력칸이 안 보인다
 *     오른쪽 정보 칼럼 안에 `.-nonanoScroll`(max-height:338px; overflow:auto) 이라는
 *     **작은 내부 스크롤 상자**가 있고, 각인 추가옵션이 그 상자의 아래로 잘려 있다.
 *     실측: 내용 428px / 보이는 높이 338px → **90px 가 숨음**(= 각인칸이 통째로 숨는다).
 *     고객은 그 작은 상자 안에서 스크롤해야 한다는 걸 알 길이 없다 →
 *     "각인 문구 입력칸을 못 찾겠다"는 문의로 이어졌다(사장님 2026-09-26).
 *     → 내부 스크롤을 없애고 내용 전체를 흐름에 둔다.
 *
 *  ② 구매 버튼이 안 보이고, 스크롤해도 오른쪽이 안 움직인다
 *     정보 칼럼 `#cd-nav` 가 `position:sticky; top:150px`. 칼럼이 뷰포트보다 높으면
 *     **위쪽 150px 에 붙박이로 고정된 채 아래쪽(구매 버튼)이 영원히 화면 밖**에 남는다.
 *     상세 이미지가 22,000px 이라 그 구간 내내 칼럼은 1px 도 움직이지 않는다.
 *     실측(뷰포트 1470×740): 국문 칼럼 780px·영문 991px → 바닥이 930/1141 → 둘 다 화면 밖.
 *     영문몰이 더 심한 건 설명이 길어 칼럼이 211px 더 높기 때문.
 *     → 칼럼이 뷰포트보다 높으면 top 을 음수로 내려 **끝까지 스크롤하면 바닥이 드러나게** 한다.
 *       (칼럼이 뷰포트에 들어가면 원래대로 top:150px 유지)
 *
 *  국문몰(shop1)·영문몰(shop2) 공통. 구조가 같아 한 파일로 처리한다.
 *  페일오픈: 어디서 실패하든 조용히 끝낸다. 롤백 = 스크립트태그 삭제.
 */
(function () {
  "use strict";
  try {
    var GAP = 16;        // 칼럼 바닥과 화면 바닥 사이 여유
    var BASE_TOP = 150;  // 스킨 원래 값(고정 헤더 자리)

    function unclip() {
      // 내부 스크롤 상자 제거 — 각인칸을 흐름 안으로 되돌린다.
      var boxes = document.querySelectorAll("#cd-nav .-nonanoScroll, #cd-nav .nano, #cd-nav .-nonano");
      for (var i = 0; i < boxes.length; i++) {
        var b = boxes[i];
        var cs = getComputedStyle(b);
        if (cs.overflowY === "auto" || cs.overflowY === "scroll" || b.style.maxHeight) {
          b.style.maxHeight = "none";
          b.style.height = "auto";
          b.style.overflow = "visible";
        }
      }
    }

    function fitSticky() {
      var col = document.getElementById("cd-nav");
      if (!col) return;
      // 스킨이 sticky 로 잡아둔 경우에만 건드린다(모바일 레이아웃은 그대로).
      if (getComputedStyle(col).position !== "sticky") return;
      var h = col.getBoundingClientRect().height;
      var top = Math.min(BASE_TOP, window.innerHeight - h - GAP);
      col.style.top = Math.round(top) + "px";
    }

    function apply() { try { unclip(); fitSticky(); } catch (e) {} }

    apply();
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", apply);
    window.addEventListener("load", apply);
    window.addEventListener("resize", fitSticky);

    // 칼럼 높이는 나중에 바뀐다 — 옵션 선택, 수량 변경, 각인 미리보기 버튼 주입 등.
    try {
      var col = document.getElementById("cd-nav");
      if (col && window.ResizeObserver) new ResizeObserver(fitSticky).observe(col);
    } catch (e) {}
    // 스킨 JS 가 나중에 내부 스크롤을 다시 켜는 경우를 대비해 잠깐 더 지켜본다.
    var n = 0;
    var t = setInterval(function () { apply(); if (++n > 10) clearInterval(t); }, 500);
  } catch (e) { /* 페일오픈 */ }
})();
