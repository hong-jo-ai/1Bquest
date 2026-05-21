/**
 * 품절 임박 텔레그램 알림 cron.
 *
 * 매일 현재고를 계산해 임계치 이하 상품을 텔레그램으로 보고.
 * 이미 발주(ordered)된 상품은 "재입고 예정"으로 표시해 발주 필요한 것과 구분.
 *
 * GET  + Authorization: Bearer ${CRON_SECRET}  (cron)
 * POST ?manual=1                                (수동)
 */
import { getValidC24Token } from "@/lib/cafe24Auth";
import { getAccessTokenFromStore } from "@/lib/cafe24TokenStore";
import { computeInventoryLevels } from "@/lib/inventorySync";
import { cafe24Get } from "@/lib/cafe24Client";
import { listPurchaseOrders, restockEta } from "@/lib/purchaseOrders";
import { sendTelegramMessage } from "@/lib/cs/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LOW_STOCK_THRESHOLD = 5; // 이 수량 이하면 임박/품절

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

async function run() {
  let token = await getValidC24Token();
  if (!token) token = await getAccessTokenFromStore();
  if (!token) return Response.json({ ok: false, error: "카페24 미연결" }, { status: 500 });

  const levels = await computeInventoryLevels(token);
  const low = levels
    .filter((l) => l.currentStock <= LOW_STOCK_THRESHOLD)
    .sort((a, b) => a.currentStock - b.currentStock);

  if (low.length === 0) {
    return Response.json({ ok: true, low: 0, message: "임박 상품 없음" });
  }

  const [names, pos] = await Promise.all([skuNameMap(token), listPurchaseOrders()]);
  const openBySku = new Map<string, { eta: string }>();
  for (const po of pos) {
    if (po.status === "ordered" && po.sku) {
      const e = restockEta(po);
      openBySku.set(po.sku, { eta: `${e.start}~${e.end}` });
    }
  }

  const soldout = low.filter((l) => l.currentStock <= 0);
  const imminent = low.filter((l) => l.currentStock > 0);
  const line = (l: { sku: string; currentStock: number }) => {
    const name = names[l.sku] ?? l.sku;
    const po = openBySku.get(l.sku);
    const tail = po ? ` · <i>재입고 예정 ${po.eta}</i>` : " · ⚠ 미발주";
    return `· ${name} — <b>${l.currentStock}개</b>${tail}`;
  };

  const msg = [
    `📦 <b>품절 임박 재고 알림</b> (${LOW_STOCK_THRESHOLD}개 이하)`,
    ...(soldout.length ? [``, `<b>🔴 품절 (${soldout.length})</b>`, ...soldout.map(line)] : []),
    ...(imminent.length ? [``, `<b>🟡 임박 (${imminent.length})</b>`, ...imminent.map(line)] : []),
    ``,
    `<i>'미발주' 항목은 재고관리 → 발주·재입고에서 발주 등록하세요.</i>`,
  ].join("\n");

  await sendTelegramMessage(msg);
  return Response.json({ ok: true, low: low.length, soldout: soldout.length, imminent: imminent.length });
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
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
