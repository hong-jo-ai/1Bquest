/**
 * 무신사·29CM CS(클레임) 점검 → 텔레그램 알림.
 *
 * 사장님 방침(2026-09-01): 마켓 CS 는 **인박스로 안 가져온다.** 답장이 각 마켓
 * 어드민에서만 되기 때문이다 → 새 건이 생기면 알림만 보내고 직접 들어가서 처리.
 * (W컨셉은 `wconceptCsSync.js` 가 같은 방식으로 처리한다.)
 *
 * 마켓별로 읽는 깊이가 다르다 — 화면 구조가 다르고, 깨지기 쉬운 쪽은 얕게 읽는다.
 *  - **29CM**: 취소/반품/교환 목록이 평범한 table 이라 주문 단위로 읽는다.
 *  - **무신사**: 목록이 iframe 안 AG-Grid(ord06)라 셀렉터가 잘 깨진다.
 *    대시보드가 "환불 N건 · 교환 N건" 을 이미 주므로 **건수만** 읽고 링크를 붙인다.
 *    사장님이 원한 건 "있다는 걸 알려달라"이지 목록 재현이 아니다.
 *
 * 실행: node marketplaceCsScan.js            (전체)
 *       node marketplaceCsScan.js 29cm       (한 마켓만)
 */
require("dotenv").config({ override: true });
const { getMarketplacePage } = require("./marketplaceSync");
const { notifyMarketplaceCs } = require("./marketplaceCsNotify");
const { sendTelegram } = require("./notifyFail");
const { beat } = require("./heartbeat");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const withTimeout = (p, ms, what) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} 타임아웃`)), ms))]);

// 29CM 목록 열 배치(2026-09-01 실측)
//  [1]상태 [2]AS번호 [3]주문번호 [4]사유 [5]부담주체 [6]배송비 [8]택배/송장 [10]고객명
const CM29_PAGES = [
  { type: "cancel", label: "취소", url: "https://partner-order.29cm.co.kr/cancel" },
  { type: "return", label: "반품", url: "https://partner-order.29cm.co.kr/return" },
  { type: "exchange", label: "교환", url: "https://partner-order.29cm.co.kr/exchange" },
];

/** 29CM: 취소·반품·교환 목록에서 주문 단위 클레임을 뽑는다. */
async function scanCm29() {
  const { page } = await withTimeout(getMarketplacePage("29cm", log), 30000, "29CM 창 연결");
  const claims = [];
  for (const p of CM29_PAGES) {
    try {
      await withTimeout(page.goto(p.url, { waitUntil: "domcontentloaded", timeout: 25000 }), 30000, "goto");
      await sleep(3500);
      const rows = await page.evaluate(() =>
        [...document.querySelectorAll("tr")]
          .map((tr) => [...tr.querySelectorAll("td")].map((td) => (td.innerText || "").replace(/\s+/g, " ").trim()))
          .filter((c) => c.length > 10 && /^ORD\d{8}-\d+$/.test(c[3] || "")),
      );
      for (const c of rows) {
        const statusText = c[1] || "";
        claims.push({
          orderNumber: c[3],
          claimType: p.type,
          // "반품 완료"처럼 완료/취소면 손댈 게 없다 → notify 쪽에서 걸러진다.
          status: /완료|취소|철회|거부/.test(statusText) ? "done" : "requested",
          statusText: `${p.label} · ${statusText}`,
          customerName: c[10] || c[9] || "",
          reason: c[4] || "",
          product: "",
        });
      }
      log(`29CM ${p.label}: ${rows.length}행`);
    } catch (e) {
      log(`29CM ${p.label} 실패: ${e.message.slice(0, 80)}`);
    }
  }
  return claims;
}

/**
 * 무신사: 대시보드의 클레임 건수만 읽는다.
 * 목록(iframe ord06 AG-Grid)은 셀렉터가 자주 깨져 알림 신뢰도를 떨어뜨린다.
 */
async function scanMusinsa() {
  const { page } = await withTimeout(getMarketplacePage("musinsa", log), 30000, "무신사 창 연결");
  await withTimeout(page.goto("https://partner.musinsa.com/", { waitUntil: "domcontentloaded", timeout: 25000 }), 30000, "goto");
  await sleep(3500);
  const text = await page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " "));
  // "환불 1건, 교환 0건, 기타 0건의 클레임 문의가 있어요."
  const m = text.match(/환불\s*(\d+)건[,\s]*교환\s*(\d+)건[,\s]*기타\s*(\d+)건/);
  if (!m) {
    log("무신사 클레임 요약 문구를 못 찾음 — 대시보드 문구가 바뀌었을 수 있다");
    return null;
  }
  return { refund: Number(m[1]), exchange: Number(m[2]), etc: Number(m[3]) };
}

async function main() {
  const only = (process.argv[2] || "").toLowerCase();

  if (!only || only === "29cm") {
    try {
      const claims = await scanCm29();
      const r = await notifyMarketplaceCs("29cm", claims);
      log(`29CM 알림: 신규 ${r.notified} / 기존 ${r.skipped}`);
    } catch (e) {
      log(`29CM 스캔 실패: ${e.message}`);
    }
  }

  if (!only || only === "musinsa") {
    try {
      const c = await scanMusinsa();
      if (c) {
        const open = c.refund + c.exchange + c.etc;
        log(`무신사 클레임 환불 ${c.refund} · 교환 ${c.exchange} · 기타 ${c.etc}`);
        // 건수 기반이라 seen 키에 건수를 담는다 — 숫자가 그대로면 다시 안 알린다.
        await notifyMarketplaceCs("musinsa", open ? [{
          orderNumber: `클레임 ${open}건`,
          claimType: "summary",
          status: "requested",
          statusText: `환불 ${c.refund} · 교환 ${c.exchange} · 기타 ${c.etc}`,
          reason: "무신사는 목록 대신 건수만 봅니다 — 파트너센터에서 확인해 주세요",
        }] : []);
      }
    } catch (e) {
      log(`무신사 스캔 실패: ${e.message}`);
    }
  }

  await beat("marketplace-cs-scan");
  log("=== 완료 ===");
  process.exit(0);
}

main().catch(async (e) => {
  console.error("ERR", e);
  try { await sendTelegram(`🔴 마켓 CS 점검 실패\n${e.message || e}`, { tag: "marketplace-cs-scan" }); } catch {}
  process.exit(1);
});
