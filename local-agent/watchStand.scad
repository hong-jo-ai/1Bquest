// 설월의 처마 워치스탠드 (참고 IMG_9364 반영).
// 단진 받침 + 중앙 묵직한 사각기둥 + 두툼한 곡선 처마빔(왼쪽 높고 오른쪽 길게 내려오다 끝 반전).
// 아이보리 매트. 시계는 처마 앞쪽(낮은 오른쪽)에 걸치고 올라간 끝이 스토퍼.

/* ---- 받침 (이단) ---- */
baseX = 120; baseY = 66;
baseBotZ = 7;            // 아래판
baseTopZ = 6;            // 윗판(살짝 안쪽으로 들어감)
baseTopInset = 5;

/* ---- 기둥 (중앙) ---- */
pilX = 34; pilY = 30;
baseTotZ = baseBotZ + baseTopZ;       // 13
eaveSupportZ = 64;                     // 처마 빔 중심이 기둥에서 닿는 높이대
pilH = eaveSupportZ - baseTotZ;        // 기둥 높이

/* ---- 처마 곡선빔 ---- */
eaveY = 32;              // 빔 깊이(앞뒤)
Hbar = 15;              // 빔 단면 높이(두께) — 볼륨
xL = -60; xR = 82;      // 빔 좌(높음)~우(낮음/끝반전)
xLow = 54; lowZ = 64;   // 최저점 x, 높이
Aleft = 0.0030;         // 좌측 완만한 상승
Aright = 0.0150;        // 우측 끝 가파른 반전(한옥 처마)
steps = 64;

fr = 2.2;               // 라운드 반경
$fn = 64;

/* ---- 헬퍼 ---- */
module rbox(x, y, z, r) hull() for (i=[-1,1],j=[-1,1],k=[-1,1]) translate([i*(x/2-r),j*(y/2-r),k*(z/2-r)]) sphere(r=r,$fn=40);

/* ---- 받침: 아래판 + 안쪽으로 들어간 윗판(단) ---- */
module base() {
  translate([0,0,baseBotZ/2]) rbox(baseX, baseY, baseBotZ, fr);
  translate([0,0,baseBotZ + baseTopZ/2]) rbox(baseX-2*baseTopInset, baseY-2*baseTopInset, baseTopZ, fr);
}

/* ---- 기둥 ---- */
module pillar() translate([0,0,baseTotZ - 1]) linear_extrude(pilH+1) offset(r=3) offset(r=-3) square([pilX,pilY], center=true);

/* ---- 처마 곡선빔 (중심선 ez(x), 수직단면 Hbar, 깊이 eaveY) ---- */
function ez(x) = lowZ + (x <= xLow ? Aleft : Aright) * pow(x - xLow, 2);
function slope(x) = (ez(x+0.05) - ez(x-0.05)) / 0.1;
function nn(x) = sqrt(slope(x)*slope(x) + 1);

module eave() {
  pts_top = [ for (i=[0:steps]) let(x = xL + (xR-xL)*i/steps) [ x - slope(x)/nn(x)*Hbar/2, ez(x) + 1/nn(x)*Hbar/2 ] ];
  pts_bot = [ for (i=[steps:-1:0]) let(x = xL + (xR-xL)*i/steps) [ x + slope(x)/nn(x)*Hbar/2, ez(x) - 1/nn(x)*Hbar/2 ] ];
  rotate([90,0,0])
    linear_extrude(eaveY, center=true)
      offset(r=1.8) offset(r=-1.8)
        polygon(concat(pts_top, pts_bot));
}

union() {
  base();
  pillar();
  eave();
}
