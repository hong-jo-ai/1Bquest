/**
 * 입고 수량을 카페24 변형 재고 + 대시보드 재고에 가산.
 * 재고관리 '입고' 버튼(app/api/purchase-orders/[id])과 나비스트 자동입고(navist)가 공유 —
 * 동작 드리프트 방지를 위해 단일 함수로 관리.
 */
import { getValidC24Token } from "@/lib/cafe24Auth";
import { getAccessTokenFromStore } from "@/lib/cafe24TokenStore";
import { cafe24Get, cafe24Put } from "@/lib/cafe24Client";
import { createClient } from "@supabase/supabase-js";

const INVENTORY_KEY = "paulvice_inventory_v1";

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

/** sku(=cafe24 product_code)에 addQty 만큼 재고 가산. 카페24 변형 + 대시보드 재고 동시 반영. */
export async function applyReceivedStock(
  sku: string,
  addQty: number,
): Promise<{ ok: boolean; error?: string; newQty?: number }> {
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
