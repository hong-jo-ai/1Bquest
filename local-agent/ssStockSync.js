/**
 * 스마트스토어 ↔ 카페24 해리엇 재고 동기화 (형 결정 2026-09-10: 카페24 = 기준 재고)
 *
 *  ① 스마트스토어에서 결제된 주문을 카페24 재고에서 차감한다. 처리한 productOrderId 를 기록해 두 번 빼지 않고,
 *     취소·반품되면 되돌린다. (결제 전 자동취소 CANCELED_BY_NOPAYMENT 는 애초에 차감하지 않으므로 무시)
 *  ② 스마트스토어 재고가 카페24 재고보다 **많을 때만** 카페24 값으로 낮춘다.
 *     올리지는 않는다 — 형이 스마트스토어에 일부만 배정한 상품(설월 50개 등)을 덮어쓰지 않기 위해서.
 *
 * 매핑: kv_store `smartstore_sku_map:harriot` · 처리 상태: `smartstore_stock_sync:harriot`
 * 네이버 커머스 API 가 IP 화이트리스트라 이 아이맥에서만 돈다 ([[naver-commerce-api-ip-whitelist]]).
 *
 * 실행: node ssStockSync.js          (드라이런 — 무엇을 바꿀지만 출력)
 *       node ssStockSync.js --go     (실제 반영 + 상태 저장)
 */
const fs = require("fs"), path = require("path");
const DASH = "/Users/mac/sungjo_ai/paulwise-dashboard";
function loadEnv(p) { try { for (const l of fs.readFileSync(p, "utf8").split("\n")) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (!m) continue; const v = m[2].trim().replace(/^["']|["']$/g, ""); if (!(m[1] in process.env)) process.env[m[1]] = v; } } catch {} }
loadEnv(path.join(DASH, ".env.local")); loadEnv(path.join(DASH, ".env.supabase")); loadEnv(path.join(__dirname, ".env"));

const { api: nc } = require("./smartstoreCs.js");
const { createClient } = require(path.join(DASH, "node_modules/@supabase/supabase-js"));
const sb = createClient(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const CAFE24 = "/Users/mac/sungjo_ai/harriotwatches_website/tools/cafe24/client.mjs";

const GO = process.argv.includes("--go");
const MAP_KEY = "smartstore_sku_map:harriot", STATE_KEY = "smartstore_stock_sync:harriot";
const SOLD = new Set(["PAYED", "DELIVERING", "DELIVERED", "PURCHASE_DECIDED", "EXCHANGED"]);
const REVERSE = new Set(["CANCELED", "RETURNED"]);
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const kst = (d) => new Date(d.getTime() + 9 * 3600e3).toISOString().replace("Z", "+09:00");

async function kvGet(k) { const { data } = await sb.from("kv_store").select("data").eq("key", k).maybeSingle(); return data?.data ?? null; }
async function kvSet(k, v) { const { error } = await sb.from("kv_store").upsert({ key: k, data: v, updated_at: new Date().toISOString() }, { onConflict: "key" }); if (error) throw new Error("상태 저장 실패: " + error.message); }

/** lastChangedFrom 만 주면 일부 기간만 돌아온다(실측) → 24시간 창으로 잘라 끝까지 훑는다. */
async function changedProductOrderIds(fromIso) {
  const ids = new Set(); let from = new Date(fromIso); const now = new Date();
  while (from < now) {
    const to = new Date(Math.min(from.getTime() + 24 * 3600e3 - 1000, now.getTime()));
    const j = await nc("GET", `/v1/pay-order/seller/product-orders/last-changed-statuses?lastChangedFrom=${encodeURIComponent(kst(from))}&lastChangedTo=${encodeURIComponent(kst(to))}`);
    for (const x of j?.data?.lastChangeStatuses || []) ids.add(x.productOrderId);
    if (j?.data?.more) log(`⚠️ ${kst(from)} 창에 결과가 더 있음(more) — 다음 실행에서 이어서 확인 필요`);
    from = new Date(to.getTime() + 1000);
  }
  return [...ids];
}

(async () => {
  const { api: c24 } = await import(CAFE24);
  const map = await kvGet(MAP_KEY);
  if (!map?.items?.length) throw new Error("매핑 없음: " + MAP_KEY);
  const state = (await kvGet(STATE_KEY)) || { lastRun: kst(new Date(Date.now() - 2 * 864e5)), processed: {} };
  const runStartedAt = new Date();

  // 카페24 variant 코드 캐시 + 재고 읽기/쓰기
  // 카페24 옵션(variant) — 매핑에 cafe24VariantCode 가 있으면 그 옵션만, 없으면 단일 옵션일 때만 읽고 쓴다.
  // (2026-09-10 12mm 메쉬 밴드: 3색 각 99개인데 첫 옵션만 읽어 스마트스토어 297→99 로 깎을 뻔했다)
  const variantsCache = {};
  async function variantsOf(no) {
    if (!variantsCache[no]) variantsCache[no] = (await c24("GET", `/api/v2/admin/products/${no}/variants`)).variants || [];
    return variantsCache[no];
  }
  async function resolveVariant(it) {
    const vs = await variantsOf(it.cafe24ProductNo);
    if (it.cafe24VariantCode) return it.cafe24VariantCode;
    if (vs.length === 1) return vs[0].variant_code;
    return null; // 옵션이 여럿인데 어느 옵션인지 모름
  }
  // 이번 실행에서 우리가 정한 재고. 카페24 는 PUT 직후 GET 이 몇 초간 옛 값을 돌려줘서,
  // 같은 상품 주문이 한 회차에 여러 건이면 매번 옛 재고에서 빼 덜 차감됐다
  // (2026-09-30: 설월 4건이 전부 168 → 167). 한 번 정한 값은 다시 읽지 않고 이걸 쓴다.
  const decided = {};
  async function cafeStock(it) {
    const code = await resolveVariant(it);
    if (code && decided[`${it.cafe24ProductNo}:${code}`] !== undefined) return decided[`${it.cafe24ProductNo}:${code}`];
    if (code) return Number((await c24("GET", `/api/v2/admin/products/${it.cafe24ProductNo}/variants/${code}/inventories`)).inventory.quantity);
    // 옵션 구분이 없으면 합계로 비교만 한다(차감은 하지 않음)
    return (await variantsOf(it.cafe24ProductNo)).reduce((s, v) => s + Number(v.quantity || 0), 0);
  }
  async function setCafeStock(it, q) {
    const code = await resolveVariant(it);
    if (!code) throw new Error(`카페24 ${it.cafe24ProductNo}: 옵션이 여러 개라 어느 옵션을 바꿀지 모름 — 매핑에 cafe24VariantCode 필요`);
    await c24("PUT", `/api/v2/admin/products/${it.cafe24ProductNo}/variants/${code}/inventories`, { request: { quantity: q } });
  }

  // 기원 같은 옵션상품: 조합 id → 색상명
  const optionName = {};
  for (const it of map.items.filter((i) => i.optionCombinationId)) {
    if (optionName[it.originProductNo]) continue;
    const combos = (await nc("GET", `/v2/products/origin-products/${it.originProductNo}`)).originProduct.detailAttribute.optionInfo.optionCombinations;
    optionName[it.originProductNo] = Object.fromEntries(combos.map((c) => [c.id, c.optionName1]));
  }
  function mapItem(po) {
    const cands = map.items.filter((i) => i.originProductNo === Number(po.originalProductId));
    if (cands.length <= 1) return cands[0] || null;
    const color = ((po.productOption || "").match(/색상:\s*([^/]+)/) || [])[1]?.trim();
    return cands.find((i) => optionName[i.originProductNo]?.[i.optionCombinationId] === color) || null;
  }

  // ① 주문 → 카페24 차감/복구
  const ids = await changedProductOrderIds(state.lastRun);
  log(`변경된 스마트스토어 상품주문 ${ids.length}건 (since ${state.lastRun})`);
  const changes = [];
  for (let i = 0; i < ids.length; i += 300) {
    const det = await nc("POST", "/v1/pay-order/seller/product-orders/query", { productOrderIds: ids.slice(i, i + 300) });
    for (const o of det.data || []) {
      const po = o.productOrder || {}; const id = po.productOrderId; const st = po.productOrderStatus;
      const it = mapItem(po);
      if (!it) { if (SOLD.has(st) && !map.excludedSmartstoreOnly?.includes(Number(po.originalProductId))) log(`  ⚠️ 매핑 없음: ${po.productName} (${po.originalProductId})`); continue; }
      const done = state.processed[id];
      if (SOLD.has(st) && !done) changes.push({ kind: "차감", id, it, qty: Number(po.quantity || 0), name: po.productName, opt: po.productOption });
      else if (REVERSE.has(st) && done) changes.push({ kind: "복구", id, it, qty: done.qty, name: po.productName, opt: po.productOption });
    }
  }
  for (const ch of changes) {
    if (!(await resolveVariant(ch.it))) { log(`  ⚠️ [건너뜀] ${ch.name} — 카페24 옵션 구분 불가(매핑 보완 필요)`); continue; }
    const cur = await cafeStock(ch.it);
    const next = ch.kind === "차감" ? Math.max(0, cur - ch.qty) : cur + ch.qty;
    log(`  [${ch.kind}] ${ch.name}${ch.it.note ? " · " + ch.it.note : ""} ×${ch.qty} → 카페24 ${ch.it.cafe24ProductNo}: ${cur} → ${next}`);
    if (GO) await setCafeStock(ch.it, next);
    decided[`${ch.it.cafe24ProductNo}:${await resolveVariant(ch.it)}`] = next; // 드라이런도 누적 결과를 보여준다
    if (GO) {
      if (ch.kind === "차감") state.processed[ch.id] = { cafe24ProductNo: ch.it.cafe24ProductNo, qty: ch.qty, at: kst(new Date()) };
      else delete state.processed[ch.id];
    }
  }

  // ② 스마트스토어 재고가 카페24보다 많으면 낮춘다
  const byOrigin = {};
  for (const it of map.items) (byOrigin[it.originProductNo] ||= []).push(it);
  const caps = [];
  for (const [origin, items] of Object.entries(byOrigin)) {
    const op = (await nc("GET", `/v2/products/origin-products/${origin}`)).originProduct;
    if (items.some((i) => i.optionCombinationId)) {
      const oi = op.detailAttribute.optionInfo; let dirty = false;
      const combos = oi.optionCombinations.map((c) => ({ id: c.id, optionName1: c.optionName1, stockQuantity: c.stockQuantity, price: c.price, usable: c.usable }));
      for (const it of items) {
        const combo = combos.find((c) => c.id === it.optionCombinationId); if (!combo) continue;
        const cafe = await cafeStock(it);
        if (combo.stockQuantity > cafe) { caps.push(`${op.name} · ${combo.optionName1}: ${combo.stockQuantity} → ${cafe}`); combo.stockQuantity = cafe; dirty = true; }
      }
      if (dirty && GO) await nc("PUT", `/v1/products/origin-products/${origin}/option-stock`, {
        productSalePrice: { salePrice: op.salePrice },
        optionInfo: { optionCombinationSortType: oi.optionCombinationSortType, optionCombinationGroupNames: oi.optionCombinationGroupNames, optionCombinations: combos, useStockManagement: true },
      });
    } else {
      const cafe = await cafeStock(items[0]);
      if (op.stockQuantity > cafe) {
        caps.push(`${op.name}: ${op.stockQuantity} → ${cafe}`);
        // ⚠️ 단일상품에 option-stock(optionInfo:{}) 을 쓰면 200 을 돌려주고도 재고가 안 바뀐다(2026-09-10 실측: 8→8).
        //    원상품 전체를 받아 stockQuantity 만 바꿔 PUT 해야 실제로 반영된다.
        if (GO) {
          const full = await nc("GET", `/v2/products/origin-products/${origin}`);
          full.originProduct.stockQuantity = cafe;
          await nc("PUT", `/v2/products/origin-products/${origin}`, full);
          const after = (await nc("GET", `/v2/products/origin-products/${origin}`)).originProduct.stockQuantity;
          if (after !== cafe) throw new Error(`${op.name}: 스마트스토어 재고 반영 실패 (요청 ${cafe}, 실제 ${after})`);
        }
      }
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  caps.forEach((c) => log(`  [상한] ${c}`));
  log(`요약: 카페24 반영 ${changes.length}건 · 스마트스토어 재고 낮춤 ${caps.length}건${GO ? "" : " — 드라이런(--go 로 실제 반영)"}`);

  if (GO) {
    state.lastRun = kst(new Date(runStartedAt.getTime() - 10 * 60e3)); // 경계 누락 방지로 10분 겹쳐 읽는다
    await kvSet(STATE_KEY, state);
    if (changes.length || caps.length) {
      try { await require("./notifyFail").sendTelegram(`해리엇 재고 동기화\n카페24 반영 ${changes.length}건 · 스마트스토어 낮춤 ${caps.length}건\n` + [...changes.map((c) => `${c.kind} ${c.name} ×${c.qty}`), ...caps].slice(0, 15).join("\n")); } catch {}
    }
  }
})().catch(async (e) => {
  console.error("실패:", e.message);
  try { await require("./notifyFail").notifyFail("해리엇 재고 동기화 실패", e.message); } catch {}
  process.exit(1);
});
