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

// 팝업 '국내 수령자(글로벌 허브)' 섹션 파싱
function parsePopup(txt) {
  const L = txt.split("\n").map(l=>l.replace(/\t/g," ").trim()).filter(Boolean);
  const start = L.findIndex(l=>/국내\s*수령자|Domestic recipient/i.test(l));
  const end = L.findIndex((l,i)=>i>start && /현지\s*수령자|Local recipient|실수령자/i.test(l));
  const seg = start>=0 ? L.slice(start, end>start?end:start+20) : L;
  const grab = (re) => { const i=seg.findIndex(l=>re.test(l)); if(i<0) return ""; for(let j=i;j<Math.min(i+3,seg.length);j++){ const m=seg[j].split("|"); if(m.length>1 && m[1].trim()) return m[1].trim(); } return (seg[i+1]||"").replace(/^\(.*?\)\s*\|?\s*/,"").trim(); };
  const name = grab(/수령자|Recipient/).replace(/\(\d+\)\s*$/,"").trim();
  const phoneRaw = grab(/휴대전화|Mobile|연락처/);
  const phone = (phoneRaw.match(/0\d{1,2}-?\d{3,4}-?\d{4}/)||[""])[0];
  const zip = (grab(/우편번호|Zip/).match(/\d{5}/)||[""])[0];
  const addr = grab(/주소|Address/).replace(/\(\d{5}\)/,"").trim();
  return { name, phone, zip, addr };
}

async function getMusinsaGlobalRows(_opts, log=console.log) {
  const { page, context } = await getMarketplacePage("musinsa", log);
  // 공지/광고 팝업은 닫되 주문 상세 팝업(biz/global)은 보존
  context.on("page",(p)=>{ if(p===page)return; p.waitForLoadState("domcontentloaded",{timeout:5000}).catch(()=>{}).then(()=>{ if(!/order|delivery|global|popup|detail/i.test(p.url())) p.close().catch(()=>{}); }); });
  if (!(await ensureMusinsa(page, log))) { log("무신사 로그인 실패"); return []; }

  await page.goto(LIST,{waitUntil:"domcontentloaded",timeout:60000}).catch(()=>{});
  await sleep(6000); await page.waitForLoadState("networkidle",{timeout:12000}).catch(()=>{});
  let frame = getFrame(page);
  for(let i=0;i<10 && !frame;i++){ await sleep(1000); frame=getFrame(page); }
  if(!frame){ log("글로벌 iframe 못 찾음"); return []; }

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
    if(popup){ await popup.waitForLoadState("domcontentloaded",{timeout:8000}).catch(()=>{}); await sleep(2500); info=parsePopup(await popup.locator("body").innerText().catch(()=>"")); await popup.close().catch(()=>{}); }
    log(`  글로벌 ${serial}: ${info.name} / ${info.phone} / (${info.zip}) ${info.addr.slice(0,25)}`);
    if(!info.name||!info.addr) { log("  ⚠️ 배송정보 파싱 실패 — 스킵"); continue; }
    out.push({ name:info.name, mobile:isMobile(info.phone)?info.phone:"", tel:isMobile(info.phone)?"":info.phone, addr:info.addr, zip:info.zip, prod, color:"", qty, msg:"", order:orderNo, seller:"무신사" });
  }
  return out;
}

module.exports = { getMusinsaGlobalRows, parsePopup };

if (require.main === module){
  const log=(m)=>console.log(`[${new Date().toISOString()}] ${m}`);
  getMusinsaGlobalRows({}, log).then(rows=>{
    console.log("\n=== 무신사 글로벌 우체국 행 ===");
    rows.forEach(r=>console.log(JSON.stringify([r.name,r.mobile,r.tel,r.addr,r.zip,r.prod,r.qty,r.order,r.seller])));
    const { closeMarketplaceBrowsers } = require("./marketplaceSync");
    return closeMarketplaceBrowsers();
  }).catch(e=>{ console.error("ERR",e.message); process.exit(1); });
}
