/**
 * 식스샵 글로벌 해외 미발송 주문 → FedEx Ship Manager 가져오기용 엑셀 생성 → 텔레그램 전송.
 *
 * FedEx Ship API(라벨발급)는 Shipper 인증 대기로 막혀 있어(=Path A), 그 대안(Path B):
 * 미발송 글로벌 주문을 모아 한 행=한 배송 엑셀로 만들어 사장님이 Ship Manager에 일괄 가져오기/수기입력 →
 * 예약 후 송장 역입력. 주소는 FedEx 주소검증(resolveRecipient)으로 도시/주를 구조화한다.
 *
 * 실행:
 *   node fedexExcel.js              라이브 수집(식스샵 로그인→글로벌 export)→엑셀→텔레그램
 *   node fedexExcel.js --dry        전송 안 함(요약만 출력)
 *   node fedexExcel.js --file <xlsx>  기존 글로벌 export 파일 사용(로그인 생략)
 *   node fedexExcel.js --file <xlsx> --all  미발송 필터 없이 전체 행(빌더 검증용)
 */
const fs = require("fs"), path = require("path"), os = require("os");
const DASH = "/Users/mac/sungjo_ai/paulwise-dashboard";
function le(p){try{for(const l of fs.readFileSync(p,"utf8").split("\n")){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);if(!m)continue;let v=m[2].trim().replace(/^["']|["']$/g,"");if(!(m[1] in process.env))process.env[m[1]]=v;}}catch{}}
le(path.join(__dirname, ".env")); le(DASH + "/.env.local"); le(DASH + "/.env.supabase");
const XLSX = require("xlsx");
const { resolveRecipient } = require("./fedexShip");
const { relayDocument, relayText } = require("./telegramRelay");
const log = (m) => console.log(`[${new Date().toISOString()}] [fedex-xlsx] ${m}`);

const HS_WATCH = "910219";     // 손목시계(기타)
const COO = "KR";              // 원산지
const KG_PER_UNIT = 0.6;       // 시계 1개 기본 중량(박스 포함)
const serviceLabel = (cc) => (cc === "US" ? "FedEx International Priority" : "FedEx International Connect Plus");

// 식스샵 글로벌 export 컬럼 → 표준 키
function get(r, k){ return String(r[k] ?? "").trim(); }
function cleanName(s){ return s.replace(/,/g, " ").replace(/\s+/g, " ").trim(); }
function validPhone(s){ const v = (s || "").replace(/[^\d+]/g, ""); return v && v !== "-" ? v : ""; }

// 미발송 = 송장번호 없음 + 상태가 종료/발송됨이 아님
function isUnshipped(r){
  if (get(r, "송장번호")) return false;
  const st = get(r, "주문 상태");
  if (/취소|반품|환불|배송\s*완료|거래\s*완료|구매\s*확정|배송\s*중/.test(st)) return false;
  return true;
}

/** export 파일 파싱 → 주문번호 단위로 그룹핑(상품 여러 줄 = 커머디티 여러 개). */
function parseOrders(filePath, includeAll){
  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  const byOrder = new Map();
  for (const r of rows){
    if (!includeAll && !isUnshipped(r)) continue;
    const ord = get(r, "주문번호") || get(r, "상품 주문번호 (네이버페이 주문형)");
    if (!ord) continue;
    if (!byOrder.has(ord)){
      byOrder.set(ord, {
        order: ord,
        date: get(r, "주문 일자"),
        name: cleanName(get(r, "배송지 이름")),
        phone: validPhone(get(r, "배송지 휴대폰 번호")) || validPhone(get(r, "주문자 휴대폰 번호")),
        email: get(r, "주문자 이메일"),
        rawAddr: get(r, "배송지 주소"),
        zip: get(r, "우편번호"),
        status: get(r, "주문 상태"),
        items: [], qty: 0, valueUSD: 0,
      });
    }
    const o = byOrder.get(ord);
    const nm = get(r, "상품 이름");
    const opt = get(r, "상품 옵션 정보");
    const eng = get(r, "작성형 옵션 정보").replace(/^Engraving:\s*/i, "").trim();
    const qty = Number(get(r, "수량")) || 1;
    const amt = Number(get(r, "상품별 결제 금액").replace(/[^\d.]/g, "")) || 0;
    let desc = nm; if (opt) desc += ` (${opt})`; if (eng) desc += ` [Engraving: ${eng}]`;
    o.items.push(`${desc} x${qty}`);
    o.qty += qty; o.valueUSD += amt;
  }
  return [...byOrder.values()];
}

const FEDEX_COLS = [
  "주문번호", "주문일자", "받는분(Recipient)", "전화(Phone)", "이메일(Email)",
  "주소1(Address Line 1)", "주소2(Address Line 2)", "도시(City)", "주/도(State)",
  "우편번호(Postal)", "국가(Country Code)", "품목설명(Commodity)", "HS코드", "원산지(COO)",
  "총수량(Qty)", "신고금액(Customs Value)", "통화", "중량kg(Weight)", "서비스(Service)",
  "관세/세금 부담", "원본주소(참고)",
];

async function buildRow(o){
  // FedEx 주소검증으로 도시/주/국가 구조화 (실패 시 원본 폴백)
  let rec;
  try { rec = await resolveRecipient(o.rawAddr, o.zip); }
  catch (e){ log(`  주소검증 실패(${o.order}) — 원본 사용: ${e.message}`); }
  const cc = (rec && rec.countryCode) || ((o.rawAddr.match(/\b([A-Z]{2})\s*$/) || [])[1]) || "";
  const validated = rec && rec.city; // 도시가 채워졌을 때만 분할 신뢰(아니면 원본 보존)
  let line1, line2, city, state, postal;
  if (validated){
    line1 = rec.streetLines[0]; line2 = rec.streetLines[1] || "";
    city = rec.city; state = rec.stateOrProvinceCode || ""; postal = rec.postalCode || o.zip;
  } else {
    // 검증 미흡 — 잘림 방지 위해 원본주소(국가코드 끝 제거)를 통째로 주소1에, 도시/주는 수기보완
    line1 = o.rawAddr.replace(/\s*\b[A-Z]{2}\s*$/, "").trim() || o.rawAddr;
    line2 = ""; city = ""; state = ""; postal = o.zip;
  }
  return [
    o.order, o.date, o.name, o.phone, o.email,
    line1, line2, city, state, postal, cc,
    o.items.join(" / "), HS_WATCH, COO,
    o.qty, o.valueUSD.toFixed(2), "USD", (KG_PER_UNIT * o.qty).toFixed(1), serviceLabel(cc),
    "받는분(RECIPIENT)", o.rawAddr,
  ];
}

async function collectGlobalFile(){
  const { chromium } = require("playwright");
  const { loginSixshop, ensureStore, exportOrders } = require("./sixshopSync");
  const profileDir = path.join(os.homedir(), ".paulvice-marketplace-agent", "sixshop");
  fs.mkdirSync(profileDir, { recursive: true });
  const ctx = await chromium.launchPersistentContext(profileDir, {
    headless: false, channel: "chrome", acceptDownloads: true, locale: "ko-KR", viewport: null,
    args: ["--disable-blink-features=AutomationControlled", "--start-maximized", "--lang=ko-KR"],
    ignoreDefaultArgs: ["--enable-automation"],
  });
  ctx.on("page", (p) => p.on("dialog", (d) => d.accept().catch(() => {})));
  try {
    const page = ctx.pages()[0] || (await ctx.newPage());
    page.on("dialog", (d) => d.accept().catch(() => {}));
    if (!(await loginSixshop(page, log))) throw new Error("식스샵 로그인 실패");
    await ensureStore(page, process.env.SIXSHOP_GLOBAL_STORE || "harriot_global", log);
    return await exportOrders(page, "글로벌", log);
  } finally { await ctx.close().catch(() => {}); }
}

/**
 * 글로벌 export → FedEx 엑셀 생성·전송. 핵심 진입점.
 * @param {object} opt
 *   filePath    기존 글로벌 export 경로(없으면 라이브 수집 — 로그인)
 *   dry         true면 엑셀만 만들고 전송 안 함
 *   includeAll  미발송 필터 끄고 전체(빌더 검증용)
 *   notifyEmpty 미발송 0건일 때 "0건" 텔레그램 알림 여부(수동호출=true, 자동=false 권장)
 * @returns {Promise<{count:number, out:string|null}>}
 */
async function generateFedexExcel(opt = {}){
  const { filePath: fp, dry = false, includeAll = false, notifyEmpty = false } = opt;
  const filePath = fp || (await collectGlobalFile());
  log(`글로벌 export: ${filePath}`);
  const orders = parseOrders(filePath, includeAll);
  log(`${includeAll ? "전체" : "미발송"} 주문 ${orders.length}건`);

  if (!orders.length){
    log("미발송 글로벌 주문 없음 — 엑셀 생략");
    if (!dry && notifyEmpty) await relayText(`📦 FedEx 글로벌 발송 대기\n미발송 해외주문 0건.`);
    return { count: 0, out: null };
  }

  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const aoa = [FEDEX_COLS];
  for (const o of orders){ aoa.push(await buildRow(o)); log(`  ${o.order} ${o.name} → 행 생성`); }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "FedEx");
  const out = `/tmp/FedEx_식스샵글로벌_${date}.xlsx`;
  XLSX.writeFile(wb, out);
  log(`엑셀 생성: ${out} (${orders.length}건)`);

  if (dry){ log("--dry: 전송 생략"); return { count: orders.length, out }; }
  const names = orders.map((o) => o.name).slice(0, 8).join(", ");
  const caption = `📦 FedEx 글로벌 발송 대기 ${orders.length}건\n${names}${orders.length > 8 ? " 외" : ""}\nShip Manager에 가져오기 후 예약하세요.`;
  const ok = await relayDocument(out, caption, path.basename(out));
  log(ok ? "텔레그램 전송 완료" : "텔레그램 전송 실패");
  return { count: orders.length, out };
}

module.exports = { generateFedexExcel };

if (require.main === module){
  const args = process.argv.slice(2);
  const i = args.indexOf("--file");
  generateFedexExcel({
    filePath: i >= 0 ? args[i + 1] : "",
    dry: args.includes("--dry"),
    includeAll: args.includes("--all"),
    notifyEmpty: true, // 수동 실행은 0건도 알려줌
  }).catch((e) => { console.error("ERR", e); process.exit(1); });
}
