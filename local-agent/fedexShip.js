/**
 * FedEx 국제배송 예약 모듈 — 식스샵 글로벌 해외주문 라벨 자동발급.
 *   token()            : OAuth(client_credentials) 토큰 캐시
 *   resolveRecipient() : 식스샵 뭉친 해외주소 → FedEx 구조화(주소검증으로 city/state 보완, street 원본보존)
 *   createShipment()   : 국제 라벨+통관(commodities) 생성 → {trackingNumber, labelPath(.zpl), invoicePath(.pdf), service, cost}
 *   voidShipment()     : 접수 취소(픽업 전, 과금 방지)
 *
 * CLI 테스트:  node fedexShip.js test     ← 독일 샘플 주문으로 라벨 생성 후 즉시 void
 *             node fedexShip.js test --keep ← void 안 함(실제 라벨 유지)
 *
 * ⚠️ 프로덕션 키 — createShipment 호출 시 실제 라벨/운임 발생. 테스트는 void로.
 */
const fs = require("fs"), path = require("path"), os = require("os");
function le(p){try{for(const l of fs.readFileSync(p,"utf8").split("\n")){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);if(!m)continue;let v=m[2].trim().replace(/^["']|["']$/g,"");if(!(m[1] in process.env))process.env[m[1]]=v;}}catch{}}
le(path.join(__dirname, ".env"));

const BASE = "https://apis.fedex.com";
const ACCOUNT = process.env.FEDEX_ACCOUNT;
const { pickBox } = require("./boxSpec");

// ── 발송인(폴바이스/HARRIOT WATCHES 출고지) ──
const SHIPPER = {
  contact: { personName: "SUNGJO HONG", companyName: "HARRIOT WATCHES", phoneNumber: "827045714944" },
  address: { streetLines: ["184, Jungbu-daero, Giheung-gu", "717-2"], city: "Yongin-si", stateOrProvinceCode: "Gyeonggi-do", postalCode: "17095", countryCode: "KR" },
};
// HS 9102.11 = 전자식(쿼츠) 손목시계 중 **바늘 표시만** 있는 것. 우리 시계는 전부 아날로그 쿼츠다.
// 예전 값 910219 는 "전자식·기타"(디지털 겸용 등)라 맞지 않았다(2026-09-18 정정).
const HS_WATCH = "910211";
// 원산지 — 미국 CBP 는 시계(스트랩 제외)의 원산지를 **무브먼트가 조립된 국가**로 본다.
// 한국에서 디자인·조립해도 원산지는 바뀌지 않는다(사장님 방침 2026-09-15, 메모리 origin-claim-policy).
// 설월·기원 = RONDA(스위스). 무브먼트를 모르는 라인은 예전 값(KR)으로 두되 새 라인이 나오면 여기에 추가할 것.
const COO_DEFAULT = "KR";
const COO_BY_MOVEMENT = [
  { re: /설월|seolwol|기원|ki:?won/i, coo: "CH" },   // RONDA 708 / RONDA
];
const cooFor = (prod) => (COO_BY_MOVEMENT.find((x) => x.re.test(String(prod || ""))) || {}).coo || COO_DEFAULT;
// 세관 품목설명은 상품명만으로는 무엇인지 모른다("SEOLWOL") — 품목 종류를 앞에 붙인다.
const describe = (prod) => {
  const p = String(prod || "").trim();
  if (/밴드|스트랩|strap|band/i.test(p) && !/watch|시계|seolwol|설월/i.test(p)) return `Watch strap - ${p}`.slice(0, 50);
  return `Quartz wrist watch - ${p || "watch"}`.slice(0, 50);
};
const DEFAULT_KG = 0.6;             // 시계 1개 기본 중량(박스 포함)
// 서비스: 미국=Priority, 그 외=Connect Plus
// ⚠️ Connect Plus 의 정식 enum 은 FEDEX_ 접두어가 붙는다. 접두어 없이 보내면 400
// REQUESTEDSHIPMENT.SERVICETYPE.NOTSUPPORTED 로 떨어진다(2026-09-13 실측 — 접두어를 붙이니 200·라벨 발급).
// 프로덕션 Rate 응답도 FEDEX_INTERNATIONAL_CONNECT_PLUS 로 온다. INTERNATIONAL_ECONOMY 는 접두어 없는 게 맞다.
const serviceFor = (cc) => (cc === "US" ? "FEDEX_INTERNATIONAL_PRIORITY" : "FEDEX_INTERNATIONAL_CONNECT_PLUS");

const log = (m) => console.log(`[${new Date().toISOString()}] [fedex] ${m}`);

let _tok = { v: "", exp: 0 };
async function token() {
  if (_tok.v && _tok.exp - 60000 > Date.now()) return _tok.v;
  const r = await fetch(BASE + "/oauth/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "client_credentials", client_id: process.env.FEDEX_API_KEY, client_secret: process.env.FEDEX_SECRET }) });
  const j = await r.json(); if (!j.access_token) throw new Error("FedEx OAuth 실패: " + JSON.stringify(j).slice(0, 200));
  _tok = { v: j.access_token, exp: Date.now() + (j.expires_in || 3599) * 1000 };
  return _tok.v;
}
// ⚠️ 메서드는 엔드포인트마다 다르다. 취소(/ship/v1/shipments/cancel)는 PUT 이고,
// POST 로 보내면 200 이 아니라 METHOD.NOT.ALLOWED.ERROR 로 떨어진다 — 그런데 이 실패가
// "라벨은 발급됐는데 취소가 안 된 상태"로 남아 과금 위험이 된다(2026-09-18 실측).
async function api(p, body, tok, method = "POST") {
  const r = await fetch(BASE + p, { method, headers: { Authorization: "Bearer " + (tok || await token()), "Content-Type": "application/json", "X-locale": "en_US" }, body: JSON.stringify(body) });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { raw: t }; }
  return { status: r.status, j };
}

// 식스샵 주소 "street...  city CC" + 우편번호 → FedEx 구조화
async function resolveRecipient(rawAddr, zip) {
  const a = String(rawAddr).trim().replace(/\s+/g, " ");
  const m = a.match(/^(.*)\s+([A-Z]{2})$/);
  const countryCode = m ? m[2] : "";
  const rest = m ? m[1].trim() : a;          // "street... city"
  // FedEx 주소검증으로 city/state/zip 보완
  const { j } = await api("/address/v1/addresses/resolve", { addressesToValidate: [{ address: { streetLines: [rest], postalCode: String(zip).trim(), countryCode } }] });
  const r = j.output && j.output.resolvedAddresses && j.output.resolvedAddresses[0];
  const city = (r && r.city) || "";
  const state = (r && r.stateOrProvinceCode) || "";
  const postalCode = (r && r.postalCode) || String(zip).trim();
  // street = rest 에서 끝의 city 제거(원본 유닛/동호수 보존)
  let street = rest;
  if (city) { const re = new RegExp("\\s*,?\\s*" + city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*$", "i"); street = rest.replace(re, "").trim(); }
  if (!street) street = rest;
  // FedEx streetLines 최대 2줄, 35자 권장 — 길면 분리
  const streetLines = street.length > 35 ? [street.slice(0, 35), street.slice(35, 70)] : [street];
  return { streetLines, city, stateOrProvinceCode: state, postalCode, countryCode, classification: r && r.classification };
}

// order = {name, phone, email, rawAddr, zip, prod, qty, amountUSD, orderNo}
async function createShipment(order, opts = {}) {
  // 주소는 두 갈래다.
  //  ① order.addrParts — 카페24 영문몰처럼 **이미 구조화된** 주소(street/city/zip/countryCode).
  //     주(state)만 페덱스 주소검증으로 2자리 코드를 받는다. 카페24는 "California" 처럼 풀네임을
  //     주는데 페덱스는 "CA" 를 요구하기 때문(2026-09-18 실측: CA·TX·BC 모두 정확히 반환).
  //  ② order.rawAddr — 식스샵처럼 주소가 한 덩어리인 경우. 예전 경로(파싱 + 검증).
  const rec = order.addrParts
    ? await resolveStructured(order.addrParts)
    : await resolveRecipient(order.rawAddr, order.zip);
  if (!rec.countryCode) throw new Error("수취 국가코드 파싱 실패: " + (order.rawAddr || JSON.stringify(order.addrParts)));
  const qty = Math.max(1, Number(order.qty) || 1);
  // 박스 규격: 실중량과 **치수를 함께** 보낸다. 치수를 빼면 페덱스가 직접 재서 차액을 청구한다.
  // order.items(품목 배열)를 주면 그걸로 박스를 고르고, 없으면 상품명·수량으로 추정한다(구 호출부 호환).
  const box = pickBox(order.items || [{ name: order.prod, qty }]);
  const kg = box.weightKg;
  const value = Number(order.amountUSD) || 0;
  const service = opts.service || serviceFor(rec.countryCode);
  const phone = String(order.phone || "").replace(/[^\d+]/g, "") || "0000000000";
  const name = String(order.name || "").replace(/,/g, " ").trim();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());

  const body = {
    labelResponseOptions: "LABEL",
    accountNumber: { value: ACCOUNT },
    requestedShipment: {
      shipper: SHIPPER,
      recipients: [{ contact: { personName: name, phoneNumber: phone }, address: { streetLines: rec.streetLines, city: rec.city, stateOrProvinceCode: rec.stateOrProvinceCode || undefined, postalCode: rec.postalCode, countryCode: rec.countryCode } }],
      shipDatestamp: today,
      serviceType: service,
      packagingType: "YOUR_PACKAGING",
      pickupType: "USE_SCHEDULED_PICKUP",
      blockInsightVisibility: false,
      shippingChargesPayment: { paymentType: "SENDER" },
      // 라벨 인증(2026-09-14 반려 사유): 열전사 프린터(Xprinter XP-D4604B)엔 ZPL 을 그대로 쏴야 한다.
      // PDF 를 열전사에 찍으면 바코드가 흐려져 불합격. ZPL 은 이미지로 변환·가공 금지, raw 출력만.
      // 용지 = 페덱스 열전사 라벨 Part #156148-434 (4x6.75, 상단 doc tab). STOCK_4X6 으로 보내면
      // 본문이 doc tab 위로 올라가 인증 반려된다(2026-09-16 2차 반려 사유). enum 은 소수점 없는 표기.
      labelSpecification: { imageType: "ZPLII", labelStockType: "STOCK_4X675_LEADING_DOC_TAB" },
      // ETD 는 shippingDocumentSpecification 없이 보내면 400 SHIPPING.DOCUMENT.REQUIRED (2026-09-16 샌드박스 실측)
      shippingDocumentSpecification: { shippingDocumentTypes: ["COMMERCIAL_INVOICE"], commercialInvoiceDetail: { documentFormat: { stockType: "PAPER_LETTER", docType: "PDF" } } },
      customsClearanceDetail: {
        dutiesPayment: { paymentType: "RECIPIENT" },
        isDocumentOnly: false,
        commodities: [{
          description: describe(order.prod),
          countryOfManufacture: cooFor(order.prod),
          quantity: qty, quantityUnits: "PCS",
          unitPrice: { amount: qty ? +(value / qty).toFixed(2) : value, currency: "USD" },
          customsValue: { amount: value, currency: "USD" },
          weight: { units: "KG", value: kg },
          harmonizedCode: HS_WATCH,
          numberOfPieces: qty,
        }],
      },
      shipmentSpecialServices: { specialServiceTypes: ["ELECTRONIC_TRADE_DOCUMENTS"], etdDetail: { requestedDocumentTypes: ["COMMERCIAL_INVOICE"] } },
      requestedPackageLineItems: [{
        weight: { units: "KG", value: kg },
        // 부피무게(가로×세로×높이÷5000)가 실중량보다 크면 그쪽으로 청구된다. 우리 박스 3종은
        // 모두 부피무게가 이기므로, 이 치수가 사실상 운임을 결정한다.
        dimensions: { length: box.lengthCm, width: box.widthCm, height: box.heightCm, units: "CM" },
        customerReferences: [{ customerReferenceType: "CUSTOMER_REFERENCE", value: String(order.orderNo || "") }],
      }],
    },
  };
  const { status, j } = await api("/ship/v1/shipments", body);
  if (status !== 200) {
    const errs = (j.errors || []).map((e) => `${e.code}:${e.message}`).join(" | ");
    throw new Error(`Ship 실패(${status}) ${rec.countryCode} ${service}: ${errs || JSON.stringify(j).slice(0, 300)}`);
  }
  const out = j.output.transactionShipments[0];
  const pkg = out.pieceResponses[0];
  const trackingNumber = pkg.trackingNumber || out.masterTrackingNumber;
  const labelB64 = pkg.packageDocuments && pkg.packageDocuments[0] && pkg.packageDocuments[0].encodedLabel;
  let labelPath = "", invoicePath = "";
  const dir = path.join(os.tmpdir(), "fedex-labels"); fs.mkdirSync(dir, { recursive: true });
  if (labelB64) { labelPath = path.join(dir, `${order.orderNo || trackingNumber}.zpl`); fs.writeFileSync(labelPath, Buffer.from(labelB64, "base64")); }
  const inv = (out.shipmentDocuments || []).find((d) => d.contentType === "COMMERCIAL_INVOICE" && d.encodedLabel);
  if (inv) { invoicePath = path.join(dir, `${order.orderNo || trackingNumber}_invoice.pdf`); fs.writeFileSync(invoicePath, Buffer.from(inv.encodedLabel, "base64")); }
  const rated = out.completedShipmentDetail && out.completedShipmentDetail.shipmentRating && out.completedShipmentDetail.shipmentRating.shipmentRateDetails && out.completedShipmentDetail.shipmentRating.shipmentRateDetails[0];
  return { trackingNumber, labelPath, invoicePath, service, recipient: rec, cost: rated ? `${rated.totalNetCharge} ${rated.currency}` : "?" };
}

async function voidShipment(trackingNumber) {
  const { status, j } = await api("/ship/v1/shipments/cancel", { accountNumber: { value: ACCOUNT }, trackingNumber, deletionControl: "DELETE_ALL_PACKAGES" }, null, "PUT");
  return { ok: status === 200 && j.output && j.output.cancelledShipment, status, j };
}

/**
 * 이미 분해된 주소(카페24 영문몰)를 페덱스 구조로. street/city/zip 은 그대로 쓰고
 * **주 코드만** 검증으로 얻는다 — 검증이 실패해도 원본으로 진행한다(주소 자체는 고객이 쓴 값이 맞다).
 * @param {{street:string, city:string, zip:string, countryCode:string}} p
 */
async function resolveStructured(p) {
  const street = String(p.street || "").trim();
  const city = String(p.city || "").trim();
  const zip = String(p.zip || "").trim();
  const countryCode = String(p.countryCode || "").trim().toUpperCase();
  let state = "", outCity = city, outZip = zip;
  try {
    const { j } = await api("/address/v1/addresses/resolve", {
      addressesToValidate: [{ address: { streetLines: [street], city, postalCode: zip, countryCode } }],
    });
    const r = j.output && j.output.resolvedAddresses && j.output.resolvedAddresses[0];
    if (r) {
      state = r.stateOrProvinceCode || "";
      if (r.city) outCity = r.city;
      // 미국은 ZIP+4 로 보정돼 온다 — 그대로 쓰면 배송 정확도가 올라간다.
      if (r.postalCode) outZip = r.postalCode;
    }
  } catch { /* 검증 실패해도 원본으로 진행 */ }
  return { streetLines: [street], city: outCity, stateOrProvinceCode: state, postalCode: outZip, countryCode };
}

module.exports = { cooFor, describe, HS_WATCH, token, resolveRecipient, resolveStructured, createShipment, voidShipment, serviceFor, SHIPPER };

// ── CLI 테스트 ──
if (require.main === module) {
  (async () => {
    const keep = process.argv.includes("--keep");
    const sample = { name: "Sebastian Uhrmann", phone: "01741790129", email: "sebastian.uhrmann91@gmail.com", rawAddr: "Andreas-Sammer-Straße 9  Neuried DE", zip: "82061", prod: "Seohae Sunray watch", qty: 1, amountUSD: 240, orderNo: "TEST-DE-001" };
    log("샘플(독일) 라벨 생성 시도...");
    const r = await createShipment(sample);
    log(`✅ 라벨 발급: tracking=${r.trackingNumber} | ${r.service} | 운임 ${r.cost}`);
    log(`   수취: ${JSON.stringify(r.recipient)}`);
    log(`   라벨: ${r.labelPath}`);
    if (!keep) { const v = await voidShipment(r.trackingNumber); log(`🧹 void: ${v.ok ? "취소완료(과금없음)" : "취소실패 " + JSON.stringify(v.j).slice(0, 200)}`); }
    else log("⚠️ --keep: void 안 함(실제 라벨 유지됨)");
  })().catch((e) => { console.error("[fedex] 오류:", e.message); process.exit(1); });
}
