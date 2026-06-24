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

  // 손목 둘레(cm) → 손목 너비(px). 케이스(타원)는 실제 비율 고정 px.
  function svg(circ, cw, ch){
    var W=280, H=292, cx=W/2;
    var refMaxDia = 18/Math.PI;            // cm
    var armMaxW = 124;                      // px (최대 둘레일 때 손목 너비)
    var scale = armMaxW / refMaxDia;        // px per cm
    var hw = (circ/Math.PI) * scale / 2;    // 손목 half-width
    var fHW = hw*1.5, aHW = hw*1.16;        // 주먹/팔뚝 half-width
    var rx = (cw/10) * scale / 2, ry = (ch/10) * scale / 2; // 타원 케이스 반경 px
    var yTop=16, yFist=96, yBand=172, yBot=H-4;
    // 팔뚝→손목→주먹 윤곽 (좌우대칭 베지어)
    var arm = "M "+cx+" "+yTop+
      " C "+(cx+fHW*0.8)+" "+yTop+" "+(cx+fHW)+" "+(yTop+38)+" "+(cx+fHW)+" "+(yFist-26)+
      " C "+(cx+fHW)+" "+(yFist+8)+" "+(cx+hw)+" "+(yBand-48)+" "+(cx+hw)+" "+yBand+
      " C "+(cx+hw)+" "+(yBand+38)+" "+(cx+aHW)+" "+(yBot-52)+" "+(cx+aHW)+" "+yBot+
      " L "+(cx-aHW)+" "+yBot+
      " C "+(cx-aHW)+" "+(yBot-52)+" "+(cx-hw)+" "+(yBand+38)+" "+(cx-hw)+" "+yBand+
      " C "+(cx-hw)+" "+(yBand-48)+" "+(cx-fHW)+" "+(yFist+8)+" "+(cx-fHW)+" "+(yFist-26)+
      " C "+(cx-fHW)+" "+(yTop+38)+" "+(cx-fHW*0.8)+" "+yTop+" "+cx+" "+yTop+" Z";
    // 손가락 골(주먹 힌트)
    var grooves="";
    [-0.46,0,0.46].forEach(function(o){var gx=cx+fHW*o;grooves+='<line x1="'+gx+'" y1="'+(yTop+20)+'" x2="'+gx+'" y2="'+(yFist-36)+'" stroke="#aaa093" stroke-width="2" stroke-linecap="round" opacity="0.55"/>';});
    return '<svg width="100%" viewBox="0 0 '+W+' '+H+'" style="max-width:300px;display:block">'+
      '<defs><linearGradient id="pvArm" x1="0" y1="0" x2="1" y2="0">'+
        '<stop offset="0" stop-color="#b6aea2"/><stop offset="0.16" stop-color="#d7d1c6"/><stop offset="0.5" stop-color="#ece7dd"/><stop offset="0.84" stop-color="#d7d1c6"/><stop offset="1" stop-color="#b6aea2"/>'+
      '</linearGradient></defs>'+
      '<path d="'+arm+'" fill="url(#pvArm)" stroke="#b1a698" stroke-width="1"/>'+
      grooves+
      // 손목 밴드(스트랩)
      '<rect x="'+(cx-hw-1)+'" y="'+(yBand-ry*0.32)+'" width="'+(hw*2+2)+'" height="'+(ry*0.64)+'" fill="#46413a" rx="3"/>'+
      // 타원 케이스 (가로 cw, 세로 ch — 12시 방향이 손끝쪽)
      '<ellipse cx="'+cx+'" cy="'+yBand+'" rx="'+rx+'" ry="'+ry+'" fill="#f5f2ed" stroke="#2b2620" stroke-width="2"/>'+
      '<ellipse cx="'+cx+'" cy="'+yBand+'" rx="'+(rx*0.62)+'" ry="'+(ry*0.62)+'" fill="none" stroke="#d4ccc0" stroke-width="1"/>'+
      // 치수 (가로×세로)
      '<text x="'+cx+'" y="'+(yBand+ry+19)+'" text-anchor="middle" font-size="11" fill="'+GOLD+'" font-family="sans-serif">'+cw+' × '+ch+'mm</text>'+
    '</svg>';
  }

  function render(host, cw, ch){
    css();
    var sel = DEFAULT_I;
    function draw(){
      var s=SIZES[sel];
      host.className="pv-tryon";
      host.innerHTML=
        '<div class="hd"><span class="t">TRY IT ON</span><span class="c">케이스 <b>'+cw+' × '+ch+'mm</b></span></div>'+
        '<div class="stage">'+svg(s.circ, cw, ch)+'</div>'+
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
    fetch(API+"?product_no="+encodeURIComponent(pno)+"&mall="+MALL+"&v=2",{credentials:"omit"})
      .then(function(r){return r.json();})
      .then(function(j){
        if(!j||!j.ok)return;
        var cw=Number(j.caseW)||0, ch=Number(j.caseH)||0;
        if(!cw||!ch)return; // 케이스 미설정 상품은 표시 안 함
        render(host, cw, ch);
      }).catch(function(){});
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();
