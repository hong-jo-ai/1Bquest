/**
 * 영문몰(shop_no=2) 미출고 주문 수집 → 검증 → 텔레그램 보고. 매일 오전 11시.
 *
 * 왜 필요한가: 폴바이스·해리엇 영문몰 주문은 **우체국 출고목록에도 pp_shipments 에도 안 들어온다**
 * (`buildPostOffice.js` 의 주문 조회가 shop_no 를 안 넘겨서 카페24가 shop1 만 돌려준다).
 * 그래서 영문몰 주문이 들어와도 아무도 모르고, 9/15 폴바이스 첫 주문(Young Kwon)은 수기로 처리했다.
 * 해리엇 영문몰은 최근 45일 25건이 돌고 있어 계속 수기로 둘 수 없다.
 *
 * ⚠️ **기본 실행은 라벨을 발급하지 않는다.** createShipment 는 호출하는 순간 실제 운임이 발생한다
 * (2026-09-18 테스트 라벨이 54,860원이었다). 주소·전화번호가 불완전한 주문이 실제로 있었으므로
 * (Jon Siepmann 건은 수취인 전화가 없어 며칠 묶였다) 수집·검증까지만 자동으로 하고,
 * 라벨은 사람이 보고 `--label <주문번호>` 로 지시할 때만 만든다.
 *
 * 실행:
 *   node local-agent/enMallOutbound.js                  수집·검증·보고 (launchd 11시)
 *   node local-agent/enMallOutbound.js --all            발송완료 건까지 포함(점검용)
 *   node local-agent/enMallOutbound.js --quiet          텔레그램 안 보냄
 *   node local-agent/enMallOutbound.js --label 20260915-0000016   ← 실제 라벨 발급(운임 발생)
 */
const fs = require("fs"), path = require("path"), os = require("os");
const DASH = path.resolve(__dirname, "..");
for (const p of [`${DASH}/.env.supabase`, `${DASH}/.env.local`, `${__dirname}/.env`]) {
  try { for (const l of fs.readFileSync(p, "utf8").split("\n")) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  } } catch { /* 없으면 무시 */ }
}
const { createClient } = require(`${DASH}/node_modules/@supabase/supabase-js`);
const { relayText } = require("./telegramRelay");
const { pickBox } = require("./boxSpec");
const { beat } = require("./heartbeat");

const ARGV = process.argv.slice(2);
const ALL = ARGV.includes("--all");
const QUIET = ARGV.includes("--quiet");
const LABEL_FOR = ARGV.includes("--label") ? ARGV[ARGV.indexOf("--label") + 1] : "";

const log = (m) => console.log(`[${new Date().toISOString()}] [en-mall] ${m}`);

const MALLS = [
  { brand: "폴바이스", mallId: () => process.env.CAFE24_MALL_ID,         kvKey: "cafe24_refresh_token" },
  { brand: "해리엇",   mallId: () => process.env.HARRIOT_CAFE24_MALL_ID, kvKey: "cafe24_refresh_token:harriot" },
];

const sb = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// ── 각인 ────────────────────────────────────────────────
// 영문몰 상품에도 각인 옵션("Engraving message")이 정상 등록돼 있고 값이 실제로 들어온다
// (2026-09-18 실측: 최근 30일 해리엇 shop2 주문 중 9건에 각인). 그동안 안 읽힌 건 옵션이
// 없어서가 아니라 buildPostOffice 가 shop2 를 아예 안 봐서 **아무도 읽지 않았기** 때문이다.
// 각인은 새기면 되돌릴 수 없고 재판매도 못 한다(2026-09-01 강한석 건 2점 폐기) — 출고 전에 보여야 한다.
const NON_ENGRAVABLE = /밴드|스트랩|strap|band|조절|도구|tool|쇼핑백|케이스|case|보증서|파우치|pouch|공구|충전/i;
const engravable = (name) => !NON_ENGRAVABLE.test(String(name || ""));

/** 카페24 각인(추가 입력 옵션) 추출: additional_option_value="라벨=값" → 값. 비면 "". */
function engravingOf(it) {
  let raw = String(it.additional_option_value || "").trim();
  if (!raw && Array.isArray(it.additional_option_values)) {
    const a = it.additional_option_values.find((x) => x && x.value);
    if (a) raw = (a.name ? `${a.name}=` : "") + a.value;
  }
  if (!raw) return "";
  return raw.includes("=") ? raw.split("=").slice(1).join("=").trim() : raw.trim();
}

/** 웹챗·메일로 따로 받아 수기 등록한 각인(kv manual_engravings). 주문번호 → 문구. */
async function manualEngravings(db) {
  try {
    const { data } = await db.from("kv_store").select("data").eq("key", "manual_engravings").maybeSingle();
    return (data && data.data) || {};
  } catch (e) { log(`수기 각인 조회 실패(무시): ${e.message}`); return {}; }
}

/** 카페24 토큰 — 유효하면 그대로 쓰고, 만료면 refresh 후 KV 갱신.
 *  ⚠️ 프로덕션과 동시에 refresh 하면 refresh_token 을 잃는다. 유효 토큰을 먼저 확인하는 게 가드다. */
async function token(db, m) {
  const { data } = await db.from("kv_store").select("data").eq("key", m.kvKey).maybeSingle();
  let t = data && data.data, now = Date.now();
  if (typeof t === "string") t = { access_token: "", refresh_token: t, expires_at: 0 };
  if (!t || !t.refresh_token) throw new Error(`${m.brand} 카페24 토큰 없음(${m.kvKey})`);
  if (t.access_token && t.expires_at && t.expires_at - 90000 > now) return t.access_token;
  const base = `https://${m.mallId()}.cafe24api.com`;
  const clientId = m.kvKey.includes("harriot") ? process.env.HARRIOT_CAFE24_CLIENT_ID : process.env.CAFE24_CLIENT_ID;
  const secret   = m.kvKey.includes("harriot") ? process.env.HARRIOT_CAFE24_CLIENT_SECRET : process.env.CAFE24_CLIENT_SECRET;
  const r = await fetch(`${base}/api/v2/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + Buffer.from(`${clientId}:${secret}`).toString("base64") },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(t.refresh_token)}`,
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`${m.brand} 토큰 refresh 실패`);
  await db.from("kv_store").upsert({ key: m.kvKey, data: { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: now + 110 * 60 * 1000 }, updated_at: new Date().toISOString() }, { onConflict: "key" });
  return j.access_token;
}

const ymd = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

/** 영문몰 주문 수집. shop_no=2 를 **명시**해야 한다 — 빼면 카페24가 국문몰(shop1)만 준다. */
async function fetchOrders(db, m) {
  const tk = await token(db, m);
  const base = `https://${m.mallId()}.cafe24api.com`;
  const out = []; let off = 0;
  for (;;) {
    const qs = new URLSearchParams({ shop_no: "2", start_date: ymd(30), end_date: ymd(0), limit: "100", offset: String(off), embed: "items,receivers" });
    const r = await fetch(`${base}/api/v2/admin/orders?${qs}`, { headers: { Authorization: `Bearer ${tk}` } });
    const j = await r.json();
    const b = j.orders || [];
    out.push(...b);
    if (b.length < 100) break;
    off += 100;
  }
  return out;
}

/** 카페24 주문 → 페덱스에 넘길 형태로. 검증 결과(blockers)도 함께 돌려준다. */
function toShipment(o, brand, manual = {}) {
  const r = (o.receivers || [])[0] || {};
  const items = (o.items || []).map((it) => ({ name: it.product_name, qty: Number(it.quantity) || 1 }));

  // 주문서 각인이 우선, 없으면 수기 등록분(웹챗·메일로 따로 받은 것) — 각인 가능한 품목에만.
  const engravings = [];
  for (const it of (o.items || [])) {
    const v = engravingOf(it) || (engravable(it.product_name) ? (manual[String(o.order_id)] || "") : "");
    if (v) engravings.push({ product: it.product_name, text: v });
  }
  // 배송메시지에 각인을 적어 보내는 고객이 있다(2026-09-18 김영주 건: 각인칸은 비고 메시지에만 있었다).
  const msg = String(r.shipping_message || "").trim();
  const msgLooksEngraving = /engrav|각인/i.test(msg);
  const pending = (o.items || []).filter((it) => String(it.status_text || "") === "배송준비중");
  // 전화는 국가번호가 "1-9095038383" 처럼 붙어 온다 — 페덱스는 숫자만 받는다.
  const phone = String(r.cellphone || r.phone || "").replace(/[^\d]/g, "");
  const box = pickBox(items);

  const blockers = [];
  if (!phone) blockers.push("수취인 전화번호 없음(페덱스 필수)");
  if (!r.country_code) blockers.push("국가코드 없음");
  if (!r.zipcode) blockers.push("우편번호 없음");
  if (!String(r.address_street || "").trim()) blockers.push("상세주소 없음");

  return {
    brand, orderNo: o.order_id, orderDate: String(o.order_date || "").slice(0, 16),
    name: r.name_en || r.name, phone,
    addrParts: { street: r.address_street, city: r.address_city, zip: r.zipcode, countryCode: r.country_code },
    addrText: `${r.address_street || ""}, ${r.address_city || ""} ${r.address_state || ""} ${r.zipcode || ""} ${r.country_code || ""}`.replace(/\s+/g, " ").trim(),
    amountUSD: Number(o.payment_amount) || 0,
    items, qty: items.reduce((a, b) => a + b.qty, 0),
    prod: items.map((i) => i.name).join(" + ").slice(0, 60),
    pendingCount: pending.length,
    engravings, shippingMessage: msg, msgLooksEngraving,
    box, blockers,
  };
}

async function main() {
  const db = sb();
  const manual = await manualEngravings(db);
  const all = [];
  for (const m of MALLS) {
    if (!m.mallId()) { log(`${m.brand} 몰 미설정 — 스킵`); continue; }
    try {
      const orders = await fetchOrders(db, m);
      for (const o of orders) {
        const s = toShipment(o, m.brand, manual);
        if (!ALL && !s.pendingCount) continue;     // 기본은 '배송준비중'만
        all.push(s);
      }
      log(`${m.brand} shop2 조회 ${orders.length}건 → 대상 ${all.filter((x) => x.brand === m.brand).length}건`);
    } catch (e) {
      log(`⚠️ ${m.brand} 조회 실패: ${e.message}`);
      if (!QUIET) await relayText(`🌍 영문몰 수집 실패 — ${m.brand}\n${e.message}`).catch(() => {});
    }
  }

  // ── 라벨 발급(명시 지시가 있을 때만) ──
  if (LABEL_FOR) {
    const t = all.find((x) => x.orderNo === LABEL_FOR) || null;
    if (!t) { log(`✗ ${LABEL_FOR} — 대상에 없음(--all 로 확인)`); process.exit(1); }
    if (t.blockers.length) { log(`✗ ${LABEL_FOR} — 미비: ${t.blockers.join(", ")}`); process.exit(1); }
    const { createShipment } = require("./fedexShip");
    log(`라벨 발급 시작 — ${t.orderNo} ${t.name} ${t.addrParts.countryCode} · ${t.box.boxId} ${t.box.lengthCm}×${t.box.widthCm}×${t.box.heightCm}cm`);
    const r = await createShipment({
      orderNo: t.orderNo, name: t.name, phone: t.phone, addrParts: t.addrParts,
      prod: t.prod, qty: t.qty, amountUSD: t.amountUSD, items: t.items,
    });
    log(`✅ tracking=${r.trackingNumber} · ${r.service} · 운임 ${r.cost}`);
    log(`   라벨 ${r.labelPath}`);
    if (!QUIET) await relayText(`🏷️ 영문몰 라벨 발급\n${t.brand} ${t.orderNo} ${t.name}\n${r.trackingNumber} · ${r.service} · ${r.cost}`).catch(() => {});
    return;
  }

  // ── 보고 ──
  const ready = all.filter((x) => !x.blockers.length);
  const held  = all.filter((x) => x.blockers.length);
  const engraved = all.filter((x) => x.engravings.length || x.msgLooksEngraving);
  const lines = [`🌍 영문몰 주문 — 발송 대기 ${all.length}건` + (engraved.length ? ` · ✍️ 각인 ${engraved.length}건` : "")];

  // 각인을 맨 위에 따로 모아 보여준다 — 주문 목록에 섞이면 묻힌다.
  if (engraved.length) {
    lines.push(`\n━━━ ✍️ 각인 있는 주문 ━━━`);
    for (const t of engraved) {
      lines.push(`\n✍️ ${t.brand} ${t.orderNo} · ${t.name}`);
      for (const e of t.engravings) lines.push(`   「${e.text}」 ← ${String(e.product).slice(0, 34)}`);
      if (t.msgLooksEngraving) lines.push(`   ⚠️ 배송메시지에 각인 언급: "${t.shippingMessage.slice(0, 80)}"`);
    }
    lines.push(`\n━━━━━━━━━━━━━━━━`);
  }

  for (const t of ready) {
    lines.push(`\n✅ ${t.brand} ${t.orderNo} · ${t.name} (${t.addrParts.countryCode})`);
    lines.push(`   ${t.prod} · $${t.amountUSD}`);
    if (t.engravings.length) lines.push(`   ✍️ 각인: ${t.engravings.map((e) => `「${e.text}」`).join(" ")}`);
    lines.push(`   ${t.box.boxId} ${t.box.lengthCm}×${t.box.widthCm}×${t.box.heightCm}cm · 청구 ${t.box.billableKg}kg`);
  }
  for (const t of held) {
    lines.push(`\n⛔ ${t.brand} ${t.orderNo} · ${t.name || "?"} — ${t.blockers.join(" / ")}`);
  }
  if (!all.length) lines.push("   (없음)");
  else lines.push(`\n라벨 발급: node local-agent/enMallOutbound.js --label <주문번호>`);

  const msg = lines.join("\n");
  console.log(msg);
  if (!QUIET && all.length) await relayText(msg).catch((e) => log(`텔레그램 실패: ${e.message}`));
  await beat("en-mall-outbound", { pending: all.length, ready: ready.length, held: held.length });
}

main().catch(async (e) => {
  log(`❌ 실패: ${e.message}`);
  try { await relayText(`🌍 영문몰 수집 실패\n${e.message}`); } catch { /* 알림 실패는 삼킨다 */ }
  process.exit(1);
});
