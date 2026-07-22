/**
 * 우체국 계약소포 OpenAPI 클라이언트.
 *
 * 모든 암호화 API: GET http://ship.epost.go.kr/{메시지명}?key={인증키}&regData={SEED128 hex}
 *   - regData 평문 = "k=v&k=v..." (UTF-8, 값 raw) → 보안키로 SEED-128(ECB) → 소문자 hex
 *   - 응답 = XML (변수형/리스트형). 오류 시 <error><error_code>ERR-xxx</error_code><message>..</message></error>
 *
 * 자격증명(.env, local-agent):
 *   POSTPARCEL_SHIP_KEY   소포신청 인증키
 *   POSTPARCEL_SEED_KEY   보안키 (SEED seedKey)
 *   POSTPARCEL_CUST_NO    고객번호 (없으면 POSTPARCEL_MEMBER_ID 로 getCustNo 조회)
 *   POSTPARCEL_APPR_NO    계약 승인번호 (없으면 getApprNo 조회)
 *   POSTPARCEL_OFFICE_SER 공급지(발송지/회수도착지) 코드
 *   POSTPARCEL_MEMBER_ID  인터넷우체국 로그인 ID (custNo 조회용)
 *
 * 매뉴얼 근거: cm29-auto-sync 옆 postoffice-api-integration 메모 참조.
 */
const { getEncryptData } = require("./seed128");

const BASE = process.env.POSTPARCEL_BASE_URL || "http://ship.epost.go.kr";
const MSG = {
  getCustNo: "api.GetCustNo.jparcel",
  getApprNo: "api.GetApprNo.jparcel",
  getStoppedZip: "api.GetStoppedZipCd.jparcel",
  insertOffice: "api.InsertOffice.jparcel",
  getOfficeInfo: "api.GetOfficeInfo.jparcel",
  insertOrder: "api.InsertOrder.jparcel",
  getResInfo: "api.GetResInfo.jparcel",
  cancelOrder: "api.GetResCancelCmd.jparcel",
};

class PostParcelError extends Error {
  constructor(code, message, raw) {
    super(`[${code || "ERR"}] ${message || "우체국 API 오류"}`);
    this.name = "PostParcelError";
    this.code = code || null;
    this.raw = raw;
  }
}

// "k=v&k=v" 평문 조립. 값의 '&','=' 는 평문 구분자와 충돌하므로 공백으로 치환(안전).
function buildPlain(params) {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${String(v).replace(/[&=]/g, " ").trim()}`)
    .join("&");
}

function decodeEntities(s) {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

// 단순 플랫 XML → { tag: value | [values] }. leaf 태그만 수집.
// 자식 요소(<tag> 또는 </tag>)를 포함하지 않는 내용만 매칭하므로 컨테이너(<xsync>,<error>)에
// 삼켜지지 않는다. CDATA(<![..]]>) 는 내용으로 허용. 실제 응답 <xsync><error><error_code>
// <![CDATA[ERR-511]]></error_code>... 로 검증.
function parseXml(xml) {
  const fields = {};
  const re = /<([a-zA-Z_][\w.-]*)\s*>((?:(?!<\/?[a-zA-Z])[\s\S])*?)<\/\1>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const tag = m[1];
    const val = decodeEntities(m[2]);
    if (tag in fields) {
      if (!Array.isArray(fields[tag])) fields[tag] = [fields[tag]];
      fields[tag].push(val);
    } else {
      fields[tag] = val;
    }
  }
  return fields;
}

async function callApi(messageName, { key, regData, query }) {
  const qs = new URLSearchParams();
  qs.set("key", key);
  if (regData) qs.set("regData", regData);
  if (query) for (const [k, v] of Object.entries(query)) qs.set(k, String(v));
  const url = `${BASE}/${messageName}?${qs.toString()}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Connection: "keep-alive",
      Host: new URL(BASE).host,
      "User-Agent": "Apache-HttpClient/4.5.1 (Java/1.8.0_91)",
    },
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  const fields = parseXml(text);
  // 오류 판정: error_code 존재 또는 ERR-로 시작하는 코드
  const errCode = fields.error_code || (fields.code && /^ERR/i.test(fields.code) ? fields.code : null);
  if (errCode) {
    throw new PostParcelError(errCode, fields.message || fields.msg, text);
  }
  if (!res.ok) {
    throw new PostParcelError(`HTTP-${res.status}`, text.slice(0, 200), text);
  }
  return { fields, raw: text };
}

function cfg(name, fallback) {
  const v = process.env[name];
  if (v === undefined && fallback === undefined) {
    throw new Error(`환경변수 ${name} 가 필요합니다 (local-agent/.env)`);
  }
  return v ?? fallback;
}

const enc = (plainParams) => getEncryptData(cfg("POSTPARCEL_SEED_KEY"), buildPlain(plainParams));

/** 고객번호 조회: memberID → custNo */
async function getCustNo(memberID = cfg("POSTPARCEL_MEMBER_ID")) {
  const { fields, raw } = await callApi(MSG.getCustNo, {
    key: cfg("POSTPARCEL_SHIP_KEY"),
    regData: enc({ memberID }),
  });
  if (!fields.custNo) throw new PostParcelError("NO-CUSTNO", "custNo 미반환", raw);
  return fields.custNo;
}

/** 계약 승인번호 조회: custNo → { apprNo, payTypeCd, payTypeNm, postNm } */
async function getApprNo(custNo = process.env.POSTPARCEL_CUST_NO) {
  const cust = custNo || (await getCustNo());
  const { fields } = await callApi(MSG.getApprNo, {
    key: cfg("POSTPARCEL_SHIP_KEY"),
    regData: enc({ custNo: cust }),
  });
  return {
    custNo: cust,
    apprNo: Array.isArray(fields.apprNo) ? fields.apprNo[0] : fields.apprNo,
    payTypeCd: fields.payTypeCd,
    payTypeNm: fields.payTypeNm,
    postNm: fields.postNm,
  };
}

/**
 * 소포신청(픽업요청). reqType 1=일반소포(출고), 2=반품소포.
 * @param {object} order 정규화된 주문 (mapOrderToRegData 참고)
 * @returns {object} { reqNo, resNo, regiNo, orderNo, regipoNm, resDate, price, vTelNo, raw, fields }
 */
async function insertOrder(order) {
  const { fields, raw } = await callApi(MSG.insertOrder, {
    key: cfg("POSTPARCEL_SHIP_KEY"),
    regData: enc(order),
  });
  return {
    reqNo: fields.reqNo,
    resNo: fields.resNo,
    regiNo: fields.regiNo, // 운송장(등기)번호 13자리. testYn=Y 면 'TESTREGINOAPI'
    orderNo: fields.orderNo,
    regipoNm: fields.regiPoNm || fields.regipoNm, // 실제응답은 대문자 P (매뉴얼은 소문자)
    resDate: fields.resDate,
    price: fields.price,
    vTelNo: fields.vTelNo,
    notifyMsg: fields.notifyMsg,
    fields,
    raw,
  };
}

/** 소포신청 확인 */
async function getResInfo({ custNo, reqType, orderNo, reqYmd }) {
  const { fields } = await callApi(MSG.getResInfo, {
    key: cfg("POSTPARCEL_SHIP_KEY"),
    regData: enc({ custNo, reqType, orderNo, reqYmd }),
  });
  return fields;
}

/** 소포신청 취소 (delYn: 'N' 취소만 / 'Y' 취소+삭제) */
async function cancelOrder({ custNo, apprNo, reqType, reqNo, resNo, regiNo, reqYmd, delYn = "N" }) {
  const { fields } = await callApi(MSG.cancelOrder, {
    key: cfg("POSTPARCEL_SHIP_KEY"),
    regData: enc({ custNo, apprNo, reqType, reqNo, resNo, regiNo, reqYmd, delYn }),
  });
  return fields; // canceledYn, cancelRegiNo, regiNo(변경된 등기), notCancelReason ...
}

/** 접수중지 지역 우편번호 조회 (암호화 없음) */
async function getStoppedZip(zipCd) {
  const { fields } = await callApi(MSG.getStoppedZip, {
    key: cfg("POSTPARCEL_SHIP_KEY"),
    query: zipCd ? { zipCd } : undefined,
  });
  return fields;
}

/**
 * 공급지 정보 등록 (발송지/회수도착지). 반품(reqType=2) 도착지를 서초 기본공급지가 아닌
 * 특정 주소(예: 수리센터)로 보내려면, 그 주소를 officeDivCd=4(회수도착지)로 등록해 officeSer 확보 →
 * 회수 접수 시 그 officeSer 사용. officeSer 는 우리가 부여하는 코드(중복 시 ERR-226).
 * @param {object} office { custNo, officeSer, officeNm, officeZip, officeAddr1, officeAddr2,
 *                          officeTelno, contactNm, chrgPrsnMob?, officeDivCd? (1동일/2발송지/4회수도착지) }
 */
async function insertOffice(office) {
  const { fields, raw } = await callApi(MSG.insertOffice, {
    key: cfg("POSTPARCEL_SHIP_KEY"),
    regData: enc(office),
  });
  return {
    chkResult: fields.chkResult,
    officeSer: fields.officeSer,
    officeNm: fields.officeNm,
    regiPoNm: fields.regiPoNm || fields.regipoNm,
    officeDivCd: fields.officeDivCd,
    fields,
    raw,
  };
}

/** 공급지 정보 조회. officeDivReqCd: 1동일/2발송지/4회수도착지/7전체(선택) */
async function getOfficeInfo(custNo = process.env.POSTPARCEL_CUST_NO, officeDivReqCd) {
  const reg = { custNo };
  if (officeDivReqCd) reg.officeDivReqCd = officeDivReqCd;
  const { fields, raw } = await callApi(MSG.getOfficeInfo, {
    key: cfg("POSTPARCEL_SHIP_KEY"),
    regData: enc(reg),
  });
  return { fields, raw };
}

module.exports = {
  PostParcelError,
  buildPlain,
  parseXml,
  callApi,
  getCustNo,
  getApprNo,
  insertOrder,
  getResInfo,
  cancelOrder,
  getStoppedZip,
  insertOffice,
  getOfficeInfo,
  MSG,
};
