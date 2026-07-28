/**
 * 발송 보류 주문 — 품절·예약판매로 "주문은 받았지만 지금 보낼 수 없는" 건.
 *
 * 왜 필요한가: 채널(카페24·W컨셉·무신사…)에는 계속 출고대기로 남아 있어서, 송장을 취소해도
 * 다음 12:30 크론이 그대로 재접수해버린다. (실제로 에끌라 골드 예약판매분이 7/27 취소 →
 * 7/28 재접수됨. alreadyRegisteredKeys 는 status='submitted' 만 보므로 취소분을 못 막는다.)
 * 그래서 "이 주문은 언제까지 보류"를 따로 적어두고 집계 단계에서 제외한다.
 *
 * 저장: kv_store 'pp_hold_orders'
 *   { items: [{ seller, order, name, prod, reason, until, addedAt }], updatedAt }
 *   until = 'YYYY-MM-DD' (KST). 이 날짜가 지나면 자동 해제 — 재입고일을 넣어두면 알아서 풀린다.
 *   until 이 없으면 수동 해제 전까지 무기한 보류.
 *
 * 주의: registerSingle(단건 수동접수)은 이 필터를 타지 않는다 — 보류 중이어도 사장님이
 * 직접 한 건 보내야 할 때가 있어서 escape hatch 로 남겨둔다.
 */
const path = require("path");

const KEY = "pp_hold_orders";
const DASH = path.resolve(__dirname, "..", "..");

function sb() {
  const { createClient } = require(path.join(DASH, "node_modules/@supabase/supabase-js"));
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function todayKST() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }); // YYYY-MM-DD
}

/** seller|order — collectOutboundRows / alreadyRegisteredKeys 와 동일한 매칭 키. */
const holdKey = (seller, order) => `${seller}|${order}`;

/** 만료되지 않은 보류만. (until < 오늘 이면 자동 해제) */
function activeItems(items) {
  const today = todayKST();
  return (items || []).filter((it) => !it.until || String(it.until) >= today);
}

async function readRaw() {
  const { data } = await sb().from("kv_store").select("data").eq("key", KEY).maybeSingle();
  const d = (data && data.data) || {};
  return Array.isArray(d.items) ? d.items : [];
}

async function writeRaw(items) {
  const now = new Date().toISOString();
  const { error } = await sb()
    .from("kv_store")
    .upsert({ key: KEY, data: { items, updatedAt: now }, updated_at: now }, { onConflict: "key" });
  if (error) throw new Error(`보류목록 저장 실패: ${error.message}`);
  return items;
}

/** 현재 유효한 보류 목록. */
async function listHolds() {
  return activeItems(await readRaw());
}

/**
 * 집계에서 제외할 키 집합. 조회 실패 시 빈 Set — 보류를 못 읽었다고 발송을 막지는 않는다
 * (fail-open). 반대로 하면 kv 장애 때 전 채널 출고가 멈춘다.
 */
async function holdKeys() {
  try {
    return new Set((await listHolds()).map((it) => holdKey(it.seller, it.order)));
  } catch (e) {
    console.log(`[holdOrders] 보류목록 조회 실패 — 보류 필터 생략: ${e.message}`);
    return new Set();
  }
}

/** 보류 추가(같은 seller|order 는 덮어씀). items: [{seller,order,name?,prod?,reason?,until?}] */
async function addHolds(items) {
  const cur = await readRaw();
  const byKey = new Map(cur.map((it) => [holdKey(it.seller, it.order), it]));
  const now = new Date().toISOString();
  for (const it of items) {
    if (!it || !it.seller || !it.order) continue;
    byKey.set(holdKey(it.seller, it.order), { ...it, addedAt: it.addedAt || now });
  }
  const next = [...byKey.values()];
  await writeRaw(next);
  return activeItems(next);
}

/** 보류 해제. keys: ['W컨셉|Z12718895', ...] 또는 [{seller,order}] */
async function removeHolds(keys) {
  const drop = new Set(
    (keys || []).map((k) => (typeof k === "string" ? k : holdKey(k.seller, k.order))),
  );
  const next = (await readRaw()).filter((it) => !drop.has(holdKey(it.seller, it.order)));
  await writeRaw(next);
  return activeItems(next);
}

module.exports = { holdKeys, listHolds, addHolds, removeHolds, holdKey, todayKST, KEY };
