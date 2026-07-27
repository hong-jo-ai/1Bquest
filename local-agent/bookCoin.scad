// 독서모임 완독 기념 동전 — 영국 빈티지 챌린지코인 무드. 앞/뒷면 따로 출력 후 등맞대 접착.
// CLI: openscad -D 'side="front"' -D 'name="홍길동"' -D 'month="2026. 6"' -o out.stl bookCoin.scad

side  = "front";          // "front" | "back"
name  = "CHOI CHEOLYONG"; // 회원 이름(영문)
book  = "THE LET THEM";   // 완독한 책
month = "JUL 2026";       // 완독 월(영문)
club  = "1% BOOK CLUB";   // 모임 이름
top_text = "ONE MORE CHAPTER";   // 앞면 상단 곡선 문구
bot_text = "1% BOOK CLUB";        // 앞면 하단 곡선 문구

D = 40;        // 지름(mm)
T = 2.6;       // 한 면 두께(두 면 접착 시 ~5.2mm)
emb = 0.8;     // 부조 높이
font  = "Georgia:style=Bold";            // 빈티지 세리프(전부 영문)
fontL = "Georgia:style=Bold";
$fn = 140;

// ---- 부품 ----
module disc() cylinder(d = D, h = T);

// 비즈(구슬) 테두리
module beaded_rim(r, d, n) for (i = [0:n-1]) rotate(i*360/n) translate([0, r]) circle(d = d);

// 안쪽 가는 링(테두리 안쪽 경계)
module ring(ro, ri) difference() { circle(ro); circle(ri); }

// 별
module star(rO, rI=0, pts=5) {
  rI2 = rI > 0 ? rI : rO*0.42;
  polygon([for (i=[0:2*pts-1]) let(a=i*180/pts, rr=(i%2==0?rO:rI2)) [rr*sin(a), rr*cos(a)]]);
}

// 글자 폭맞춤(긴 문자열만 축소). 영문 세리프 대략 폭계수 0.62
module fit2(s, maxw, sz) {
  w = len(s) * sz * 0.62;
  f = min(1, maxw / w);
  scale([f, f, 1]) text(s, size = sz, font = font, halign = "center", valign = "center");
}

// 곡선 글자 (반지름 위에 글자 배치). top=상단(정방향), bottom=하단(뒤집어 정렬)
module arc_text(txt, radius, sz, fnt, bottom=false, gap=1.0) {
  n = len(txt);
  for (i = [0:n-1]) {
    off = (i - (n-1)/2) * gap * (bottom ? 1 : -1);
    rotate(off)
      translate([0, bottom ? -radius : radius])
        rotate(bottom ? 180 : 0)
          text(txt[i], size = sz, font = fnt, halign = "center", valign = "center");
  }
}

// 펼친 책 페이지(오른쪽 반)
pw_ = 11; ph_ = 7;
module page_() polygon([[1.3,-ph_*0.30],[pw_,-ph_*0.58],[pw_,ph_*0.42],[1.3,ph_*0.62]]);
// 펼친 책 엠블럼
module book2d(s=1) scale([s,s,1]) {
  difference() {
    union() { page_(); mirror([1,0,0]) page_(); }
    for (sg=[-1,1]) for (i=[-1.1,1.1]) translate([sg*pw_*0.55, i]) square([pw_*0.5,0.55], center=true);
  }
  translate([0,-ph_*0.62]) polygon([[-pw_*0.5,0],[pw_*0.5,0],[0,-2.2]]); // 책 받침(삼각)
}

// ---- 면 부조 ----
module front_relief() {
  beaded_rim(D/2-1.6, 1.1, 64);
  ring(D/2-2.6, D/2-2.9);
  arc_text(top_text, D/2-5.2, 2.6, fontL, false, 13.0);
  arc_text(bot_text, D/2-5.0, 3.2, font,  true,  12.0);
  translate([0, 2.0]) book2d(1.05);
  for (a=[-1,1]) translate([a*9, 9]) star(1.5);   // 상단 양옆 별
}

module back_relief() {
  beaded_rim(D/2-1.6, 1.1, 66);
  ring(D/2-2.6, D/2-2.9);
  arc_text(club, D/2-4.6, 2.6, font, false, 7.6);          // 상단 곡선 모임명
  for (i=[-2:2]) translate([i*4.4, -D/2+4.4]) star(1.0);   // 하단 별띠
  translate([0,  7.2]) fit2("FINISHED", D-17, 3.2);
  translate([0,  1.0]) fit2(name,  D-17, 6.2);             // 이름(폭맞춤)
  translate([0, -5.8]) fit2(book,  D-17, 3.1);             // 책 제목
  translate([0, -11.6]) text(month, size=3.4, font=font, halign="center", valign="center");
}

disc();
translate([0,0,T]) linear_extrude(emb) {
  if (side == "back") back_relief(); else front_relief();
}
