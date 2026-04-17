import { getCampaign, bulkImportOrders } from "@/lib/groupBuying/store";
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
    if (!campaign.product_sku) return Response.json({ error: "상품 SKU 미설정" }, { status: 400 });
    if (!campaign.start_date || !campaign.end_date) return Response.json({ error: "공구 기간 미설정" }, { status: 400 });

    const token = await getAccessTokenFromStore();
    if (!token) return Response.json({ error: "Cafe24 토큰 없음" }, { status: 401 });

    // Cafe24 주문 조회
    const orders = await fetchAllOrders(token, campaign.start_date, campaign.end_date);

    // SKU 매칭 필터
    const matched = orders.filter((o: any) =>
      (o.items ?? []).some((item: any) => item.product_code === campaign.product_sku)
    );

    // gb_orders 형식으로 변환
    const gbOrders = matched.map((o: any) => {
      const matchingItem = (o.items ?? []).find((item: any) => item.product_code === campaign.product_sku);
      const qty = matchingItem?.quantity ?? 1;
      const unitPrice = campaign.discount_price ?? Math.round(parseFloat(matchingItem?.order_price ?? "0"));
      return {
        campaign_id: id,
        cafe24_order_id: o.order_id ?? o.order_no,
        customer_name: null as string | null,
        customer_phone: null as string | null,
        customer_address: null as string | null,
        product_name: matchingItem?.product_name ?? campaign.product_name,
        variant_name: matchingItem?.option_value ?? null,
        quantity: qty,
        unit_price: unitPrice,
        total_amount: unitPrice * qty,
        shipping_status: "pending" as const,
        tracking_number: null as string | null,
        tracking_carrier: null as string | null,
        shipped_at: null as string | null,
        delivered_at: null as string | null,
        is_returned: false,
        return_reason: null as string | null,
      };
    });

    const result = await bulkImportOrders(gbOrders);
    return Response.json({ ok: true, total_cafe24: matched.length, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
