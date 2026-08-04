/**
 * buildPostOffice 출고행 → 우체국 InsertOrder regData 파라미터 매핑.
 *
 * 출고행 형태(buildPostOffice): { name, mobile, tel, addr, addr1?, addr2?, zip,
 *                                 prod, color, qty, msg, order, seller }
 *
 * 기본값(사용자 확정):
 *   contCd  = 025 (의류/패션잡화 — 시계·주얼리)
 *   payType = 1   (출고/선불) · 반품은 12(후납) — mapReturn() 참고
 *   printYn = N   (biz.epost 운송장출력 메뉴에서 인쇄)
 *   reqType = 1   (일반소포). 반품은 mapReturn() 으로 reqType=2.
 *   testYn  = POSTPARCEL_TEST_YN (기본 'Y' — 실제 채번 전 안전 테스트)
 */
const DEFAULTS = {
  contCd: () => process.env.POSTPARCEL_CONT_CD || "025",
  weight: () => process.env.POSTPARCEL_DEFAULT_WEIGHT || "", // 미입력 시 우체국 default 2
  volume: () => process.env.POSTPARCEL_DEFAULT_VOLUME || "", // 미입력 시 우체국 default 60
  testYn: () => (process.env.POSTPARCEL_TEST_YN ?? "Y").toUpperCase(),
  ordCompNm: (seller) => process.env.POSTPARCEL_ORD_COMP_NM || seller || "주문처",
  // 반품소포 요금납부 = 2(착불). InsertOrder 가 받는 값은 1(선불)/2(착불) 둘뿐 —
  // 계약조회(GetApprNo)의 payTypeCd=12(후납)는 별개 코드표라 넣으면 ERR-223.
  payTypeReturn: () => process.env.POSTPARCEL_PAY_TYPE_RETURN || "2",
};

const digits = (v) => String(v || "").replace(/\D/g, "");
const isMobile = (p) => /^01[016789]/.test(digits(p));

// recAddr1(주소)/recAddr2(상세주소) 분리.
// recAddr2 는 우체국 필수항목 — 공백만이면 ERR-311 거부, 비공백이면 허용.
// addr1/addr2 분리 제공(카페24)이면 그대로, 결합주소면 전체를 addr1 에 두고 상세는 '.' placeholder.
// (배송 주소는 recAddr1 전체로 충분히 처리됨)
function splitAddr(row) {
  const addr1 = String(row.addr1 || row.addr || "").trim();
  const addr2 = String(row.addr2 || "").trim() || ".";
  return { addr1, addr2 };
}

function baseCommon() {
  const custNo = process.env.POSTPARCEL_CUST_NO;
  const apprNo = process.env.POSTPARCEL_APPR_NO;
  const officeSer = process.env.POSTPARCEL_OFFICE_SER;
  if (!custNo) throw new Error("POSTPARCEL_CUST_NO 미설정 (setup 으로 조회 후 .env 기입)");
  if (!apprNo) throw new Error("POSTPARCEL_APPR_NO 미설정 (setup 으로 조회 후 .env 기입)");
  if (!officeSer) throw new Error("POSTPARCEL_OFFICE_SER 미설정 (biz.epost 공급지코드)");
  return { custNo, apprNo, officeSer };
}

/** 일반소포(출고) 1건 → InsertOrder 파라미터 (reqType=1) */
function mapOutbound(row) {
  const { custNo, apprNo, officeSer } = baseCommon();
  const { addr1, addr2 } = splitAddr(row);
  const mob = isMobile(row.mobile) ? digits(row.mobile) : isMobile(row.tel) ? digits(row.tel) : "";
  const tel = !mob ? digits(row.tel || row.mobile) : digits(row.tel);
  return {
    custNo,
    apprNo,
    payType: "1", // 선불
    reqType: "1", // 일반소포
    // 반품(회수) 도착지를 특정 공급지로 보낼 때 order.officeSer 로 오버라이드(예: 수리센터 260722206).
    // 미지정 시 기본 공급지(POSTPARCEL_OFFICE_SER = 서초 260133857).
    officeSer: row.officeSer || officeSer,
    weight: DEFAULTS.weight(),
    volume: DEFAULTS.volume(),
    microYn: "N",
    orderNo: row.order,
    ordCompNm: DEFAULTS.ordCompNm(row.seller),
    recNm: row.name,
    recZip: digits(row.zip),
    recAddr1: addr1,
    recAddr2: addr2,
    recTel: tel || "",
    recMob: mob || "",
    contCd: DEFAULTS.contCd(),
    goodsNm: row.prod,
    goodsColor: row.color || "",
    qty: row.qty || "1",
    delivMsg: row.msg || "",
    printYn: "N", // biz.epost 에서 인쇄
    testYn: DEFAULTS.testYn(),
  };
}

/**
 * 반품소포 1건 → InsertOrder 파라미터 (reqType=2).
 * 반품은 보내는분=수취인(고객), 받는분=공급지(회수도착지). rec* 는 회수할 고객 주소.
 *
 * ⚠️ payType 은 출고값(1=선불)을 그대로 쓰면 안 된다.
 *   출고는 발송인이 우리(계약고객)라 선불로 넣어도 계약으로 정산되지만,
 *   반품은 **발송인이 고객**이라 선불이면 집배원이 방문해서 고객에게 요금을 청구한다.
 *   (2026-07-31 임정애 건 — 이미 AS비를 낸 고객이 집배원에게 이중청구받아 컴플레인)
 *   → 2(착불)로 접수. 반품의 수취인은 우리 공급지(서초)라 요금이 우리 계약에 붙는다.
 *   요금은 선불 1,700 → 착불 2,200 으로 500원 오르지만 고객 청구가 사라진다.
 */
function mapReturn(ret) {
  const base = mapOutbound(ret);
  return {
    ...base,
    payType: DEFAULTS.payTypeReturn(), // 12 후납 — 고객에게 요금 청구되지 않도록
    reqType: "2", // 반품소포
    retReason: ret.retReason || "",
    retVisitYmd: ret.retVisitYmd || "", // 미입력 시 우체국 default = 내일 (YYYYMMDD)
    retOrigRegiNo: digits(ret.retOrigRegiNo) || "", // 원송장(등기) 13자리
    // printYn 은 반품에서 무시됨
  };
}

module.exports = { mapOutbound, mapReturn, splitAddr, digits, isMobile, DEFAULTS };
