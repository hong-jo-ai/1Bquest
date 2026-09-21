#!/usr/bin/env node
/**
 * 해외 협찬(시딩) 발송 — 페덱스 라벨 발급 전용.
 *
 * 판매 주문(enMallOutbound.js)과 **일부러 분리**한 이유:
 *  ① 관세를 우리가 낸다(DDP). 판매는 $350 DDU 전제라 RECIPIENT 가 맞지만, 협찬에서 받는 사람이
 *     관세를 내야 하면 선물이 아니라 청구서가 된다. 2025 년 인도네시아 협찬(@trpksa)이 관세
 *     ≈$141 미납으로 **반송·협업 무산**된 게 이 스크립트를 만든 이유다.
 *  ② 카페24 주문이 없다 → 송장 역입력·매출·재고 처리가 전부 무관하다.
 *  ③ **발송 기록을 남긴다**(kv seeding:log:v1). 과거 협찬 이력이 IG DM 에만 흩어져 있어
 *     "누구에게 뭘 보냈나"를 찾는 데 한참 걸렸다(2026-09-21).
 *
 * 사용:
 *   node local-agent/seedingShip.js --name "Arul Khoja" --phone "628..." \
 *     --street "..." --city "Jakarta" --zip "12345" --country ID \
 *     --prod "Seolwol" --value 350 --handle "@arulkhoja" --note "기원 협찬 재연락"
 *
 *   기본은 **드라이런**(입력 점검만, 과금 없음). 실제 발급은 `--confirm`.
 *   `--no-print` 인쇄 생략 · `--void` 발급 직후 취소(테스트용, 과금 없음)
 *
 * 🔴 라벨 발급 ≠ 픽업 예약. 픽업은 fedexShip.createPickup 으로 따로 잡는다(당일 마감 15:30).
 */
const fs = require("fs"), path = require("path");
const { execFileSync } = require("child_process");
const fedex = require("./fedexShip");

const LABEL_ARCHIVE = "/Users/mac/Library/CloudStorage/GoogleDrive-shong@harriotwatches.com/공유 드라이브/다운로드/페덱스라벨";
const LOG_KEY = "seeding:log:v1";

function arg(name, def = "") {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : def;
}
const has = (n) => process.argv.includes(`--${n}`);
const log = (...a) => console.log("[seeding]", ...a);

function loadEnv(p) {
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

async function saveLog(entry) {
  try {
    const { createClient } = require("@supabase/supabase-js");
    const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data } = await db.from("kv_store").select("data").eq("key", LOG_KEY).maybeSingle();
    const list = (data && data.data && data.data.sent) || [];
    list.push(entry);
    await db.from("kv_store").upsert(
      { key: LOG_KEY, data: { sent: list }, updated_at: new Date().toISOString() },
      { onConflict: "key" }
    );
    return true;
  } catch (e) { log(`⚠️ 기록 저장 실패(발송 자체는 정상): ${e.message}`); return false; }
}

(async () => {
  loadEnv(path.join(__dirname, "..", ".env.local"));
  loadEnv(path.join(__dirname, "..", ".env.supabase"));

  const o = {
    name: arg("name"), phone: arg("phone"),
    street: arg("street"), street2: arg("street2"), city: arg("city"), zip: arg("zip"),
    country: arg("country").toUpperCase(),
    prod: arg("prod", "Seolwol"), value: Number(arg("value", "350")),
    handle: arg("handle"), note: arg("note"),
  };
  const missing = ["name", "street", "city", "country"].filter((k) => !o[k]);
  if (missing.length) { console.error(`❌ 필수 누락: ${missing.join(", ")}`); process.exit(1); }

  // 협찬 참조번호 — 판매 주문번호와 섞이지 않게 SEED- 접두사를 쓴다.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
  const orderNo = arg("ref", `SEED-${today.replace(/-/g, "")}-${(o.handle || o.name).replace(/[^\w]/g, "").slice(0, 8).toUpperCase()}`);

  log(`수취: ${o.name} (${o.country}) ${o.handle || ""}`);
  log(`주소: ${o.street}${o.street2 ? " / " + o.street2 : ""}, ${o.city} ${o.zip}`);
  log(`품목: ${o.prod} · 신고가 $${o.value} · 참조 ${orderNo}`);
  log(`관세: 🔴 DDP — 발송인(우리) 부담`);

  if (!has("confirm")) {
    log("");
    log("⚠️ 드라이런입니다. 과금·발급 없음. 실제로 보내려면 --confirm 을 붙이세요.");
    log("   예상 서비스는 발급 시 국가로 자동 결정되고, 운임은 발급 응답에 찍힙니다.");
    return;
  }

  const order = {
    name: o.name, phone: o.phone, email: "",
    addrParts: { street: o.street, street2: o.street2, city: o.city, zip: o.zip, countryCode: o.country },
    prod: o.prod, qty: 1, amountUSD: o.value, orderNo,
  };

  log("라벨 발급 중...");
  // 협찬은 항상 DDP(관세 우리 부담) + 샘플 신고. shipDate 를 주면 그날짜로 발송 예정이 찍힌다.
  const r = await fedex.createShipment(order, { ddp: true, sample: true, shipDate: arg("ship-date") || undefined });
  log(`✅ 발급: tracking=${r.trackingNumber} · ${r.service} · 운임 ${r.cost}`);
  log(`   (운임에 관세는 안 잡힙니다 — DDP 관세는 나중에 페덱스가 따로 청구합니다)`);

  // 사본 + 인쇄
  try {
    fs.mkdirSync(LABEL_ARCHIVE, { recursive: true });
    const stem = `${orderNo}_${String(o.name).replace(/[^\w가-힣]/g, "")}_${r.trackingNumber}`;
    if (r.labelPath) fs.copyFileSync(r.labelPath, path.join(LABEL_ARCHIVE, `${stem}.zpl`));
    if (r.invoicePath) fs.copyFileSync(r.invoicePath, path.join(LABEL_ARCHIVE, `${stem}_invoice.pdf`));
    log(`📁 사본: ${LABEL_ARCHIVE}`);
  } catch (e) { log(`⚠️ 사본 저장 실패: ${e.message}`); }

  if (!has("no-print") && r.labelPath) {
    try { execFileSync("lpr", ["-P", "Xprinter_ZPL", "-o", "raw", r.labelPath]); log("🖨️ Xprinter 인쇄 전송"); }
    catch (e) { log(`⚠️ 인쇄 실패(라벨은 정상 발급됨): ${e.message}`); }
  }

  if (has("void")) {
    const v = await fedex.voidShipment(r.trackingNumber);
    log(v.ok ? "🧹 void 완료(과금 없음)" : `⚠️ void 실패: ${JSON.stringify(v.j).slice(0, 200)}`);
    return;
  }

  await saveLog({
    date: today, ref: orderNo, handle: o.handle, name: o.name, country: o.country,
    product: o.prod, declaredUSD: o.value, tracking: r.trackingNumber,
    service: r.service, cost: r.cost, duties: "DDP(sender)", note: o.note,
  });
  log(`📝 협찬 기록 저장(kv ${LOG_KEY})`);
  log("");
  log("🔴 픽업은 별도입니다 — 오늘 보내려면 15:30 전에 예약하세요.");
})().catch((e) => { console.error("[seeding] 오류:", e.message); process.exit(1); });
