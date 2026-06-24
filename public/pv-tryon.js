/*! Paulvice 착용 사이즈 가이드(Try It On) — 실사 여성 손목 사진 + 타원 시계 오버레이.
 *  손목 둘레 선택 → 시계가 상대적으로 커지/작아져 케이스 크기 가늠.
 *  #pv-tryon-btn 인라인 렌더. product_no=URL, 케이스(가로/세로 mm)=/api/tryon.
 */
(function () {
  "use strict";
  var API = "https://paulvice-dashboard.vercel.app/api/tryon";
  var MALL = "paulvice";
  var WRIST = "https://ecimg.cafe24img.com/pg799b36658487045/icaruse2000/web/product/tryon/wrist.png";
  var GOLD = "#b3935f", INK = "#1c1a17", SUB = "#8c8278", LINE = "#e7e1d8", IVORY = "#faf8f5";
  // 손목 둘레 구간 + 체감. circ=대표 둘레(cm). REF=베이스 사진의 기준 둘레.
  var SIZES = [
    { circ: 13,   label: "13.5cm 이하", sub: "매우 가는 손목" },
    { circ: 14.5, label: "14~15cm",    sub: "한국 여성 평균" },
    { circ: 15.5, label: "15~16cm",    sub: "평균 이상" },
    { circ: 16.5, label: "16cm 이상",  sub: "비교적 굵은 손목" }
  ];
  var DEFAULT_I = 1, REF = 15;
  // 손목 사진 측정값: 손목(가장 잘록) 중심·폭(컨테이너 %). 실제 손목폭 ≈53mm 가정.
  var WRIST_X = 51, WRIST_Y = 45, WRIST_W = 21, WRIST_MM = 53;

  function css(){
    if(document.getElementById("pv-tryon-css"))return;
    var c=document.createElement("style");c.id="pv-tryon-css";
    c.textContent=[
      ".pv-tryon{font-family:'Noto Sans KR',sans-serif;color:"+INK+";border:1px solid "+LINE+";border-radius:6px;background:#fff;overflow:hidden;margin:12px 0 2px}",
      ".pv-tryon *{box-sizing:border-box}",
      ".pv-tryon .hd{display:flex;align-items:baseline;justify-content:space-between;padding:14px 16px 8px}",
      ".pv-tryon .hd .t{font-size:12px;letter-spacing:.18em;font-weight:700}",
      ".pv-tryon .hd .c{font-size:12px;color:"+SUB+"}.pv-tryon .hd .c b{color:"+INK+"}",
      ".pv-tryon .stage{background:"+IVORY+";display:flex;justify-content:center;padding:4px 0}",
      ".pv-wrist{position:relative;width:100%;max-width:280px;overflow:hidden}",
      ".pv-wrist img.base{width:100%;display:block;transition:transform .25s ease}",
      ".pv-strap{position:absolute;transform:translate(-50%,-50%);background:#46413a;border-radius:3px;height:14px;opacity:.95;z-index:1;transition:width .25s ease}",
      ".pv-case{position:absolute;transform:translate(-50%,-50%);border:2.5px solid #2b2620;border-radius:50%;background:rgba(245,242,237,.9);box-shadow:0 1px 4px rgba(0,0,0,.18);z-index:2;display:flex;align-items:center;justify-content:center}",
      ".pv-case::after{content:'';width:62%;height:62%;border:1px solid #cfc7ba;border-radius:50%}",
      ".pv-tryon .lbl{text-align:center;font-size:12px;color:"+SUB+";padding:8px 16px 2px}.pv-tryon .lbl b{color:"+INK+"}",
      ".pv-tryon .sizes{display:grid;grid-template-columns:repeat(2,1fr);gap:7px;padding:10px 16px 6px}",
      ".pv-tryon .sizes button{font:inherit;font-size:12.5px;padding:10px 8px;border:1px solid "+LINE+";background:#fff;border-radius:4px;color:"+SUB+";cursor:pointer;transition:.12s;white-space:nowrap}",
      ".pv-tryon .sizes button.on{background:"+INK+";color:#fff;border-color:"+INK+";font-weight:600}",
      ".pv-tryon .note{font-size:11px;color:"+SUB+";text-align:center;padding:2px 16px 14px;line-height:1.5}"
    ].join("");
    document.head.appendChild(c);
  }

  function render(host, cw, ch){
    css();
    var sel = DEFAULT_I;
    // 90도 회전: 화면 가로=긴축(ch=32), 세로=짧은축(cw=22). 시계는 고정 크기.
    var caseWpct = (ch/WRIST_MM)*WRIST_W;        // 손목폭 대비 실제 비율(고정)
    function draw(){
      var s=SIZES[sel];
      var f = s.circ/REF;                         // 손목 두께 배율(평균=1). 사진만 가로 스케일.
      host.className="pv-tryon";
      host.innerHTML=
        '<div class="hd"><span class="t">TRY IT ON</span><span class="c">케이스 <b>'+cw+' × '+ch+'mm</b></span></div>'+
        '<div class="stage"><div class="pv-wrist">'+
          '<img class="base" style="transform:scaleX('+f.toFixed(3)+');transform-origin:'+WRIST_X+'% '+WRIST_Y+'%" src="'+WRIST+'" alt="손목 사이즈 가이드">'+
          '<div class="pv-strap" style="left:'+WRIST_X+'%;top:'+WRIST_Y+'%;width:'+(WRIST_W*f).toFixed(1)+'%"></div>'+
          '<div class="pv-case" style="left:'+WRIST_X+'%;top:'+WRIST_Y+'%;width:'+caseWpct.toFixed(1)+'%;aspect-ratio:'+ch+'/'+cw+'"></div>'+
        '</div></div>'+
        '<div class="lbl">내 손목 둘레: <b>'+s.label+'</b> · '+s.sub+'</div>'+
        '<div class="sizes">'+SIZES.map(function(x,i){return '<button data-i="'+i+'" class="'+(i===sel?"on":"")+'">'+x.label+'</button>';}).join("")+'</div>'+
        '<div class="note">손목 둘레를 선택하면 케이스가 상대적으로 어느 정도 크기인지 가늠할 수 있어요. (참고용)</div>';
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
    fetch(API+"?product_no="+encodeURIComponent(pno)+"&mall="+MALL+"&v=3",{credentials:"omit"})
      .then(function(r){return r.json();})
      .then(function(j){
        if(!j||!j.ok)return;
        var cw=Number(j.caseW)||0, ch=Number(j.caseH)||0;
        if(!cw||!ch)return;
        render(host, cw, ch);
      }).catch(function(){});
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();
