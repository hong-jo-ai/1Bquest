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
 *   node local-agent/enMallOutbound.js                  수집·검증·보고 (launchd 11·13·15·17시)
 *        11시 = 발송 대기 전체 보고. 그 외 회차 = **새로 들어온 주문만** 알림(없으면 조용히).
 *   node local-agent/enMallOutbound.js --full           시각과 무관하게 전체 보고
 *   node local-agent/enMallOutbound.js --all            발송완료 건까지 포함(점검용)
 *   node local-agent/enMallOutbound.js --quiet          텔레그램 안 보냄
 *   node local-agent/enMallOutbound.js --label 20260915-0000016   ← 실제 라벨 발급(운임 발생)
 *        발급 → 공유드라이브 사본 → Xprinter 인쇄 → **카페24 송장번호 입력**까지 한 번에(사장님 9/18:
 *        "송장 라벨 인쇄하면 송장번호는 바로 입력해줘"). 인쇄 생략은 --no-print.
 *   node local-agent/enMallOutbound.js --tracking <주문번호> <송장번호>   ← 이미 뽑은 라벨의 송장만 입력
 *        주소가 부실하면 발급할 때만 덮어쓴다: --street/--street2/--city/--zip (예: 도시칸 공란인 대만 주문)
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
const NO_PRINT = ARGV.includes("--no-print");
const TRACK_FOR = ARGV.includes("--tracking") ? [ARGV[ARGV.indexOf("--tracking") + 1], ARGV[ARGV.indexOf("--tracking") + 2]] : null;
// 카페24 택배사 코드 — 페덱스 = "0027". 두 몰 영문몰 모두 기존 수기 입력분이 이 값이었다(2026-09-18 실측 6건).
// (carriers API 는 토큰 스코프가 없어 403 — 코드표를 조회할 수 없어 실측값으로 고정)
const FEDEX_CARRIER = "0027";
// 라벨 사본 — 원본은 os.tmpdir() 라 재부팅·정리 때 사라진다. 재출력용으로 공유드라이브에 둔다.
const LABEL_ARCHIVE = "/Users/mac/Library/CloudStorage/GoogleDrive-shong@harriotwatches.com/공유 드라이브/다운로드/페덱스라벨";
// 11시 한 번만 돌면 그 뒤에 들어온 주문은 **다음 날 11시**(주말이면 더 뒤)에야 보인다.
// 2026-09-18 12:04 각인 주문(Neil Pandya)이 그래서 텔레그램에 안 떴다. 하루 네 번 돌리되,
// 11시만 전체 보고이고 나머지 회차는 처음 보는 주문만 알린다 — 같은 목록을 네 번 받지 않게.
const kstHour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", hour: "numeric", hour12: false }).format(new Date())) % 24;
const FULL = ARGV.includes("--full") || kstHour === 11;
const REPORTED_KEY = "en_mall_reported:v1";   // { 주문번호: 처음 알린 시각 }

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

  // 주소 2행: 고객이 번지를 address2 에만 적는 경우가 있다(2026-09-22 대만 20260922-0000025 —
  // address_street 엔 "臺北市 信義區"(시·구)만, 번지는 address2). 안 실으면 번지 없는 라벨이 나간다.
  // 대부분의 주문은 address2 가 비었거나 street 와 같은 값이라, 다를 때만 2행으로 싣는다.
  const street2 = String(r.address2 || "").trim();
  const street2Use = street2 && street2 !== String(r.address_street || "").trim() ? street2 : "";

  const blockers = [];
  if (!phone) blockers.push("수취인 전화번호 없음(페덱스 필수)");
  if (!r.country_code) blockers.push("국가코드 없음");
  if (!r.zipcode) blockers.push("우편번호 없음");
  if (!String(r.address_street || "").trim()) blockers.push("상세주소 없음");
  // 도시칸이 비면 페덱스가 400 CITY.EMPTY 로 거절한다 — 라벨 발급 때가 아니라 수집 때 드러나야 한다.
  if (!String(r.address_city || "").trim()) blockers.push("도시 없음(--city 로 지정)");

  return {
    brand, orderNo: o.order_id, orderDate: String(o.order_date || "").slice(0, 16),
    name: r.name_en || r.name, phone,
    addrParts: { street: r.address_street, street2: street2Use, city: r.address_city, zip: r.zipcode, countryCode: r.country_code },
    addrText: `${r.address_street || ""}, ${r.address_city || ""} ${r.address_state || ""} ${r.zipcode || ""} ${r.country_code || ""}`.replace(/\s+/g, " ").trim(),
    amountUSD: Number(o.payment_amount) || 0,
    items, qty: items.reduce((a, b) => a + b.qty, 0),
    prod: items.map((i) => i.name).join(" + ").slice(0, 60),
    pendingCount: pending.length,
    itemCodes: pending.map((it) => it.order_item_code).filter(Boolean),
    engravings, shippingMessage: msg, msgLooksEngraving,
    box, blockers,
  };
}

/** 각인 블록 — 보고와 라벨 발급 알림이 같은 모양을 쓴다. */
function engravingLines(t) {
  const out = [];
  for (const e of t.engravings) {
    // 설월은 기본 서체가 정해져 있다(사장님 2026-09-18) — 서체를 물을 필요가 없다는 걸 보고에 같이 적는다.
    // ⚠️ 단, 각인 미리보기로 신청하면 문구 끝에 `[서체 · 크기기준 N.Npt]` 가 이미 붙어 온다.
    //    거기에 기본 서체까지 덧붙이면 한 줄에 서로 다른 서체가 둘 보인다 — 각인은 되돌릴 수 없다.
    //    고객이 고른 서체가 언제나 이긴다.
    const chose = /\[[^\]]*\d\s*pt\s*\]\s*$/i.test(String(e.text));
    const font = !chose && /설월|seolwol/i.test(String(e.product)) ? " · 서체 Times New Roman(설월 기본)" : "";
    out.push(`   「${e.text}」 ← ${String(e.product).slice(0, 34)}${font}`);
  }
  if (t.msgLooksEngraving) out.push(`   ⚠️ 배송메시지에 각인 언급: "${t.shippingMessage.slice(0, 80)}"`);
  return out;
}

/** 카페24 영문몰 주문에 송장 입력(→ 배송중). 이미 같은 송장이 있으면 건너뛴다(재실행 안전). */
async function registerTracking(db, m, orderNo, trackingNo, itemCodes) {
  const tk = await token(db, m);
  const base = `https://${m.mallId()}.cafe24api.com/api/v2/admin/orders/${orderNo}`;
  const cur = await (await fetch(`${base}/shipments?shop_no=2`, { headers: { Authorization: `Bearer ${tk}` } })).json();
  if ((cur.shipments || []).some((x) => String(x.tracking_no) === String(trackingNo))) return { ok: true, skipped: true };
  let codes = itemCodes;
  if (!codes || !codes.length) {
    const o = await (await fetch(`${base}?shop_no=2&embed=items`, { headers: { Authorization: `Bearer ${tk}` } })).json();
    codes = ((o.order && o.order.items) || []).filter((it) => it.status_text === "배송준비중").map((it) => it.order_item_code);
  }
  if (!codes.length) throw new Error("배송준비중 품목이 없음 — 이미 처리됐거나 취소됨");
  const r = await fetch(`${base}/shipments`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" },
    body: JSON.stringify({ shop_no: 2, request: { tracking_no: String(trackingNo), shipping_company_code: FEDEX_CARRIER, order_item_code: codes, status: "shipping" } }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`송장입력 실패(${r.status}): ${JSON.stringify(j.error || j).slice(0, 200)}`);
  return { ok: true, skipped: false };
}

/** 라벨 사본 저장 + Xprinter 인쇄(ZPL raw). 실패해도 발급·송장입력은 계속한다 — 결과만 돌려준다. */
function archiveAndPrint(t, r) {
  const { execFileSync } = require("child_process");
  const out = { archived: "", printed: false, printErr: "" };
  try {
    fs.mkdirSync(LABEL_ARCHIVE, { recursive: true });
    const stem = `${t.orderNo}_${String(t.name || "").replace(/[^\w가-힣]/g, "")}_${r.trackingNumber}`;
    if (r.labelPath) fs.copyFileSync(r.labelPath, path.join(LABEL_ARCHIVE, `${stem}.zpl`));
    if (r.invoicePath) fs.copyFileSync(r.invoicePath, path.join(LABEL_ARCHIVE, `${stem}_invoice.pdf`));
    out.archived = LABEL_ARCHIVE;
  } catch (e) { log(`⚠️ 라벨 사본 저장 실패: ${e.message}`); }
  if (!NO_PRINT && r.labelPath) {
    try { execFileSync("lpr", ["-P", "Xprinter_ZPL", "-o", "raw", r.labelPath]); out.printed = true; }
    catch (e) { out.printErr = e.message; }
  }
  return out;
}

async function loadReported(db) {
  try {
    const { data } = await db.from("kv_store").select("data").eq("key", REPORTED_KEY).maybeSingle();
    return (data && data.data) || {};
  } catch { return null; }   // 조회 실패 = 모름 → 전부 새 주문으로 취급(알림 누락보다 중복이 낫다)
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

  // ── 송장번호만 입력(라벨은 이미 뽑은 경우) ──
  if (TRACK_FOR) {
    const [orderNo, trackingNo] = TRACK_FOR;
    const t = all.find((x) => x.orderNo === orderNo);
    if (!t || !trackingNo) { log(`✗ ${orderNo} — 배송준비중 대상에 없거나 송장번호 없음`); process.exit(1); }
    const tr = await registerTracking(db, MALLS.find((x) => x.brand === t.brand), orderNo, trackingNo, t.itemCodes);
    log(tr.skipped ? `= ${orderNo} 이미 ${trackingNo} 입력됨` : `✅ ${orderNo} 카페24 송장입력 ${trackingNo} (배송중)`);
    return;
  }

  // ── 라벨 발급(명시 지시가 있을 때만) ──
  if (LABEL_FOR) {
    const t = all.find((x) => x.orderNo === LABEL_FOR) || null;
    if (!t) { log(`✗ ${LABEL_FOR} — 대상에 없음(--all 로 확인)`); process.exit(1); }
    // 주소 보정 — 고객이 카페24 칸을 제각각 채워 페덱스가 거절하는 경우가 있다(도시칸 공란 등).
    // 주문서를 고치는 대신 발급할 때만 덮어쓴다. 원본 주소는 로그에 남겨 무엇을 바꿨는지 보이게 한다.
    for (const [flag, key] of [["--street", "street"], ["--street2", "street2"], ["--city", "city"], ["--zip", "zip"]]) {
      const i = ARGV.indexOf(flag);
      if (i >= 0 && ARGV[i + 1]) {
        log(`주소 보정 ${key}: ${JSON.stringify(t.addrParts[key] || "")} → ${JSON.stringify(ARGV[i + 1])}`);
        t.addrParts[key] = ARGV[i + 1];
        t.blockers = t.blockers.filter((b) => !(key === "city" && b.startsWith("도시 없음")));
      }
    }
    if (t.blockers.length) { log(`✗ ${LABEL_FOR} — 미비: ${t.blockers.join(", ")}`); process.exit(1); }
    const { createShipment } = require("./fedexShip");
    log(`라벨 발급 시작 — ${t.orderNo} ${t.name} ${t.addrParts.countryCode} · ${t.box.boxId} ${t.box.lengthCm}×${t.box.widthCm}×${t.box.heightCm}cm`);
    const r = await createShipment({
      orderNo: t.orderNo, name: t.name, phone: t.phone, addrParts: t.addrParts,
      prod: t.prod, qty: t.qty, amountUSD: t.amountUSD, items: t.items,
    });
    log(`✅ tracking=${r.trackingNumber} · ${r.service} · 운임 ${r.cost}`);
    log(`   라벨 ${r.labelPath}`);
    const pr = archiveAndPrint(t, r);
    log(pr.printed ? "🖨️ Xprinter 인쇄 전송" : NO_PRINT ? "인쇄 생략(--no-print)" : `⚠️ 인쇄 실패: ${pr.printErr}`);
    let trackMsg;
    try {
      const m = MALLS.find((x) => x.brand === t.brand);
      const tr = await registerTracking(db, m, t.orderNo, r.trackingNumber, t.itemCodes);
      trackMsg = tr.skipped ? "카페24 송장 이미 입력됨" : "카페24 송장입력 완료(배송중)";
    } catch (e) { trackMsg = `⚠️ 카페24 송장입력 실패 — ${e.message}`; }
    log(trackMsg);
    const eng = (t.engravings.length || t.msgLooksEngraving) ? `\n\n✍️ 각인 — 새긴 뒤 인계\n${engravingLines(t).join("\n")}` : "";
    if (!QUIET) await relayText(`🏷️ 영문몰 라벨 발급\n${t.brand} ${t.orderNo} ${t.name}\n${r.trackingNumber} · ${r.service} · ${r.cost}\n${pr.printed ? "🖨️ 인쇄 전송" : "인쇄 안 함"} · ${trackMsg}${eng}\n⚠️ 픽업은 따로 예약해야 한다`).catch(() => {});
    return;
  }

  // ── 보고 ──
  // 11시(FULL) 외 회차는 처음 보는 주문만. --all(점검용)은 항상 전체.
  const reported = ALL ? {} : await loadReported(db);
  const fresh = all.filter((x) => !reported || !reported[x.orderNo]);
  const scope = FULL || ALL ? all : fresh;
  if (!scope.length) {
    log(`새 주문 없음(대기 ${all.length}건은 이미 보고됨) — 알림 생략`);
    if (!ALL) await beat("en-mall-outbound", { pending: all.length, ready: all.filter((x) => !x.blockers.length).length, held: all.filter((x) => x.blockers.length).length });
    return;
  }
  const ready = scope.filter((x) => !x.blockers.length);
  const held  = scope.filter((x) => x.blockers.length);
  const engraved = scope.filter((x) => x.engravings.length || x.msgLooksEngraving);
  const head = FULL || ALL ? `🌍 영문몰 주문 — 발송 대기 ${all.length}건` : `🆕 영문몰 새 주문 ${scope.length}건 (전체 대기 ${all.length})`;
  const lines = [head + (engraved.length ? ` · ✍️ 각인 ${engraved.length}건` : "")];

  // 각인을 맨 위에 따로 모아 보여준다 — 주문 목록에 섞이면 묻힌다.
  if (engraved.length) {
    lines.push(`\n━━━ ✍️ 각인 있는 주문 ━━━`);
    for (const t of engraved) {
      lines.push(`\n✍️ ${t.brand} ${t.orderNo} · ${t.name}`);
      lines.push(...engravingLines(t));
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
  let sent = false;
  if (!QUIET && scope.length) sent = (await relayText(msg).catch(() => false)) === true;
  if (scope.length && !QUIET && !sent) log("텔레그램 실패 — 보고기록 안 남김(다음 회차에 다시 알림)");
  // 알린 주문 기록 — 실제로 보냈을 때만(실패했는데 기록하면 다음 회차에서도 영영 안 뜬다).
  if (sent && !ALL && reported) {
    const now = new Date().toISOString();
    const next = { ...reported };
    for (const t of scope) if (!next[t.orderNo]) next[t.orderNo] = now;
    // 45일 지난 기록은 정리 — 주문 조회 범위(30일)보다 길게 둔다.
    const cutoff = Date.now() - 45 * 86400000;
    for (const [k, v] of Object.entries(next)) if (Date.parse(v) < cutoff) delete next[k];
    await db.from("kv_store").upsert({ key: REPORTED_KEY, data: next, updated_at: now }, { onConflict: "key" })
      .then(({ error }) => error && log(`보고기록 저장 실패: ${error.message}`));
  }
  // 하트비트는 **정규 실행(11시)만** 찍는다. --all 은 발송완료 건까지 훑는 점검용이라
  // 그대로 두면 사람이 확인차 한 번 돌릴 때마다 관제 수치가 실제와 다르게 덮인다
  // (2026-09-18: 11시 실제 pending 0 이었는데 점검 실행이 23 으로 덮어썼다).
  if (!ALL) await beat("en-mall-outbound", { pending: all.length, ready: ready.length, held: held.length });
}

main().catch(async (e) => {
  log(`❌ 실패: ${e.message}`);
  try { await relayText(`🌍 영문몰 수집 실패\n${e.message}`); } catch { /* 알림 실패는 삼킨다 */ }
  process.exit(1);
});
