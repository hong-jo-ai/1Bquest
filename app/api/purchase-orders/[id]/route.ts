import {
  listPurchaseOrders,
  updatePurchaseOrder,
  deletePurchaseOrder,
  type PurchaseOrder,
} from "@/lib/purchaseOrders";
import { applyReceivedStock } from "@/lib/inventory/receiveStock";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function kstToday(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: Record<string, unknown> & { action?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "본문 파싱 실패" }, { status: 400 });
  }

  try {
    if (body.action === "receive") {
      const orders = await listPurchaseOrders();
      const po = orders.find((o) => o.id === id);
      if (!po) return Response.json({ error: "발주 없음" }, { status: 404 });
      const receivedQty = Number(body.receivedQty) || po.qty;
      const applyStock = body.applyStock !== false; // 기본 true

      let stockResult: { ok: boolean; error?: string; newQty?: number } | null = null;
      if (applyStock && po.sku) {
        stockResult = await applyReceivedStock(po.sku, receivedQty);
      }
      const patch: Partial<PurchaseOrder> = {
        status: "received",
        receivedDate: kstToday(),
        receivedQty,
        stockApplied: !!stockResult?.ok,
      };
      const updated = await updatePurchaseOrder(id, patch);
      return Response.json({ ok: true, po: updated, stock: stockResult });
    }

    // 일반 수정
    const allowed: (keyof PurchaseOrder)[] = [
      "sku", "productName", "supplier", "orderDate", "qty", "unitPrice", "amount",
      "leadMinDays", "leadMaxDays", "status", "receivedDate", "receivedQty", "notes",
    ];
    const patch: Record<string, unknown> = {};
    for (const k of allowed) if (k in body) patch[k] = body[k];
    const updated = await updatePurchaseOrder(id, patch as Partial<PurchaseOrder>);
    if (!updated) return Response.json({ error: "발주 없음" }, { status: 404 });
    return Response.json({ ok: true, po: updated });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const ok = await deletePurchaseOrder(id);
    return Response.json({ ok });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
