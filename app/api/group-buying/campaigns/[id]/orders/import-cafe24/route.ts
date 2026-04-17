import { getCampaign, listProducts, bulkImportOrders } from "@/lib/groupBuying/store";
import { fetchAllOrders } from "@/lib/cafe24Data";
import { getAccessTokenFromStore } from "@/lib/cafe24TokenStore";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const campaign = await getCampaign(id);
    if (!campaign) return Response.json({ error: "캠페인 없음" }, { status: 404 });
    if (!campaign.start_date || !campaign.end_date) return Response.json({ error: "공구 기간 미설정" }, { status: 400 });

    const products = await listProducts(id);
    const skuMap = new Map(products.filter((p) => p.product_sku).map((p) => [p.product_sku!, p]));
    if (skuMap.size === 0) return Response.json({ error: "SKU가 등록된 상품이 없습니다" }, { status: 400 });

    const token = await getAccessTokenFromStore();
    if (!token) return Response.json({ error: "Cafe24 토큰 없음" }, { status: 401 });

    const orders = await fetchAllOrders(token, campaign.start_date, campaign.end_date);

    // SKU 매칭: 캠페인 상품 SKU 중 하나라도 포함된 주문
    const gbOrders: any[] = [];
    for (const o of orders) {
      for (const item of o.items ?? []) {
        const product = skuMap.get(item.product_code);
        if (!product) continue;
        const qty = item.quantity ?? 1;
        const unitPrice = product.discount_price ?? Math.round(parseFloat(item.order_price ?? "0"));
        gbOrders.push({
          campaign_id: id,
          product_id: product.id,
          cafe24_order_id: `${o.order_id ?? o.order_no}:${item.product_code}`,
          customer_name: null,
          customer_phone: null,
          customer_address: null,
          product_name: item.product_name ?? product.product_name,
          variant_name: item.option_value ?? null,
          quantity: qty,
          unit_price: unitPrice,
          total_amount: unitPrice * qty,
          shipping_status: "pending",
          tracking_number: null,
          tracking_carrier: null,
          shipped_at: null,
          delivered_at: null,
          is_returned: false,
          return_reason: null,
        });
      }
    }

    const result = await bulkImportOrders(gbOrders);
    return Response.json({ ok: true, total_matched: gbOrders.length, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
