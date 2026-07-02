/**
 * FedEx 국제배송 예약 모듈 — 식스샵 글로벌 해외주문 라벨 자동발급.
 *   token()            : OAuth(client_credentials) 토큰 캐시
 *   resolveRecipient() : 식스샵 뭉친 해외주소 → FedEx 구조화(주소검증으로 city/state 보완, street 원본보존)
 *   createShipment()   : 국제 라벨+통관(commodities) 생성 → {trackingNumber, labelPath, service, cost}
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

// ── 발송인(폴바이스/HARRIOT WATCHES 출고지) ──
const SHIPPER = {
  contact: { personName: "SUNGJO HONG", companyName: "HARRIOT WATCHES", phoneNumber: "827045714944" },
  address: { streetLines: ["184, Jungbu-daero, Giheung-gu", "717-2"], city: "Yongin-si", stateOrProvinceCode: "Gyeonggi-do", postalCode: "17095", countryCode: "KR" },
};
const HS_WATCH = "910219";          // 손목시계(기타) HS
const COO = "KR";                   // 원산지
const DEFAULT_KG = 0.6;             // 시계 1개 기본 중량(박스 포함)
// 서비스: 미국=Priority, 그 외=Connect Plus
const serviceFor = (cc) => (cc === "US" ? "FEDEX_INTERNATIONAL_PRIORITY" : "INTERNATIONAL_CONNECT_PLUS");

const log = (m) => console.log(`[${new Date().toISOString()}] [fedex] ${m}`);

let _tok = { v: "", exp: 0 };
async function token() {
  if (_tok.v && _tok.exp - 60000 > Date.now()) return _tok.v;
  const r = await fetch(BASE + "/oauth/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "client_credentials", client_id: process.env.FEDEX_API_KEY, client_secret: process.env.FEDEX_SECRET }) });
  const j = await r.json(); if (!j.access_token) throw new Error("FedEx OAuth 실패: " + JSON.stringify(j).slice(0, 200));
  _tok = { v: j.access_token, exp: Date.now() + (j.expires_in || 3599) * 1000 };
  return _tok.v;
}
async function api(p, body, tok) {
  const r = await fetch(BASE + p, { method: "POST", headers: { Authorization: "Bearer " + (tok || await token()), "Content-Type": "application/json", "X-locale": "en_US" }, body: JSON.stringify(body) });
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
  const rec = await resolveRecipient(order.rawAddr, order.zip);
  if (!rec.countryCode) throw new Error("수취 국가코드 파싱 실패: " + order.rawAddr);
  const qty = Math.max(1, Number(order.qty) || 1);
  const kg = +(DEFAULT_KG * qty).toFixed(2);
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
      labelSpecification: { imageType: "PDF", labelStockType: "PAPER_4X6" },
      customsClearanceDetail: {
        dutiesPayment: { paymentType: "RECIPIENT" },
        isDocumentOnly: false,
        commodities: [{
          description: String(order.prod || "Wrist watch").slice(0, 50),
          countryOfManufacture: COO,
          quantity: qty, quantityUnits: "PCS",
          unitPrice: { amount: qty ? +(value / qty).toFixed(2) : value, currency: "USD" },
          customsValue: { amount: value, currency: "USD" },
          weight: { units: "KG", value: kg },
          harmonizedCode: HS_WATCH,
          numberOfPieces: qty,
        }],
      },
      shipmentSpecialServices: { specialServiceTypes: ["ELECTRONIC_TRADE_DOCUMENTS"], etdDetail: { requestedDocumentTypes: ["COMMERCIAL_INVOICE"] } },
      requestedPackageLineItems: [{ weight: { units: "KG", value: kg }, customerReferences: [{ customerReferenceType: "CUSTOMER_REFERENCE", value: String(order.orderNo || "") }] }],
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
  let labelPath = "";
  if (labelB64) { const dir = path.join(os.tmpdir(), "fedex-labels"); fs.mkdirSync(dir, { recursive: true }); labelPath = path.join(dir, `${order.orderNo || trackingNumber}.pdf`); fs.writeFileSync(labelPath, Buffer.from(labelB64, "base64")); }
  const rated = out.completedShipmentDetail && out.completedShipmentDetail.shipmentRating && out.completedShipmentDetail.shipmentRating.shipmentRateDetails && out.completedShipmentDetail.shipmentRating.shipmentRateDetails[0];
  return { trackingNumber, labelPath, service, recipient: rec, cost: rated ? `${rated.totalNetCharge} ${rated.currency}` : "?" };
}

async function voidShipment(trackingNumber) {
  const { status, j } = await api("/ship/v1/shipments/cancel", { accountNumber: { value: ACCOUNT }, trackingNumber, deletionControl: "DELETE_ALL_PACKAGES" });
  return { ok: status === 200 && j.output && j.output.cancelledShipment, status, j };
}

module.exports = { token, resolveRecipient, createShipment, voidShipment, serviceFor, SHIPPER };

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
