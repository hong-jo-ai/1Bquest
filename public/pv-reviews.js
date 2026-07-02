/*! Paulvice 리뷰 위젯 — 자체 스토어프론트 리뷰 노출 (리뷰에이드 대체)
 *  컨테이너 id 로 렌더 위치 지정. product_no 는 URL/canonical 에서 파싱.
 *  - #pv-review-list      : 하단 리뷰 섹션(요약 + 분포막대 + 포토스트립 + 카드)
 *  - #pv-review-photostrip: 썸네일 밑 포토 가로 스트립
 *  - #pv-review-phototop  : 상세 상단 포토 그리드
 *  폴바이스 무드: 미니멀·모던·럭셔리 / ink·gold·ivory.
 */
(function () {
  "use strict";
  var API = "https://paulvice-dashboard.vercel.app/api/reviews/widget";
  var MALL = "paulvice"; // 컨테이너 data-mall 로 덮어씀(해리엇=harriot). 미지정 시 폴바이스.
  var GOLD = "#b3935f", INK = "#1c1a17", SUB = "#8c8278", LINE = "#e7e1d8", IVORY = "#faf8f5", TRACK = "#ebe6dd";
  // 영문몰 감지 (html lang=en, paulvice.kr, 또는 컨테이너 data-lang="en") → 영문 라벨
  var L_EN = {
    reviews:function(n){return n+" review"+(n==1?"":"s");}, photo:" · ", photoN:function(n){return n+" photos";},
    viewAll:"View all ›", photoTitle:"Customer Photo Reviews", more:"more", verified:"Verified Purchase",
    aiSummary:"Review Summary", all:"All ", photoFilter:"📷 Photos ", empty:"No reviews yet. Be the first to write one.", moreReviews:function(n){return "View more reviews (+"+n+")";}
  };
  var L_KO = {
    reviews:function(n){return "리뷰 "+n+"개";}, photo:" · 포토 ", photoN:function(n){return n;},
    viewAll:"전체보기 ›", photoTitle:"고객 포토 후기", more:"더보기", verified:"구매확인",
    aiSummary:"리뷰 요약", all:"전체 ", photoFilter:"📷 포토 ", empty:"아직 등록된 후기가 없습니다. 첫 후기를 남겨보세요.", moreReviews:function(n){return "후기 더보기 (+"+n+")";}
  };
  var EN = /^en/i.test((document.documentElement.getAttribute("lang")||"")) || /paulvice\.kr/i.test(location.hostname);
  var L = EN ? L_EN : L_KO;

  function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
  function stars(n,size){var f=Math.round(n||0),s='<span style="letter-spacing:1px;font-size:'+(size||13)+'px">';for(var i=1;i<=5;i++)s+='<span style="color:'+(i<=f?GOLD:"#dcd7cf")+'">★</span>';return s+"</span>";}

  function injectCss(){
    if(document.getElementById("pv-rv-css"))return;
    var c=document.createElement("style");c.id="pv-rv-css";
    c.textContent=[
      ".pv-rv{font-family:'Noto Sans KR',AppleSDGothicNeo,sans-serif;color:"+INK+";box-sizing:border-box;font-size:14px;line-height:1.6}",
      ".pv-rv *{box-sizing:border-box}",
      // 상단 타이틀
      ".pv-rv-ttl{font-size:13px;letter-spacing:.22em;font-weight:700;color:"+INK+";text-align:center;padding:8px 0 18px;border-top:1px solid "+INK+";margin-top:6px}",
      // AI 요약 박스
      ".pv-rv-ai{background:linear-gradient(180deg,#fbf9f5,#fff);border:1px solid "+LINE+";border-radius:8px;padding:16px 18px;margin:0 0 16px}",
      ".pv-rv-ai .h{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:700;color:"+INK+";margin:0 0 9px}",
      ".pv-rv-ai .aibadge{font-size:10px;font-weight:800;letter-spacing:.06em;color:#fff;background:"+GOLD+";border-radius:4px;padding:2px 6px}",
      ".pv-rv-ai .tx{font-size:13.5px;line-height:1.72;color:#33302b}",
      ".pv-rv-ai .kw{display:flex;flex-wrap:wrap;gap:6px;margin:12px 0 0}",
      ".pv-rv-ai .kw span{font-size:11.5px;color:"+INK+";background:"+IVORY+";border:1px solid "+LINE+";border-radius:999px;padding:4px 11px}",
      // 요약 블록
      ".pv-rv-sum{display:flex;gap:22px;align-items:center;background:"+IVORY+";border:1px solid "+LINE+";border-radius:4px;padding:22px 24px;margin:0 0 16px}",
      ".pv-rv-big{flex:0 0 auto;text-align:center;min-width:104px;border-right:1px solid "+LINE+";padding-right:22px}",
      ".pv-rv-big .num{font-size:44px;font-weight:800;line-height:1;letter-spacing:-.02em}",
      ".pv-rv-big .st{margin:7px 0 4px}",
      ".pv-rv-big .ct{font-size:12px;color:"+SUB+"}",
      ".pv-rv-bars{flex:1 1 auto;display:flex;flex-direction:column;gap:6px}",
      ".pv-rv-bar{display:flex;align-items:center;gap:9px;font-size:12px;color:"+SUB+"}",
      ".pv-rv-bar .lab{flex:0 0 26px;color:"+INK+";font-weight:600}",
      ".pv-rv-bar .lab b{color:"+GOLD+"}",
      ".pv-rv-bar .track{flex:1 1 auto;height:7px;background:"+TRACK+";border-radius:999px;overflow:hidden}",
      ".pv-rv-bar .fill{display:block;height:100%;background:"+GOLD+";border-radius:999px;min-width:2px}",
      ".pv-rv-bar .cnt{flex:0 0 28px;text-align:right}",
      // 포토 스트립
      ".pv-rv-strip{display:flex;gap:8px;overflow-x:auto;padding:2px 0 16px;-webkit-overflow-scrolling:touch}",
      ".pv-rv-strip::-webkit-scrollbar{height:0}",
      ".pv-rv-strip img{width:72px!important;height:72px!important;max-width:72px!important;object-fit:cover;border-radius:8px;flex:0 0 auto;cursor:pointer;border:1px solid "+LINE+";margin:0!important;padding:0!important;display:block!important}",
      ".pv-rv-strip .more{flex:0 0 auto;width:72px;height:72px;border-radius:8px;border:1px solid "+LINE+";display:flex;align-items:center;justify-content:center;font-size:12px;color:"+SUB+";background:"+IVORY+";cursor:pointer}",
      // 상단 요약 + 그리드 (리뷰에이드 스타일)
      ".pv-rv-top{border-top:1px solid "+INK+";padding:15px 0 6px;margin-top:6px}",
      ".pv-rv-tophead{display:flex;align-items:center;justify-content:space-between;margin:0 0 13px}",
      ".pv-rv-tl{display:flex;align-items:center;gap:7px}",
      ".pv-rv-tl .sc{font-size:21px;font-weight:800;letter-spacing:-.02em}",
      ".pv-rv-tl .ct{font-size:12px;color:"+SUB+";margin-left:3px}",
      ".pv-rv-all{font-size:12px;color:"+SUB+";cursor:pointer;white-space:nowrap;display:flex;align-items:center;gap:2px}",
      ".pv-rv-toptitle{font-size:13.5px;font-weight:600;color:"+INK+";margin:0 0 10px}",
      ".pv-rv-topgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:0 0 8px}",
      ".pv-rv-cell{position:relative;line-height:0}",
      ".pv-rv-topgrid img{width:100%!important;max-width:100%!important;aspect-ratio:1;object-fit:cover;border-radius:8px;cursor:pointer;margin:0!important;display:block!important}",
      ".pv-rv-badge{position:absolute;left:5px;bottom:5px;background:rgba(20,18,15,.62);color:#fff;font-size:10px;font-weight:600;border-radius:4px;padding:1px 6px;letter-spacing:.02em;line-height:1.5}",
      ".pv-rv-badge b{color:"+GOLD+";font-weight:700}",
      // 필터
      ".pv-rv-filter{display:flex;gap:8px;margin:4px 0 2px;padding-bottom:4px}",
      ".pv-rv-filter button{font:inherit;font-size:12px;padding:7px 14px;border:1px solid "+LINE+";background:#fff;border-radius:999px;color:"+SUB+";cursor:pointer;transition:.15s}",
      ".pv-rv-filter button.on{background:"+INK+";color:#fff;border-color:"+INK+"}",
      // 카드
      ".pv-rv-card{padding:20px 0;border-bottom:1px solid "+LINE+"}",
      ".pv-rv-card .meta{display:flex;align-items:center;gap:9px;margin:0 0 9px}",
      ".pv-rv-card .meta .au{font-size:13px;color:"+INK+";font-weight:600}",
      ".pv-rv-card .meta .dt{font-size:12px;color:"+SUB+"}",
      ".pv-rv-card .vb{font-size:10.5px;letter-spacing:.02em;color:"+GOLD+";border:1px solid "+GOLD+";border-radius:999px;padding:1px 7px;font-weight:600}",
      ".pv-rv-card .src{font-size:10.5px;letter-spacing:.02em;color:#fff;background:"+INK+";border-radius:999px;padding:1px 7px;font-weight:600}",
      ".pv-rv-card .body{font-size:14px;line-height:1.75;white-space:pre-line;word-break:break-word;color:#33302b}",
      ".pv-rv-card .rm{display:inline;margin-left:4px;font-size:13px;color:"+SUB+";text-decoration:underline;cursor:pointer}",
      ".pv-rv-card .ph{display:flex;gap:7px;margin:11px 0 0;flex-wrap:wrap}",
      ".pv-rv-card .ph img{width:84px!important;height:84px!important;max-width:84px!important;object-fit:cover;border-radius:8px;cursor:pointer;border:1px solid "+LINE+";margin:0!important;display:block!important}",
      ".pv-rv-more{display:block;width:100%;margin:22px 0 4px;padding:14px;font:inherit;font-size:13px;letter-spacing:.06em;background:#fff;border:1px solid "+INK+";color:"+INK+";border-radius:2px;cursor:pointer}",
      ".pv-rv-empty{padding:30px 0;text-align:center;color:"+SUB+";font-size:13px}",
      ".pv-rv-lb{position:fixed;inset:0;background:rgba(20,18,15,.93);z-index:99999;display:flex;align-items:center;justify-content:center;cursor:zoom-out}",
      ".pv-rv-lb img{max-width:92vw;max-height:88vh;border-radius:6px}",
      "@media(max-width:480px){.pv-rv-sum{gap:16px;padding:18px}.pv-rv-big{min-width:88px;padding-right:16px}.pv-rv-big .num{font-size:38px}}",
      // 모바일 좌우 여백 (양옆 딱붙음 방지) — 위젯 루트(리스트/포토top/스트립) 공통
      "@media(max-width:767px){.pv-rv{padding-left:16px!important;padding-right:16px!important}}"
    ].join("");
    document.head.appendChild(c);
  }

  function lightbox(src){var o=document.createElement("div");o.className="pv-rv-lb";o.innerHTML='<img src="'+esc(src)+'">';o.onclick=function(){o.remove();};document.body.appendChild(o);}
  function bindImgs(root){var ig=root.querySelectorAll("img[data-full]");for(var i=0;i<ig.length;i++){ig[i].addEventListener("click",function(){lightbox(this.getAttribute("data-full"));});}}
  function allPhotos(data){var ph=[];data.reviews.forEach(function(r){r.photos.forEach(function(u){ph.push(u);});});return ph;}

  function renderStrip(el,data){
    var ph=allPhotos(data);if(!ph.length){el.style.display="none";return;}
    el.className="pv-rv pv-rv-strip";
    el.innerHTML=ph.slice(0,20).map(function(u){return '<img src="'+esc(u)+'" data-full="'+esc(u)+'" loading="lazy">';}).join("");
    bindImgs(el);
  }
  function renderTop(el,data){
    var s=data.summary||{};
    var photos=[];data.reviews.forEach(function(r){r.photos.forEach(function(u){photos.push({u:u,rating:r.rating});});});
    if(!photos.length){el.style.display="none";return;}
    el.className="pv-rv pv-rv-top";
    var head='<div class="pv-rv-tophead"><div class="pv-rv-tl"><span class="sc">'+(s.avg||0).toFixed(1)+'</span>'+stars(s.avg,14)+'<span class="ct">'+L.reviews(s.count||0)+(s.photoCount?L.photo+L.photoN(s.photoCount):'')+'</span></div><span class="pv-rv-all" data-gotolist="1">'+L.viewAll+'</span></div>';
    var title='<div class="pv-rv-toptitle">'+L.photoTitle+'</div>';
    var grid='<div class="pv-rv-topgrid">'+photos.slice(0,8).map(function(p){return '<div class="pv-rv-cell"><img src="'+esc(p.u)+'" data-full="'+esc(p.u)+'" loading="lazy"><span class="pv-rv-badge"><b>★</b> '+p.rating+'</span></div>';}).join("")+'</div>';
    el.innerHTML=head+title+grid;
    var go=el.querySelector('[data-gotolist]');if(go)go.addEventListener("click",function(){var t=document.getElementById("pv-review-list");if(t)t.scrollIntoView({behavior:"smooth",block:"start"});});
    bindImgs(el);
  }

  function renderList(el,data){
    el.className="pv-rv";
    var s=data.summary||{}, dist=s.distribution||{}, total=data.reviews.length;
    var state={photoOnly:false,shown:5,expanded:{}};
    var ph=allPhotos(data);

    function summary(){
      var bars="";
      for(var st=5;st>=1;st--){var n=dist[st]||0;var pct=total?Math.round(n/total*100):0;
        bars+='<div class="pv-rv-bar"><span class="lab"><b>★</b>'+st+'</span><span class="track"><span class="fill" style="width:'+pct+'%"></span></span><span class="cnt">'+n+'</span></div>';}
      return '<div class="pv-rv-sum"><div class="pv-rv-big"><div class="num">'+(s.avg||0).toFixed(1)+'</div><div class="st">'+stars(s.avg,15)+'</div><div class="ct">'+L.reviews(s.count||0)+'</div></div><div class="pv-rv-bars">'+bars+'</div></div>';
    }
    function strip(){
      if(!ph.length)return"";
      var imgs=ph.slice(0,12).map(function(u){return '<img src="'+esc(u)+'" data-full="'+esc(u)+'" loading="lazy">';}).join("");
      var more=ph.length>12?'<span class="more" data-photofilter="1">+'+(ph.length-12)+'</span>':"";
      return '<div class="pv-rv-strip">'+imgs+more+'</div>';
    }
    function card(r,idx){
      var long=(r.content||"").length>140, exp=state.expanded[r.id];
      var body=r.content?(long&&!exp?esc(r.content.slice(0,140))+'…<span class="rm" data-exp="'+r.id+'">'+L.more+'</span>':esc(r.content)):"";
      var badge=r.source?'<span class="src">'+esc(r.source)+'</span>':'<span class="vb">'+L.verified+'</span>';
      return '<div class="pv-rv-card"><div class="meta">'+stars(r.rating,13)+'<span class="au">'+esc(r.author)+'</span><span class="dt">'+esc(r.date)+'</span>'+badge+'</div>'+
        (body?'<div class="body">'+body+'</div>':'')+
        (r.photos.length?'<div class="ph">'+r.photos.map(function(u){return '<img src="'+esc(u)+'" data-full="'+esc(u)+'" loading="lazy">';}).join("")+'</div>':'')+
        '</div>';
    }
    function draw(){
      var list=state.photoOnly?data.reviews.filter(function(r){return r.photos.length;}):data.reviews;
      var ai=data.aiSummary;
      var aiBox=(ai&&ai.summary)?'<div class="pv-rv-ai"><div class="h"><span class="aibadge">AI</span> '+L.aiSummary+'</div><div class="tx">'+esc(ai.summary)+'</div>'+((ai.keywords&&ai.keywords.length)?'<div class="kw">'+ai.keywords.map(function(k){return '<span># '+esc(k)+'</span>';}).join("")+'</div>':'')+'</div>':'';
      var html='<div class="pv-rv-ttl">REAL REVIEW</div>'+aiBox+summary()+strip()+
        '<div class="pv-rv-filter"><button data-f="all" class="'+(state.photoOnly?"":"on")+'">'+L.all+total+'</button><button data-f="photo" class="'+(state.photoOnly?"on":"")+'">'+L.photoFilter+(s.photoCount||0)+'</button></div>'+
        (list.length?list.slice(0,state.shown).map(card).join(""):'<div class="pv-rv-empty">'+L.empty+'</div>')+
        (list.length>state.shown?'<button class="pv-rv-more">'+L.moreReviews(list.length-state.shown)+'</button>':"");
      el.innerHTML=html;
      el.querySelectorAll(".pv-rv-filter button").forEach(function(b){b.addEventListener("click",function(){state.photoOnly=this.getAttribute("data-f")==="photo";state.shown=5;draw();});});
      var pf=el.querySelector('[data-photofilter]');if(pf)pf.addEventListener("click",function(){state.photoOnly=true;state.shown=5;draw();});
      var mb=el.querySelector(".pv-rv-more");if(mb)mb.addEventListener("click",function(){state.shown+=10;draw();});
      el.querySelectorAll(".rm[data-exp]").forEach(function(x){x.addEventListener("click",function(){state.expanded[this.getAttribute("data-exp")]=1;draw();});});
      bindImgs(el);
    }
    draw();
  }

  var cache={};
  /* 상세 탭 "상품 리뷰"에 리뷰수 표기 — 해리엇과 동일 UX */
  function updateReviewTab(n){
    if(!n)return;
    var t=document.querySelector('.detail-tab__item[data-link="prd-review"]');
    if(t && !/\(\d/.test(t.textContent)) t.textContent=t.textContent.trim()+" ("+n+")";
    /* 모바일 플로팅 "리뷰 보기" 배지({$review_count}=자사몰만)도 위젯 count로 통일 */
    var f=document.querySelector('.mobile-fix-footer .review-count');
    if(f) f.textContent=String(n);
  }
  function load(pno,cb){
    if(cache[pno]){updateReviewTab(cache[pno].summary&&cache[pno].summary.count);return cb(cache[pno]);}
    fetch(API+"?product_no="+encodeURIComponent(pno)+"&mall="+MALL+"&limit=1000"+(EN?"&lang=en":""),{credentials:"omit"})
      .then(function(r){return r.json();})
      .then(function(j){if(!j||!j.ok)j={ok:false,reviews:[],summary:{count:0}};cache[pno]=j;updateReviewTab(j.summary&&j.summary.count);cb(j);})
      .catch(function(){cb({ok:false,reviews:[],summary:{count:0}});});
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
    injectCss();
    var targets=[["pv-review-photostrip",renderStrip],["pv-review-phototop",renderTop],["pv-review-list",renderList]];
    var els=[],pno=null;
    targets.forEach(function(t){var e=document.getElementById(t[0]);if(e){els.push([e,t[1]]);if(!pno)pno=getProductNo(e);var dm=e.getAttribute("data-mall");if(dm)MALL=dm;var dl=e.getAttribute("data-lang");if(dl){EN=/^en/i.test(dl);L=EN?L_EN:L_KO;}}});
    if(!els.length||!pno||!/^\d+$/.test(pno))return;
    load(pno,function(data){
      els.forEach(function(p){try{p[1](p[0],data);}catch(e){}});
      // 상세 탭의 리뷰 개수 뱃지 채우기(.pv-rv-count) — 그룹 합산 개수
      var cnt=(data&&data.summary&&data.summary.count)||0;
      var badges=document.querySelectorAll(".pv-rv-count");
      for(var i=0;i<badges.length;i++) badges[i].textContent=cnt;
    });
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();
