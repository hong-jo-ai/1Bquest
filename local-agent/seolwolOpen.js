/**
 * 설월 출시 오픈 — 2026-09-10 10:00 KST 에 국문몰(shop1)·영문몰(shop2) 진열을 동시에 켠다.
 *
 * 배경: 9/8 에 설월이 실수로 진열 T 상태였다(양쪽 몰, 재고 300). 상세 사진·동봉 카드가
 *       아직인 상태라 진열을 F 로 내려두고, 출시 시각에 이 스크립트가 T 로 되돌린다.
 *
 * 실측(9/8): 카페24는 display=F 면 **직접 URL 도 404** 다. selling=T 여도 그렇다.
 *            그래서 진열 스위치 하나로 완전 차단/개방이 된다.
 *
 * 안전장치
 *  - 목표 시각 이전이면 아무것도 안 하고 종료(launchd 가 매년 9/10 에 뜨는 것 방지용 연도 체크 포함).
 *  - 이미 display=T 면 건드리지 않는다(멱등).
 *  - 성공하면 자기 launchd 잡을 unload 하고 plist 를 .done 으로 옮긴다 → 내년 9/10 에 안 뜬다.
 *
 * 발송(SMS/이메일)은 이 스크립트가 하지 않는다. 그건 waitlist-blast 쪽이고 사람이 confirm 해야 한다.
 */
const { execSync } = require("child_process");
const fs = require("fs"), path = require("path");

const PRODUCT_NO = 136;
const OPEN_AT = new Date("2026-09-10T09:30:00+09:00");
const LABEL = "com.paulvice.seolwol-open";
const PLIST = `/Users/mac/Library/LaunchAgents/${LABEL}.plist`;
const CLIENT = "/Users/mac/sungjo_ai/harriotwatches_website/tools/cafe24/client.mjs";

const log = (m) => console.log(`[${new Date().toISOString()}] [설월오픈] ${m}`);

(async () => {
  const now = new Date();
  if (now < OPEN_AT) { log(`아직 이르다 (${now.toISOString()} < ${OPEN_AT.toISOString()}). 종료.`); return; }
  if (now - OPEN_AT > 30 * 864e5) { log("목표 시각에서 30일 이상 지났다 — 오작동 방지로 종료."); return; }

  const { api } = await import(CLIENT);
  let changed = 0;
  for (const shop of [1, 2]) {
    const before = (await api("GET", `/api/v2/admin/products/${PRODUCT_NO}?shop_no=${shop}`)).product;
    if (before.display === "T") { log(`shop${shop} 이미 진열중 — 건너뜀`); continue; }
    await api("PUT", `/api/v2/admin/products/${PRODUCT_NO}`, {
      shop_no: shop, request: { shop_no: shop, display: "T" },
    });
    const after = (await api("GET", `/api/v2/admin/products/${PRODUCT_NO}?shop_no=${shop}`)).product;
    log(`shop${shop} display ${before.display} → ${after.display} (판매 ${after.selling}, 가격 ${after.price})`);
    if (after.display === "T") changed++;
    await new Promise((r) => setTimeout(r, 700));
  }

  // 실제 접근 가능해졌는지 라이브 확인
  for (const [host, label] of [["harriotwatches.co.kr", "국문"], ["harriotwatches.com", "영문"]]) {
    try {
      const res = await fetch(`https://${host}/product/detail.html?product_no=${PRODUCT_NO}`, {
        headers: { "User-Agent": "Mozilla/5.0" }, redirect: "manual",
      });
      log(`${label}몰 HTTP ${res.status}`);
    } catch (e) { log(`${label}몰 확인 실패: ${e.message}`); }
  }

  if (changed > 0) {
    try {
      execSync(`launchctl unload ${PLIST}`, { stdio: "ignore" });
      fs.renameSync(PLIST, PLIST + ".done");
      log("launchd 잡 해제 완료 — 다시 뜨지 않는다.");
    } catch (e) { log(`launchd 해제 실패(무해): ${e.message}`); }
  }
  log(`끝. 변경 ${changed}개 몰.`);
})().catch((e) => { console.error("[설월오픈] 실패:", e); process.exit(1); });
