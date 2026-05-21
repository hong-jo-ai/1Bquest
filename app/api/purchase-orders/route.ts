import {
  listPurchaseOrders,
  createPurchaseOrder,
  type CreatePOInput,
} from "@/lib/purchaseOrders";
import { getValidC24Token } from "@/lib/cafe24Auth";
import { getAccessTokenFromStore } from "@/lib/cafe24TokenStore";
import { cafe24Get } from "@/lib/cafe24Client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** PO 의 SKU 들에 대해 카페24 현재 재고(변형 수량 합)를 best-effort 로 조회. */
async function fetchStockBySku(skus: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (skus.length === 0) return out;
  let token = await getValidC24Token();
  if (!token) token = await getAccessTokenFromStore();
  if (!token) return out;
  try {
    // SKU → product_no (페이징)
    const map = new Map<string, number>();
    let offset = 0;
    for (let page = 0; page < 30; page++) {
      const d = (await cafe24Get(
        `/api/v2/admin/products?fields=product_no,product_code&limit=100&offset=${offset}`,
        token,
      )) as { products?: Array<{ product_no: number; product_code: string }> };
      const ps = d.products ?? [];
      for (const p of ps) if (p.product_code) map.set(p.product_code, p.product_no);
      if (ps.length < 100) break;
      offset += 100;
    }
    for (const sku of skus) {
      const pno = map.get(sku);
      if (!pno) continue;
      const vd = (await cafe24Get(`/api/v2/admin/products/${pno}/variants`, token)) as {
        variants?: Array<{ quantity?: number }>;
      };
      out[sku] = (vd.variants ?? []).reduce((s, v) => s + (Number(v.quantity) || 0), 0);
    }
  } catch {
    // 토큰/레이트리밋 실패 시 재고 없이 PO 만 반환
  }
  return out;
}

export async function GET() {
  try {
    const orders = await listPurchaseOrders();
    const openSkus = [
      ...new Set(orders.filter((o) => o.status === "ordered" && o.sku).map((o) => o.sku)),
    ];
    const stockBySku = await fetchStockBySku(openSkus);
    return Response.json({ ok: true, orders, stockBySku });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let body: CreatePOInput;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "본문 파싱 실패" }, { status: 400 });
  }
  if (!body.productName?.trim() || !body.orderDate || !body.qty) {
    return Response.json({ error: "productName, orderDate, qty 필수" }, { status: 400 });
  }
  try {
    const po = await createPurchaseOrder(body);
    return Response.json({ ok: true, po });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
