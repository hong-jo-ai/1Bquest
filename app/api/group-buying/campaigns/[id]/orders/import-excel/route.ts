import { getCampaign, bulkImportOrders } from "@/lib/groupBuying/store";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * 발주서 엑셀/CSV 업로드.
 * body: { orders: Array<{ customer_name, customer_phone?, customer_address?, variant_name?, quantity, unit_price? }> }
 *
 * 프론트에서 파싱 후 JSON 배열로 전송.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const campaign = await getCampaign(id);
    if (!campaign) return Response.json({ error: "캠페인 없음" }, { status: 404 });

    const { orders: rows } = await req.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      return Response.json({ error: "주문 데이터가 비어 있습니다" }, { status: 400 });
    }

    const unitPrice = campaign.discount_price ?? campaign.original_price ?? 0;

    const gbOrders = rows.map((r: any) => {
      const qty = Number(r.quantity) || 1;
      const price = Number(r.unit_price) || unitPrice;
      return {
        campaign_id: id,
        cafe24_order_id: null as string | null,
        customer_name: r.customer_name ?? null,
        customer_phone: r.customer_phone ?? null,
        customer_address: r.customer_address ?? null,
        product_name: campaign.product_name,
        variant_name: r.variant_name ?? null,
        quantity: qty,
        unit_price: price,
        total_amount: price * qty,
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
    return Response.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
