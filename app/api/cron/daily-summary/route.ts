/**
 * 일일 마감 리포트 (23:59 KST) — 텔레그램 요약 메시지.
 *
 * 매출(카페24/공구) · 재고 주의 · 재입고 일정 · 미완료 할일 · CS 미답변 ·
 * 내일 참고를 한 메시지로. PDF 없음.
 *
 * GET + Authorization: Bearer ${CRON_SECRET} (cron) / POST ?manual=1 (수동)
 */
import { getValidC24Token } from "@/lib/cafe24Auth";
import { getAccessTokenFromStore } from "@/lib/cafe24TokenStore";
import { getDashboardData } from "@/lib/cafe24Data";
import { computeInventoryLevels } from "@/lib/inventorySync";
import { cafe24Get } from "@/lib/cafe24Client";
import { listPurchaseOrders, restockEta } from "@/lib/purchaseOrders";
import { countThreadsByStatus } from "@/lib/cs/store";
import { sendTelegramMessage } from "@/lib/cs/telegram";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LOW = 5;
const krw = (n: number) => n.toLocaleString("ko-KR") + "원";
const kstToday = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const daysFromToday = (d: string) =>
  Math.round((Date.parse(d + "T00:00:00Z") - Date.parse(kstToday() + "T00:00:00Z")) / 86400000);

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

interface StoredTask { title?: string; category?: string; done?: boolean; date?: string }

async function run() {
  const today = kstToday();
  let token = await getValidC24Token();
  if (!token) token = await getAccessTokenFromStore();

  const blocks: string[] = [`🌙 <b>일일 마감 리포트</b> (${today})`];
  const names: Record<string, string> = token ? await skuNameMap(token).catch(() => ({})) : {};

  // ── 매출 ──────────────────────────────────────────────
  try {
    if (token) {
      const d = await getDashboardData(token);
      const c = d.salesSummary.today;
      const g = d.groupBuyLive?.salesSummary.today ?? { revenue: 0, orders: 0, avgOrder: 0 };
      const total = c.revenue + g.revenue;
      blocks.push(
        [
          ``,
          `💰 <b>오늘 매출</b>`,
          `· 카페24: ${krw(c.revenue)} (${c.orders}건)`,
          ...(g.revenue > 0 ? [`· 공동구매: ${krw(g.revenue)} (${g.orders}건)`] : []),
          `· <b>합계: ${krw(total)}</b>`,
        ].join("\n"),
      );
    }
  } catch (e) {
    blocks.push(`\n💰 <b>오늘 매출</b>\n· 조회 실패 (${e instanceof Error ? e.message : "오류"})`);
  }

  // ── 재고 주의 ─────────────────────────────────────────
  try {
    if (token) {
      const levels = await computeInventoryLevels(token);
      const low = levels.filter((l) => l.currentStock <= LOW).sort((a, b) => a.currentStock - b.currentStock);
      const soldout = low.filter((l) => l.currentStock <= 0);
      const imminent = low.filter((l) => l.currentStock > 0);
      const nm = (sku: string) => names[sku] ?? sku;
      if (low.length > 0) {
        blocks.push(
          [
            ``,
            `📦 <b>재고 주의</b> (${low.length})`,
            ...(soldout.length ? [`· 🔴 품절: ${soldout.slice(0, 6).map((l) => nm(l.sku)).join(", ")}${soldout.length > 6 ? ` 외 ${soldout.length - 6}` : ""}`] : []),
            ...(imminent.length ? [`· 🟡 임박(≤${LOW}): ${imminent.slice(0, 8).map((l) => `${nm(l.sku)}(${l.currentStock})`).join(", ")}${imminent.length > 8 ? ` 외 ${imminent.length - 8}` : ""}`] : []),
          ].join("\n"),
        );
      }
    }
  } catch { /* 재고 실패 무시 */ }

  // ── 재입고 일정 ───────────────────────────────────────
  try {
    const pos = (await listPurchaseOrders()).filter((p) => p.status === "ordered");
    if (pos.length > 0) {
      const lines = pos.map((p) => {
        const e = restockEta(p);
        const overdue = daysFromToday(e.end) < 0;
        return `· ${p.productName} ${p.qty}개 — ${e.start}~${e.end}${overdue ? " ⚠지연" : ""}`;
      });
      blocks.push([``, `🚚 <b>입고 대기</b> (${pos.length})`, ...lines.slice(0, 8)].join("\n"));
    }
  } catch { /* PO 실패 무시 */ }

  // ── 미완료 할일 ───────────────────────────────────────
  try {
    const db = getDb();
    if (db) {
      const { data } = await db.from("kv_store").select("data").eq("key", "today_hub:tasks").maybeSingle();
      const tasks = (Array.isArray(data?.data) ? data!.data : []) as StoredTask[];
      const undone = tasks.filter((t) => !t.done && (t.date ?? "") <= today);
      if (undone.length > 0) {
        blocks.push(
          [
            ``,
            `✅ <b>미완료 할일</b> (${undone.length})`,
            ...undone.slice(0, 10).map((t) => `· ${t.title ?? ""}${t.category ? ` [${t.category}]` : ""}`),
          ].join("\n"),
        );
      }
    }
  } catch { /* 할일 실패 무시 */ }

  // ── CS 미답변 ─────────────────────────────────────────
  try {
    const counts = await countThreadsByStatus({ brand: "all" });
    if (counts.unanswered > 0) {
      blocks.push(`\n📨 <b>CS 미답변</b> ${counts.unanswered}건${counts.waiting ? ` (대기중 ${counts.waiting})` : ""}`);
    }
  } catch { /* CS 실패 무시 */ }

  // ── 내일 참고 ─────────────────────────────────────────
  try {
    const refs: string[] = [];
    const pos = (await listPurchaseOrders()).filter((p) => p.status === "ordered");
    for (const p of pos) {
      const e = restockEta(p);
      const dStart = daysFromToday(e.start);
      if (dStart >= 0 && dStart <= 3) refs.push(`· ${p.productName} 재입고 임박 (${e.start}~)`);
      if (daysFromToday(e.end) < 0) refs.push(`· ${p.productName} 재입고 지연 — 공급사 확인`);
    }
    if (token) {
      const levels = await computeInventoryLevels(token);
      const soldoutNoPo = levels.filter((l) => l.currentStock <= 0);
      const poSkus = new Set((await listPurchaseOrders()).filter((p) => p.status === "ordered").map((p) => p.sku));
      const needOrder = soldoutNoPo.filter((l) => !poSkus.has(l.sku));
      if (needOrder.length > 0) refs.push(`· 품절·미발주 ${needOrder.length}건 — 발주 검토`);
    }
    if (refs.length > 0) {
      blocks.push([``, `📌 <b>내일 참고</b>`, ...refs.slice(0, 6)].join("\n"));
    }
  } catch { /* 참고 실패 무시 */ }

  await sendTelegramMessage(blocks.join("\n"));
  return Response.json({ ok: true, sections: blocks.length });
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return await run();
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST() {
  try {
    return await run();
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
