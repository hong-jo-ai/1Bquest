/**
 * 무신사 글로벌 배송 출고 요청 → 우체국 행.
 * 경로: 로그인(/order/history 경유) → partner.musinsa.com/order/global-delivery-request
 *   → iframe(bizest.musinsa.com/po/order-group-admin/delivery/dlv11) 안에서 '검색' 클릭
 *   → AG-Grid 데이터행에서 주문번호/상품명/수량/주문일련번호 추출
 *   → 주문일련번호 셀(AG-cell, a 아님) 클릭 → 팝업(주문 상세)에서 '국내 수령자(글로벌 허브)' 파싱
 *      (수령자=무신사로지스틱스 / 휴대전화(070=전화칸) / 우편번호 / 주소=국내센터)  ← 우체국 발송지
 * 글로벌 주문도 국내 무신사 창고로 발송 → 우체국 국내택배. seller="무신사".
 * ⚠️ AG-Grid/iframe 구조라 셀렉터 민감 — 라이브 검증 필요. 2026-06-08 1건(송장 6890143794154) 수동검증 완료.
 */
require("dotenv").config({ override: true });
const { getMarketplacePage, ensureLoggedIn } = require("./marketplaceSync");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LIST = "https://partner.musinsa.com/order/global-delivery-request";
const clean = (v) => { const s = String(v??"").trim(); return s==="-"?"":s; };
const isMobile = (p) => /^01[016789]/.test(String(p||"").replace(/\D/g,""));
const getFrame = (page) => page.frames().find(f=>/bizest\.musinsa\.com\/po\/order-group-admin\/delivery/.test(f.url()));

async function ensureMusinsa(page, log) {
  await ensureLoggedIn("musinsa", page, log);
  await page.goto("https://partner.musinsa.com/order/history",{waitUntil:"domcontentloaded",timeout:60000}).catch(()=>{});
  await sleep(4000);
  if (/sso|oauth\/login/i.test(page.url())) { log("무신사 재로그인"); await ensureLoggedIn("musinsa", page, log); await sleep(4000); }
  return !/sso|oauth\/login/i.test(page.url());
}

// 팝업 '국내 수령자(글로벌 허브)' 섹션 파싱.
// 실제 DOM 은 라벨 2줄("수령자" / "(Recipient)") + 값이 **TAB 뒤**에 붙는 구조다.
//   수령자\n(Recipient)\t무신사로지스틱스(2247204)
// 예전 파서는 "|" 로 쪼개고 라벨줄 다음 줄을 값으로 봐서 name 에 "Domestic recipient(Global Hub)"
// 같은 라벨 텍스트가 그대로 들어갔다(2026-08-27 실측). TAB 기준으로 다시 잡는다.
function parsePopup(txt) {
  const L = String(txt||"").split("\n").map(l=>l.replace(/\u00a0/g," ").replace(/\s+$/,""));
  const start = L.findIndex(l=>/국내\s*수령자|Domestic\s*recipient/i.test(l));
  const end = L.findIndex((l,i)=>i>start && /현지\s*수령자|실수령자|Local\s*recipient/i.test(l));
  const seg = start>=0 ? L.slice(start, end>start?end:start+40) : L;
  // 라벨줄부터 최대 3줄 안에서 TAB 뒤 첫 비어있지 않은 값
  const grab = (re) => {
    for (let i=0;i<seg.length;i++){
      if(!re.test(seg[i])) continue;
      for (let j=i;j<Math.min(i+3,seg.length);j++){
        const parts = seg[j].split("\t");
        if (parts.length>1){ const v = parts.slice(1).join(" ").trim(); if(v) return v; }
      }
    }
    return "";
  };
  const name = grab(/^\s*(수령자|\(Recipient\))/i).replace(/\(\d+\)\s*$/,"").trim();
  const phoneRaw = grab(/^\s*(휴대전화|연락처|\(Mobile\))/i);
  const phone = (phoneRaw.match(/0\d{1,2}-?\d{3,4}-?\d{4}/)||[""])[0];
  const zip = (grab(/^\s*(우편번호|\(Zip\s*code\))/i).match(/\d{5}/)||[""])[0];
  const addr = grab(/^\s*(주소|\(Address\))/i).replace(/\(\d{5}\)/,"").trim();
  return { name, phone, zip, addr };
}

/** 팝업 본문이 '국내 수령자' 섹션까지 렌더될 때까지 대기 후 텍스트 반환 (최대 waitMs). */
async function readPopupText(popup, waitMs=20000) {
  const t0 = Date.now();
  let txt = "";
  while (Date.now() - t0 < waitMs) {
    txt = await popup.locator("body").innerText().catch(()=>"");
    if (/국내\s*수령자|Domestic\s*recipient/i.test(txt)) return txt;
    await sleep(1000);
  }
  return txt;
}

async function getMusinsaGlobalRows(_opts, log=console.log) {
  const { page, context } = await getMarketplacePage("musinsa", log);
  // 공지/광고 팝업은 닫되 주문 상세 팝업(biz/global)은 보존
  // ⚠️ 주문 상세 팝업은 about:blank 로 먼저 열린 뒤 JS 로 bizest 로 이동한다.
  // 예전 가드는 domcontentloaded 직후 url 이 about:blank 인 사이에 상세 팝업까지 닫아버려서
  // 본문이 통째로 빈 값이 됐다(2026-08-27 448984873 누락 원인 — 레이스라 어쩌다 성공했다).
  // → url 이 빈 값('')/about:blank 인 동안은 기다리고, 확정된 url 만 보고 닫는다.
  //   (실측 2026-08-27: 이 팝업은 about:blank 도 아닌 **빈 문자열**로 열린다)
  const popupGuard = (p)=>{
    if(p===page) return;
    (async()=>{
      await p.waitForLoadState("domcontentloaded",{timeout:8000}).catch(()=>{});
      for(let i=0;i<20 && !p.isClosed() && (!p.url() || /^about:blank$/i.test(p.url()));i++) await sleep(500);
      if(p.isClosed()) return;
      if(!/order|delivery|global|popup|detail|bizest/i.test(p.url())) p.close().catch(()=>{});
    })();
  };
  context.on("page", popupGuard);
  // 상시 창(keep-alive)에서는 이 프로세스가 끝나도 브라우저가 살아 있다.
  // 리스너를 남기면 다음 실행(무신사 일반 자식 프로세스)이 여는 팝업까지 이 핸들러가 건드린다
  // — 2026-08-24 "Target page has been closed" 연속 실패와 같은 부류의 사고. 반드시 해제한다.
  const releaseGuard = () => { try { context.off("page", popupGuard); } catch(_) {} };
  if (!(await ensureMusinsa(page, log))) { log("무신사 로그인 실패 — 창을 닫지 않고 중단합니다"); releaseGuard(); try { await require("./notifyFail").notifyFail("무신사 글로벌 출고 수집", "무신사 로그인 실패로 중단. Chrome 창은 열어뒀으니 직접 로그인해주시면 다음 실행부터 그 세션을 씁니다."); } catch(_) {} return []; }

  // iframe 로딩이 들쭉날쭉해 한 번 실패로 0행 처리되는 일이 잦았다(2026-08-27 12:30 크론 누락).
  // → 대기 시간을 늘리고, 그래도 없으면 페이지를 한 번 새로고침해 재시도한다.
  let frame = null;
  for (let attempt = 1; attempt <= 2 && !frame; attempt++) {
    await page.goto(LIST,{waitUntil:"domcontentloaded",timeout:60000}).catch(()=>{});
    await sleep(6000); await page.waitForLoadState("networkidle",{timeout:12000}).catch(()=>{});
    for(let i=0;i<25 && !frame;i++){ await sleep(1000); frame=getFrame(page); }
    if(!frame) log(`글로벌 iframe 못 찾음 (시도 ${attempt}/2)`);
  }
  if(!frame){ log("글로벌 iframe 못 찾음 — 수집 중단"); releaseGuard(); try { await require("./notifyFail").notifyFail("무신사 글로벌 출고 수집", "주문 그리드 iframe 로딩 실패로 수집 중단. 창은 열어뒀으니 파트너센터에서 직접 확인해주세요."); } catch(_) {} return []; }

  await frame.locator('button:has-text("검색")').filter({hasNotText:"초기화"}).first().click({timeout:6000}).catch(()=>{});
  await sleep(6000);

  // AG-Grid 데이터행들: col 텍스트 배열
  const rowsData = await frame.evaluate(()=>{
    const rows=[...document.querySelectorAll(".ag-center-cols-container .ag-row, .ag-body .ag-row, .ag-row")].filter(r=>r.querySelectorAll(".ag-cell").length>3);
    return rows.map(r=>({ id:r.getAttribute("row-id"), cells:[...r.querySelectorAll(".ag-cell")].map(c=>c.innerText.replace(/\s+/g," ").trim()) }));
  }).catch(()=>[]);
  log(`글로벌 주문 ${rowsData.length}행`);

  const out=[];
  for(const rd of rowsData){
    const cells=rd.cells;
    const serial=(cells.find(c=>/^\d{8,12}$/.test(c))||"");
    const orderNo=(cells.find(c=>/^\d{15,18}$/.test(c))||serial);
    const prod=cells.filter(c=>/[가-힣]/.test(c)&&c.length>5&&!/센터|무신사|배송|출고|위탁|파트너|미국/.test(c)).sort((a,b)=>b.length-a.length)[0]||"";
    const qty=(cells.find((c,i)=>/^\d{1,3}$/.test(c))||"1");
    if(!serial) continue;
    // 주문일련번호 셀 클릭 → 팝업
    let popup=null; const onPop=(p)=>{ if(p!==page) popup=p; };
    context.on("page",onPop);
    await frame.locator('.ag-cell').filter({hasText:new RegExp("^"+serial+"$")}).first().click({timeout:6000}).catch(()=>{});
    await sleep(4500); context.off("page",onPop);
    if(!popup) popup=context.pages().find(p=>p!==page&&/order|delivery|global|popup/i.test(p.url()))||null;
    let info={name:"",phone:"",zip:"",addr:""};
    if(popup){
      await popup.waitForLoadState("domcontentloaded",{timeout:8000}).catch(()=>{});
      // 고정 sleep 으로는 렌더 전에 읽어 전 필드가 빈 값으로 나온다(2026-08-27 448984873 누락 원인).
      const txt = await readPopupText(popup);
      info = parsePopup(txt);
      await popup.close().catch(()=>{});
    }
    log(`  글로벌 ${serial}: ${info.name} / ${info.phone} / (${info.zip}) ${info.addr.slice(0,25)}`);
    if(!info.name||!info.addr) {
      // ⚠️ 조용히 스킵하면 출고 누락이 그대로 묻힌다 — 그리드에 주문이 잡혔는데 못 만들면 반드시 알린다.
      log(`  ⚠️ 배송정보 파싱 실패 — 스킵 (주문 ${orderNo}/${serial})`);
      try { await require("./notifyFail").notifyFail("무신사 글로벌 출고 수집", `주문 ${orderNo}(일련 ${serial}) 배송정보 파싱 실패로 접수 누락. 파트너센터에서 수동 확인 필요.`); } catch(_) {}
      continue;
    }
    out.push({ name:info.name, mobile:isMobile(info.phone)?info.phone:"", tel:isMobile(info.phone)?"":info.phone, addr:info.addr, zip:info.zip, prod, color:"", qty, msg:"", order:orderNo, seller:"무신사" });
  }
  releaseGuard();
  return out;
}

module.exports = { getMusinsaGlobalRows, parsePopup, readPopupText };

if (require.main === module){
  const log=(m)=>console.log(`[${new Date().toISOString()}] ${m}`);
  getMusinsaGlobalRows({}, log).then(rows=>{
    console.log("\n=== 무신사 글로벌 우체국 행 ===");
    rows.forEach(r=>console.log(JSON.stringify([r.name,r.mobile,r.tel,r.addr,r.zip,r.prod,r.qty,r.order,r.seller])));
    const { closeMarketplaceBrowsers } = require("./marketplaceSync");
    return closeMarketplaceBrowsers();
  }).catch(e=>{ console.error("ERR",e.message); process.exit(1); });
}
