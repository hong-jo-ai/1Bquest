// 독서모임 완독 기념 메달 — 펼친 책 모양 + "완독 / 이름 / 월" 각인 + 리본 고리.
// 파라메트릭: 이름·월만 바꿔 사람마다 생성. CLI: openscad -D 'name="홍길동"' -D 'month="2026. 6"' -o out.stl bookMedal.scad

name  = "홍길동";        // 회원 이름
month = "2026. 6";       // 완독 월
title = "완독";          // 상단 문구

W = 58; H = 54; T = 4.5; // 메달 폭/높이/두께(mm)
rad = 5;                 // 모서리 라운드
emb = 1.0;               // 각인(부조) 높이
font = "NanumGothic:style=Bold";
$fn = 64;

module rrect(w, h, r) {
  hull() for (x = [-1, 1], y = [-1, 1])
    translate([x * (w/2 - r), y * (h/2 - r)]) circle(r);
}

// 펼친 책 2D 엠블럼 — 가운데 책등 간격을 둔 채워진 두 페이지(깔끔)
module book2d() {
  pw = 13; ph = 8;
  module page() {        // 오른쪽 페이지: 안쪽 낮고 바깥 들린 펼침감
    polygon([[1.4, -ph*0.30], [pw, -ph*0.58], [pw, ph*0.42], [1.4, ph*0.60]]);
  }
  difference() {
    union() { page(); mirror([1, 0, 0]) page(); }
    // 페이지 위 줄 디테일(파임)
    for (s = [-1, 1], i = [-1.3, 1.3])
      translate([s * pw * 0.55, i]) square([pw * 0.5, 0.6], center = true);
  }
}

// 이름: 기본 크기 유지, 폭 초과(긴 이름)일 때만 축소 (짧은 이름 확대 방지)
module fit(s, maxw, sz) {
  w = len(s) * sz * 1.02;          // 한글 ≈ 정사각 폭 근사
  f = min(1, maxw / w);
  scale([f, f, 1])
    text(s, size = sz, font = font, halign = "center", valign = "center");
}

// 본체 + 리본 고리
module body() {
  linear_extrude(T) {
    rrect(W, H, rad);
    translate([0, H/2 + 3.5]) difference() { circle(6.8); circle(3.4); } // 리본 고리
  }
}

// 윗면 부조 (테두리 + 엠블럼 + 글자)
module relief() {
  translate([0, 0, T]) linear_extrude(emb) {
    difference() { rrect(W-4, H-4, rad-1); rrect(W-7, H-7, rad-2); } // 테두리 프레임
    translate([0,  17]) book2d();                  // 펼친 책 엠블럼(상단)
    translate([0,   7]) text(title, size = 6, font = font, halign = "center", valign = "center");
    translate([0,  -7]) fit(name, W - 16, 10);     // 이름(가운데, 폭맞춤)
    translate([0, -20]) text(month, size = 5, font = font, halign = "center", valign = "center");
  }
}

body();
relief();
