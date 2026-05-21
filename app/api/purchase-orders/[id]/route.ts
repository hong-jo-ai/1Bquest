import {
  listPurchaseOrders,
  updatePurchaseOrder,
  deletePurchaseOrder,
  type PurchaseOrder,
} from "@/lib/purchaseOrders";
import { getValidC24Token } from "@/lib/cafe24Auth";
import { getAccessTokenFromStore } from "@/lib/cafe24TokenStore";
import { cafe24Get, cafe24Put } from "@/lib/cafe24Client";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const INVENTORY_KEY = "paulvice_inventory_v1";

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

/** 입고 수량을 카페24 변형 재고 + 대시보드 재고에 가산. */
async function applyReceivedStock(sku: string, addQty: number): Promise<{ ok: boolean; error?: string; newQty?: number }> {
  if (!sku || addQty <= 0) return { ok: false, error: "sku/수량 없음" };
  let token = await getValidC24Token();
  if (!token) token = await getAccessTokenFromStore();
  if (!token) return { ok: false, error: "카페24 미연결" };
  try {
    // SKU → product_no
    let productNo: number | null = null;
    let offset = 0;
    for (let page = 0; page < 30 && productNo === null; page++) {
      const d = (await cafe24Get(
        `/api/v2/admin/products?fields=product_no,product_code&limit=100&offset=${offset}`,
        token,
      )) as { products?: Array<{ product_no: number; product_code: string }> };
      const ps = d.products ?? [];
      const hit = ps.find((p) => p.product_code === sku);
      if (hit) productNo = hit.product_no;
      if (ps.length < 100) break;
      offset += 100;
    }
    if (!productNo) return { ok: false, error: "카페24 상품 없음" };

    const vd = (await cafe24Get(`/api/v2/admin/products/${productNo}/variants`, token)) as {
      variants?: Array<{ variant_code: string; quantity?: number }>;
    };
    const variants = vd.variants ?? [];
    let newQty = 0;
    for (const v of variants) {
      newQty = (Number(v.quantity) || 0) + addQty;
      await cafe24Put(`/api/v2/admin/products/${productNo}/variants/${v.variant_code}`, token, {
        shop_no: 1,
        request: { quantity: newQty },
      });
    }

    // 대시보드 재고: manualAdjustment += addQty (currentStock 가산)
    const db = getDb();
    if (db) {
      const { data } = await db.from("kv_store").select("data").eq("key", INVENTORY_KEY).maybeSingle();
      const entries = (data?.data ?? {}) as Record<string, Record<string, unknown>>;
      const e = entries[sku] ?? { sku, initialStock: 0, manualAdjustment: 0, stockInDate: "" };
      e.manualAdjustment = (Number(e.manualAdjustment) || 0) + addQty;
      e.sku = sku;
      entries[sku] = e;
      await db
        .from("kv_store")
        .upsert({ key: INVENTORY_KEY, data: entries, updated_at: new Date().toISOString() }, { onConflict: "key" });
    }
    return { ok: true, newQty };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

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
