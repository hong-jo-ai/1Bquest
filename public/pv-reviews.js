/*! Paulvice 리뷰 위젯 — 자체 스토어프론트 리뷰 노출 (리뷰에이드 대체)
 *  컨테이너에 data-product-no 를 주면 /api/reviews/widget 에서 읽어 렌더.
 *  - #pv-review-list      : 하단 커스텀 리뷰 리스트
 *  - #pv-review-photostrip: 썸네일 밑 포토 가로 스트립
 *  - #pv-review-phototop  : 상세 상단 포토 그리드
 *  폴바이스 무드: 미니멀·모던·럭셔리 / ink·gold·ivory.
 */
(function () {
  "use strict";
  var API = "https://paulvice-dashboard.vercel.app/api/reviews/widget";
  var MALL = "paulvice";
  var GOLD = "#b3935f", INK = "#1c1a17", SUB = "#8c8278", LINE = "#ece7df", IVORY = "#faf8f5";

  function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
  function stars(n){var f=Math.round(n||0),s="";for(var i=1;i<=5;i++)s+='<span style="color:'+(i<=f?GOLD:"#dcd7cf")+'">★</span>';return s;}

  function injectCss(){
    if(document.getElementById("pv-rv-css"))return;
    var c=document.createElement("style");c.id="pv-rv-css";
    c.textContent=[
      ".pv-rv{font-family:'Noto Sans KR',AppleSDGothicNeo,sans-serif;color:"+INK+";box-sizing:border-box}",
      ".pv-rv *{box-sizing:border-box}",
      ".pv-rv-strip{display:flex;gap:8px;overflow-x:auto;padding:14px 0;-webkit-overflow-scrolling:touch}",
      ".pv-rv-strip::-webkit-scrollbar{height:0}",
      ".pv-rv-strip img{width:84px;height:84px;object-fit:cover;border-radius:10px;flex:0 0 auto;cursor:pointer;border:1px solid "+LINE+"}",
      ".pv-rv-topgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:0 0 8px}",
      ".pv-rv-topgrid img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;cursor:pointer}",
      ".pv-rv-head{display:flex;align-items:baseline;gap:12px;padding:22px 0 6px;border-top:1px solid "+INK+"}",
      ".pv-rv-head .t{font-size:17px;font-weight:700;letter-spacing:.02em}",
      ".pv-rv-head .avg{font-size:15px;color:"+GOLD+";font-weight:700}",
      ".pv-rv-head .cnt{font-size:13px;color:"+SUB+"}",
      ".pv-rv-filter{display:flex;gap:8px;margin:10px 0 4px}",
      ".pv-rv-filter button{font:inherit;font-size:12px;padding:6px 12px;border:1px solid "+LINE+";background:#fff;border-radius:999px;color:"+SUB+";cursor:pointer}",
      ".pv-rv-filter button.on{background:"+INK+";color:#fff;border-color:"+INK+"}",
      ".pv-rv-card{padding:18px 0;border-bottom:1px solid "+LINE+"}",
      ".pv-rv-card .meta{display:flex;align-items:center;gap:8px;font-size:13px;color:"+SUB+";margin:0 0 7px}",
      ".pv-rv-card .meta .au{color:"+INK+";font-weight:600}",
      ".pv-rv-card .star{letter-spacing:1px;font-size:13px}",
      ".pv-rv-card .body{font-size:14px;line-height:1.7;white-space:pre-line;word-break:break-word}",
      ".pv-rv-card .ph{display:flex;gap:6px;margin:10px 0 0;flex-wrap:wrap}",
      ".pv-rv-card .ph img{width:72px;height:72px;object-fit:cover;border-radius:8px;cursor:pointer;border:1px solid "+LINE+"}",
      ".pv-rv-more{display:block;width:100%;margin:18px 0 0;padding:13px;font:inherit;font-size:13px;letter-spacing:.04em;background:#fff;border:1px solid "+INK+";color:"+INK+";border-radius:2px;cursor:pointer}",
      ".pv-rv-empty{padding:26px 0;text-align:center;color:"+SUB+";font-size:13px}",
      ".pv-rv-lb{position:fixed;inset:0;background:rgba(20,18,15,.92);z-index:99999;display:flex;align-items:center;justify-content:center;cursor:zoom-out}",
      ".pv-rv-lb img{max-width:92vw;max-height:88vh;border-radius:6px}"
    ].join("");
    document.head.appendChild(c);
  }

  function lightbox(src){var o=document.createElement("div");o.className="pv-rv-lb";o.innerHTML='<img src="'+esc(src)+'">';o.onclick=function(){o.remove();};document.body.appendChild(o);}
  function bindImgs(root){var ig=root.querySelectorAll("img[data-full]");for(var i=0;i<ig.length;i++){ig[i].addEventListener("click",function(){lightbox(this.getAttribute("data-full"));});}}

  function renderStrip(el,data){
    var ph=[];data.reviews.forEach(function(r){r.photos.forEach(function(u){ph.push(u);});});
    if(!ph.length){el.style.display="none";return;}
    el.className="pv-rv pv-rv-strip";
    el.innerHTML=ph.slice(0,20).map(function(u){return '<img src="'+esc(u)+'" data-full="'+esc(u)+'" loading="lazy">';}).join("");
    bindImgs(el);
  }
  function renderTop(el,data){
    var ph=[];data.reviews.forEach(function(r){r.photos.forEach(function(u){ph.push(u);});});
    if(!ph.length){el.style.display="none";return;}
    el.className="pv-rv";
    el.innerHTML='<div class="pv-rv-topgrid">'+ph.slice(0,8).map(function(u){return '<img src="'+esc(u)+'" data-full="'+esc(u)+'" loading="lazy">';}).join("")+'</div>';
    bindImgs(el);
  }
  function renderList(el,data){
    el.className="pv-rv";
    var s=data.summary||{};
    var state={photoOnly:false,shown:5};
    function card(r){
      return '<div class="pv-rv-card"><div class="meta"><span class="star">'+stars(r.rating)+'</span><span class="au">'+esc(r.author)+'</span><span>'+esc(r.date)+'</span></div>'+
        (r.content?'<div class="body">'+esc(r.content)+'</div>':'')+
        (r.photos.length?'<div class="ph">'+r.photos.map(function(u){return '<img src="'+esc(u)+'" data-full="'+esc(u)+'" loading="lazy">';}).join("")+'</div>':'')+
        '</div>';
    }
    function draw(){
      var list=state.photoOnly?data.reviews.filter(function(r){return r.photos.length;}):data.reviews;
      var head='<div class="pv-rv-head"><span class="t">REVIEW</span>'+(s.count?'<span class="avg">★ '+(s.avg||0).toFixed(1)+'</span><span class="cnt">('+s.count+')</span>':'')+'</div>'+
        '<div class="pv-rv-filter"><button data-f="all" class="'+(state.photoOnly?"":"on")+'">전체 '+data.reviews.length+'</button><button data-f="photo" class="'+(state.photoOnly?"on":"")+'">포토 '+(s.photoCount||0)+'</button></div>';
      var body=list.length?list.slice(0,state.shown).map(card).join(""):'<div class="pv-rv-empty">아직 등록된 후기가 없습니다.</div>';
      var more=list.length>state.shown?'<button class="pv-rv-more">후기 더보기 (+'+(list.length-state.shown)+')</button>':"";
      el.innerHTML=head+body+more;
      var fb=el.querySelectorAll(".pv-rv-filter button");for(var i=0;i<fb.length;i++)fb[i].addEventListener("click",function(){state.photoOnly=this.getAttribute("data-f")==="photo";state.shown=5;draw();});
      var mb=el.querySelector(".pv-rv-more");if(mb)mb.addEventListener("click",function(){state.shown+=10;draw();});
      bindImgs(el);
    }
    draw();
  }

  var cache={};
  function load(pno,cb){
    if(cache[pno])return cb(cache[pno]);
    fetch(API+"?product_no="+encodeURIComponent(pno)+"&mall="+MALL,{credentials:"omit"})
      .then(function(r){return r.json();})
      .then(function(j){if(!j||!j.ok)j={ok:false,reviews:[],summary:{count:0}};cache[pno]=j;cb(j);})
      .catch(function(){cb({ok:false,reviews:[],summary:{count:0}});});
  }

  function init(){
    injectCss();
    var targets=[["pv-review-photostrip",renderStrip],["pv-review-phototop",renderTop],["pv-review-list",renderList]];
    var els=[],pno=null;
    targets.forEach(function(t){var e=document.getElementById(t[0]);if(e){els.push([e,t[1]]);if(!pno)pno=e.getAttribute("data-product-no");}});
    if(!els.length||!pno||!/^\d+$/.test(pno))return;
    load(pno,function(data){els.forEach(function(p){try{p[1](p[0],data);}catch(e){}});});
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();
