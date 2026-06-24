/*! Paulvice 착용해보기(Try It On) 위젯 — 상품별 착용 이미지를 모달로.
 *  #pv-tryon-btn 컨테이너에 버튼 주입(착용이미지 있을 때만). product_no는 URL 파싱.
 *  폴바이스 무드: ink/gold/ivory, 미니멀.
 */
(function () {
  "use strict";
  var API = "https://paulvice-dashboard.vercel.app/api/tryon";
  var MALL = "paulvice";
  var GOLD = "#b3935f", INK = "#1c1a17", LINE = "#e7e1d8";

  function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}

  function css(){
    if(document.getElementById("pv-tryon-css"))return;
    var c=document.createElement("style");c.id="pv-tryon-css";
    c.textContent=[
      ".pv-tryon-btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;margin:10px 0 0;padding:14px;font-family:'Noto Sans KR',sans-serif;font-size:14px;font-weight:600;letter-spacing:.04em;color:"+INK+";background:#fff;border:1px solid "+INK+";border-radius:2px;cursor:pointer;transition:.15s}",
      ".pv-tryon-btn:hover{background:"+INK+";color:#fff}",
      ".pv-tryon-btn .ic{font-size:16px}",
      ".pv-tryon-ov{position:fixed;inset:0;background:rgba(20,18,15,.6);z-index:99998;display:flex;align-items:center;justify-content:center;padding:18px;font-family:'Noto Sans KR',sans-serif}",
      ".pv-tryon-modal{background:#fff;border-radius:8px;max-width:460px;width:100%;max-height:92vh;overflow:hidden;display:flex;flex-direction:column;position:relative;box-shadow:0 24px 60px rgba(0,0,0,.3)}",
      ".pv-tryon-modal .hd{display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid "+LINE+"}",
      ".pv-tryon-modal .hd .t{font-size:13px;letter-spacing:.18em;font-weight:700;color:"+INK+"}",
      ".pv-tryon-modal .hd .x{font-size:22px;line-height:1;color:"+INK+";background:none;border:0;cursor:pointer;padding:0 2px}",
      ".pv-tryon-stage{position:relative;background:#f3efe9;overflow:hidden}",
      ".pv-tryon-stage img{display:block;width:100%;height:auto;max-height:74vh;object-fit:contain}",
      ".pv-tryon-nav{position:absolute;top:50%;transform:translateY(-50%);width:38px;height:38px;border-radius:999px;background:rgba(255,255,255,.9);border:1px solid "+LINE+";color:"+INK+";font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center}",
      ".pv-tryon-nav.prev{left:10px}.pv-tryon-nav.next{right:10px}",
      ".pv-tryon-dots{display:flex;gap:6px;justify-content:center;padding:13px 0;background:#fff}",
      ".pv-tryon-dots span{width:7px;height:7px;border-radius:999px;background:"+LINE+";cursor:pointer}",
      ".pv-tryon-dots span.on{background:"+GOLD+"}",
      ".pv-tryon-cap{text-align:center;font-size:11.5px;color:#8c8278;padding:0 18px 14px}"
    ].join("");
    document.head.appendChild(c);
  }

  function openModal(images){
    var i=0;
    var ov=document.createElement("div");ov.className="pv-tryon-ov";
    var multi=images.length>1;
    ov.innerHTML='<div class="pv-tryon-modal">'+
      '<div class="hd"><span class="t">TRY IT ON</span><button class="x" aria-label="close">×</button></div>'+
      '<div class="pv-tryon-stage">'+(multi?'<button class="pv-tryon-nav prev">‹</button><button class="pv-tryon-nav next">›</button>':'')+'<img src="'+esc(images[0])+'" alt="착용 이미지"></div>'+
      (multi?'<div class="pv-tryon-dots">'+images.map(function(_,k){return '<span class="'+(k===0?"on":"")+'" data-i="'+k+'"></span>';}).join("")+'</div>':'')+
      '<div class="pv-tryon-cap">실제 착용 예시입니다. 손목 둘레·조명에 따라 다르게 보일 수 있어요.</div>'+
    '</div>';
    document.body.appendChild(ov);
    document.body.style.overflow="hidden";
    var img=ov.querySelector(".pv-tryon-stage img");
    function show(k){i=(k+images.length)%images.length;img.src=images[i];var ds=ov.querySelectorAll(".pv-tryon-dots span");for(var d=0;d<ds.length;d++)ds[d].className=(d===i?"on":"");}
    function close(){ov.remove();document.body.style.overflow="";}
    ov.querySelector(".x").onclick=close;
    ov.onclick=function(e){if(e.target===ov)close();};
    var pv=ov.querySelector(".prev"),nx=ov.querySelector(".next");
    if(pv)pv.onclick=function(){show(i-1);};if(nx)nx.onclick=function(){show(i+1);};
    var ds=ov.querySelectorAll(".pv-tryon-dots span");for(var d=0;d<ds.length;d++)ds[d].onclick=function(){show(Number(this.getAttribute("data-i")));};
    document.addEventListener("keydown",function esc(e){if(e.key==="Escape"){close();document.removeEventListener("keydown",esc);}});
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
        if(!j||!j.ok||!j.images||!j.images.length)return; // 착용이미지 없으면 버튼 안 보임
        css();
        var b=document.createElement("button");b.type="button";b.className="pv-tryon-btn";
        b.innerHTML='<span class="ic">🕒</span><span>착용해보기</span>';
        b.onclick=function(){openModal(j.images);};
        host.appendChild(b);
      }).catch(function(){});
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();
