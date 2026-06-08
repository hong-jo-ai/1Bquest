/**
 * 우체국 계약소포 1회 셋업 — 고객번호·승인번호 조회.
 * 실행: node local-agent/postParcel/setup.js
 *
 * 사전조건(.env, local-agent): POSTPARCEL_SHIP_KEY, POSTPARCEL_SEED_KEY, POSTPARCEL_MEMBER_ID
 * 출력된 custNo·apprNo 를 .env 의 POSTPARCEL_CUST_NO / POSTPARCEL_APPR_NO 에 기입.
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), override: true });

const { getCustNo, getApprNo, getStoppedZip, PostParcelError } = require("./client");

(async () => {
  try {
    console.log("── 우체국 계약소포 셋업 ──");
    const custNo = process.env.POSTPARCEL_CUST_NO || (await getCustNo());
    console.log("고객번호(custNo):", custNo);

    const appr = await getApprNo(custNo);
    console.log("승인번호(apprNo):", appr.apprNo);
    console.log("요금납부(payType):", appr.payTypeCd, appr.payTypeNm || "");
    console.log("계약우체국(postNm):", appr.postNm || "");

    console.log("\n.env 에 추가하세요:");
    console.log(`POSTPARCEL_CUST_NO=${custNo}`);
    console.log(`POSTPARCEL_APPR_NO=${appr.apprNo}`);

    // 접수중지 우편번호 점검(선택, 암호화 없음)
    try {
      const stop = await getStoppedZip();
      const areas = stop.areaNm ? [].concat(stop.areaNm) : [];
      console.log(`\n접수중지 지역: ${areas.length ? areas.join(", ") : "없음"}`);
    } catch (e) {
      console.log("\n접수중지 조회 생략:", e.message);
    }
  } catch (e) {
    if (e instanceof PostParcelError) {
      console.error(`우체국 오류 ${e.code}: ${e.message}`);
      if (e.raw) console.error("응답:", String(e.raw).slice(0, 400));
    } else {
      console.error("셋업 실패:", e.message);
    }
    process.exit(1);
  }
})();
