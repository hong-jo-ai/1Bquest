/*! Paulvice 착용 사이즈 가이드(Try It On) — 손목 둘레 선택 → SVG로 케이스 상대크기 가늠.
 *  #pv-tryon-btn 컨테이너에 인라인 렌더. product_no=URL 파싱, 케이스mm=/api/tryon.
 *  실제 시계 이미지 아님 — 크기 짐작용 단순 도형. 폴바이스 무드.
 */
(function () {
  "use strict";
  var API = "https://paulvice-dashboard.vercel.app/api/tryon";
  var MALL = "paulvice";
  var GOLD = "#b3935f", INK = "#1c1a17", SUB = "#8c8278", LINE = "#e7e1d8", IVORY = "#faf8f5";
  // 손목 둘레 구간(cm) + 체감. circ=SVG 렌더용 대표 둘레.
  var SIZES = [
    { circ: 13,   label: "13.5cm 이하", sub: "매우 가는 손목" },
    { circ: 14.5, label: "14~15cm",    sub: "한국 여성 평균" },
    { circ: 15.5, label: "15~16cm",    sub: "평균 이상" },
    { circ: 16.5, label: "16cm 이상",  sub: "비교적 굵은 손목" }
  ];
  var DEFAULT_I = 1; // 14~15cm 평균

  function css(){
    if(document.getElementById("pv-tryon-css"))return;
    var c=document.createElement("style");c.id="pv-tryon-css";
    c.textContent=[
      ".pv-tryon{font-family:'Noto Sans KR',sans-serif;color:"+INK+";border:1px solid "+LINE+";border-radius:6px;background:#fff;overflow:hidden;margin:12px 0 2px}",
      ".pv-tryon *{box-sizing:border-box}",
      ".pv-tryon .hd{display:flex;align-items:baseline;justify-content:space-between;padding:14px 16px 10px}",
      ".pv-tryon .hd .t{font-size:12px;letter-spacing:.18em;font-weight:700}",
      ".pv-tryon .hd .c{font-size:12px;color:"+SUB+"}",
      ".pv-tryon .hd .c b{color:"+INK+"}",
      ".pv-tryon .stage{background:"+IVORY+";padding:6px 0 2px;display:flex;justify-content:center}",
      ".pv-tryon .lbl{text-align:center;font-size:12px;color:"+SUB+";padding:6px 16px 2px}",
      ".pv-tryon .lbl b{color:"+INK+"}",
      ".pv-tryon .sizes{display:grid;grid-template-columns:repeat(2,1fr);gap:7px;padding:10px 16px 6px}",
      ".pv-tryon .sizes button{font:inherit;font-size:12.5px;padding:10px 8px;border:1px solid "+LINE+";background:#fff;border-radius:4px;color:"+SUB+";cursor:pointer;transition:.12s;white-space:nowrap}",
      ".pv-tryon .sizes button.on{background:"+INK+";color:#fff;border-color:"+INK+";font-weight:600}",
      ".pv-tryon .note{font-size:11px;color:"+SUB+";text-align:center;padding:2px 16px 14px;line-height:1.5}"
    ].join("");
    document.head.appendChild(c);
  }

  // 손목 둘레(cm) → 보이는 팔 너비(px). 케이스는 고정 px(실제크기).
  function svg(circ, caseMm){
    var W=280, H=270, cx=W/2;
    var refMaxDia = 18/Math.PI;            // cm, 최대 둘레 기준 지름
    var armMaxW = 132;                      // px, 최대일 때 팔 너비
    var scale = armMaxW / refMaxDia;        // px per cm
    var armW = (circ/Math.PI) * scale;      // 선택 둘레 → 팔 너비
    var caseD = (caseMm/10) * scale;        // 케이스 지름 px (고정)
    var bandY = 158, armTop = 26, armBot = H-8;
    var ax = cx - armW/2;
    var caseR = caseD/2;
    // 팔(원통) + 손끝 힌트 + 시계밴드 + 케이스
    return '<svg width="100%" viewBox="0 0 '+W+' '+H+'" style="max-width:300px;display:block">'+
      '<defs><linearGradient id="pvArm" x1="0" y1="0" x2="1" y2="0">'+
        '<stop offset="0" stop-color="#c7c0b6"/><stop offset="0.5" stop-color="#e8e2d8"/><stop offset="1" stop-color="#c7c0b6"/>'+
      '</linearGradient></defs>'+
      // 손(주먹) 힌트 — 팔 위쪽 둥근 블롭
      '<ellipse cx="'+cx+'" cy="'+(armTop+10)+'" rx="'+(armW*0.62)+'" ry="'+(armW*0.42)+'" fill="url(#pvArm)"/>'+
      // 팔(원통)
      '<rect x="'+ax+'" y="'+armTop+'" width="'+armW+'" height="'+(armBot-armTop)+'" rx="'+(armW/2)+'" fill="url(#pvArm)"/>'+
      // 시계 밴드(손목 감싸는 띠)
      '<rect x="'+ax+'" y="'+(bandY-caseR*0.42)+'" width="'+armW+'" height="'+(caseR*0.84)+'" fill="#4a453e" rx="3"/>'+
      // 케이스(원) — 고정 크기, 손목보다 클 수도
      '<circle cx="'+cx+'" cy="'+bandY+'" r="'+caseR+'" fill="#f4f1ec" stroke="#2b2620" stroke-width="2"/>'+
      '<circle cx="'+cx+'" cy="'+bandY+'" r="'+(caseR*0.62)+'" fill="none" stroke="#cfc7bb" stroke-width="1"/>'+
      // 케이스 지름 치수선
      '<line x1="'+(cx-caseR)+'" y1="'+(bandY+caseR+14)+'" x2="'+(cx+caseR)+'" y2="'+(bandY+caseR+14)+'" stroke="'+GOLD+'" stroke-width="1"/>'+
      '<text x="'+cx+'" y="'+(bandY+caseR+28)+'" text-anchor="middle" font-size="11" fill="'+GOLD+'" font-family="sans-serif">'+caseMm+'mm</text>'+
    '</svg>';
  }

  function render(host, caseMm){
    css();
    var sel = DEFAULT_I;
    function draw(){
      var s=SIZES[sel];
      host.className="pv-tryon";
      host.innerHTML=
        '<div class="hd"><span class="t">TRY IT ON</span><span class="c">케이스 <b>약 '+caseMm+'mm</b></span></div>'+
        '<div class="stage">'+svg(s.circ, caseMm)+'</div>'+
        '<div class="lbl">내 손목 둘레: <b>'+s.label+'</b> · '+s.sub+'</div>'+
        '<div class="sizes">'+SIZES.map(function(x,i){return '<button data-i="'+i+'" class="'+(i===sel?"on":"")+'">'+x.label+'</button>';}).join("")+'</div>'+
        '<div class="note">손목 둘레를 선택하면 케이스가 상대적으로 어느 정도 크기인지 가늠할 수 있어요. (실제 시계 모양 아님 · 참고용)</div>';
      var bs=host.querySelectorAll(".sizes button");
      for(var i=0;i<bs.length;i++)bs[i].addEventListener("click",function(){sel=Number(this.getAttribute("data-i"));draw();});
    }
    draw();
  }

  function getProductNo(el){
    var d=el&&el.getAttribute("data-product-no");if(d&&/^\d+$/.test(d))return d;
    var q=new URLSearchParams(location.search).get("product_no");if(q&&/^\d+$/.test(q))return q;
    var m=location.pathname.match(/\/product\/[^\/?]+\/(\d+)(?:[\/?]|$)/);if(m)return m[1];
    var c=document.querySelector('link[rel="canonical"]');
    if(c){var cm=(c.href||"").match(/\/product\/[^\/?]+\/(\d+)(?:[\/?]|$)/);if(cm)return cm[1];}
    return null;
  }

  function init(){
    var host=document.getElementById("pv-tryon-btn");if(!host)return;
    var pno=getProductNo(host);if(!pno)return;
    fetch(API+"?product_no="+encodeURIComponent(pno)+"&mall="+MALL,{credentials:"omit"})
      .then(function(r){return r.json();})
      .then(function(j){
        if(!j||!j.ok)return;
        var caseMm=Number(j.case)||0;
        if(!caseMm)return; // 케이스 미설정 상품은 표시 안 함
        render(host, caseMm);
      }).catch(function(){});
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();
