/**
 * 품절 임박 텔레그램 알림 cron — "팔리는데 품절"만 부각.
 *
 * 개선(2026-06-29): 매일 같은 전체 목록을 반복 발송하던 것 → 알림 피로로 안 보게 됨.
 *  - 최근 판매(90일)로 거른다: 판매 0 = 단종/발주중단 의도로 보고 본문에서 제외(건수만 표기).
 *  - 상품명 정규화로 중복 등록 묶음(따로 표기).
 *  - 변동분만 발송: 직전 발송한 "발주 필요 SKU 집합"과 같으면 스킵(월요일엔 전체 점검 1회).
 *
 * GET  + Authorization: Bearer ${CRON_SECRET}  (cron) / POST ?manual=1 (수동)
 */
import { getValidC24Token } from "@/lib/cafe24Auth";
import { getAccessTokenFromStore } from "@/lib/cafe24TokenStore";
import { computeInventoryLevels, fetchSalesBySku, normProductName } from "@/lib/inventorySync";
import { cafe24Get } from "@/lib/cafe24Client";
import { listPurchaseOrders, restockEta } from "@/lib/purchaseOrders";
import { sendTelegramMessage } from "@/lib/cs/telegram";
import { createClient } from "@supabase/supabase-js";
import { withCron } from "@/lib/cron/withCron";
import { notifyDuePromises } from "@/lib/cs/promiseNotify";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const LOW_STOCK_THRESHOLD = 5;
const SALES_WINDOW_DAYS = 90; // 이 기간 판매 0이면 단종 추정 → 본문 제외
const STATE_KEY = "low_stock_alert:state";

const kstNow = () => new Date(Date.now() + 9 * 3600e3);
const ymd = (d: Date) => d.toISOString().slice(0, 10);

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

async function skuNameMap(token: string): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  let offset = 0;
  for (let page = 0; page < 30; page++) {
    const d = (await cafe24Get(
      `/api/v2/admin/products?fields=product_code,product_name&limit=100&offset=${offset}`,
      token,
    )) as { products?: Array<{ product_code?: string; product_name?: string }> };
    const ps = d.products ?? [];
    for (const p of ps) if (p.product_code) map[p.product_code] = p.product_name ?? p.product_code;
    if (ps.length < 100) break;
    offset += 100;
  }
  return map;
}

interface Item { sku: string; name: string; stock: number; sales: number; po?: { eta: string }; dup: number; }

async function run() {
  let token = await getValidC24Token();
  if (!token) token = await getAccessTokenFromStore();
  if (!token) return Response.json({ ok: false, error: "카페24 미연결" }, { status: 500 });

  const levels = await computeInventoryLevels(token);
  const lowRaw = levels.filter((l) => l.currentStock <= LOW_STOCK_THRESHOLD);
  if (lowRaw.length === 0) return Response.json({ ok: true, low: 0, message: "임박 상품 없음" });

  const start = ymd(new Date(kstNow().getTime() - SALES_WINDOW_DAYS * 86400e3));
  const [names, pos, recentSales] = await Promise.all([
    skuNameMap(token),
    listPurchaseOrders(),
    fetchSalesBySku(token, start),
  ]);
  const openBySku = new Map<string, { eta: string }>();
  for (const po of pos) {
    if (po.status === "ordered" && po.sku) {
      const e = restockEta(po);
      openBySku.set(po.sku, { eta: `${e.start}~${e.end}` });
    }
  }

  // 상품명 정규화로 묶기(중복 등록 흡수): 같은 이름의 SKU들을 한 줄로, 판매·재고 합산
  const byName = new Map<string, Item[]>();
  for (const l of lowRaw) {
    const it: Item = {
      sku: l.sku,
      name: names[l.sku] ?? l.sku,
      stock: l.currentStock,
      sales: recentSales[l.sku] ?? 0,
      po: openBySku.get(l.sku),
      dup: 0,
    };
    const k = normProductName(it.name);
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k)!.push(it);
  }
  const collapsed: Item[] = [];
  let dupCount = 0;
  for (const group of byName.values()) {
    if (group.length > 1) dupCount++;
    const rep = group.reduce((a, b) => (a.stock <= b.stock ? a : b)); // 가장 적은 재고를 대표로
    collapsed.push({
      ...rep,
      sales: group.reduce((s, x) => s + x.sales, 0),
      po: group.find((x) => x.po)?.po,
      dup: group.length,
    });
  }

  // 분류: 재입고예정 / 살아있음(최근판매>0·미발주) / 단종추정(판매0)
  const scheduled = collapsed.filter((e) => e.po);
  const live = collapsed.filter((e) => !e.po && e.sales > 0);
  const dead = collapsed.filter((e) => !e.po && e.sales === 0);
  const reorder = live.filter((e) => e.stock <= 0).sort((a, b) => b.sales - a.sales); // 🔴 팔리는데 품절
  const imminent = live.filter((e) => e.stock > 0).sort((a, b) => b.sales - a.sales);  // 🟡 팔리는데 임박

  // 변동분 발송: 발주 필요 SKU 집합이 직전과 같으면 스킵(월요일엔 전체 점검 1회)
  const db = getDb();
  let state: { sig?: string; lastFullDigest?: string } = {};
  if (db) {
    const { data } = await db.from("kv_store").select("data").eq("key", STATE_KEY).maybeSingle();
    state = ((data as { data?: typeof state } | null)?.data) ?? {};
  }
  const sig = [...reorder, ...imminent].map((e) => e.sku).sort().join(",");
  const today = ymd(kstNow());
  const weeklyDue = kstNow().getUTCDay() === 1 && state.lastFullDigest !== today; // 월요일 1회
  const nothingActionable = reorder.length === 0 && imminent.length === 0;

  if (sig === (state.sig ?? "") && !weeklyDue) {
    return Response.json({ ok: true, skipped: "변동 없음", actionable: reorder.length + imminent.length });
  }
  if (nothingActionable && !weeklyDue) {
    if (db) await db.from("kv_store").upsert({ key: STATE_KEY, data: { sig, lastFullDigest: state.lastFullDigest }, updated_at: new Date().toISOString() }, { onConflict: "key" });
    return Response.json({ ok: true, skipped: "발주 필요 품목 없음" });
  }

  const line = (e: Item) =>
    `· ${e.name}${e.dup > 1 ? ` <i>(중복 ${e.dup})</i>` : ""} — <b>${e.stock}개</b> · 최근 ${SALES_WINDOW_DAYS}일 ${e.sales}개 판매`;
  const footerBits: string[] = [];
  if (scheduled.length) footerBits.push(`🚚 재입고 예정 ${scheduled.length}건`);
  if (dead.length) footerBits.push(`💤 판매없는 품절(단종 추정) ${dead.length}건 제외`);
  if (dupCount) footerBits.push(`⚠️ 중복 등록 의심 ${dupCount}건(정리 권장)`);

  const msg = [
    `📦 <b>발주 필요 재고</b> ${weeklyDue ? "(주간 점검)" : "(변동분)"} — 최근 ${SALES_WINDOW_DAYS}일 판매된 것만`,
    ...(reorder.length ? [``, `<b>🔴 품절·발주 필요 (${reorder.length})</b>`, ...reorder.map(line)] : []),
    ...(imminent.length ? [``, `<b>🟡 임박 (${imminent.length})</b>`, ...imminent.map(line)] : []),
    ...(nothingActionable ? [``, `팔리는데 품절·임박인 품목은 없습니다.`] : []),
    ...(footerBits.length ? [``, `<i>${footerBits.join(" · ")}</i>`] : []),
  ].join("\n");

  await sendTelegramMessage(msg);
  if (db) await db.from("kv_store").upsert({ key: STATE_KEY, data: { sig, lastFullDigest: weeklyDue ? today : state.lastFullDigest }, updated_at: new Date().toISOString() }, { onConflict: "key" });
  return Response.json({ ok: true, reorder: reorder.length, imminent: imminent.length, dead: dead.length, dup: dupCount, weeklyDue });
}

export const GET = withCron("low-stock-alert", async () => {
  // 고객 약속 알림을 여기 얹었다 — vercel 크론이 상한(40)이라 새 슬롯을 못 쓴다.
  // run() 은 변동 없으면 조기 종료하므로 그 앞에서, 실패해도 재고 알림은 진행되게 분리한다.
  try {
    await notifyDuePromises();
  } catch (e) {
    console.warn("[low-stock-alert] 약속 알림 실패:", e instanceof Error ? e.message : String(e));
  }
  return run();
});

export async function POST() {
  try {
    return await run();
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
