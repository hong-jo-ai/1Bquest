/**
 * 재고 매핑 사전 — 채널 판매상품을 재고 SKU(카페24 product_code)로 변환하기 위한 사전.
 * 클라이언트(InventoryManager)가 채널 topProducts 의 sku/name 을 재고 SKU로 remap 할 때 사용.
 *   skuMaps: { <채널>: { 채널코드: 카페24코드 } }   (channel_pricing:skumap:*)
 *   nameMap: { 정규화상품명: 카페24코드 }            (카페24 상품명 사전)
 */
import { createClient } from "@supabase/supabase-js";
import { getAccessTokenFromStore } from "@/lib/cafe24TokenStore";
import { buildCafe24NameMap } from "@/lib/inventorySync";

export const dynamic = "force-dynamic";

export async function GET() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return Response.json({ ok: false, error: "Supabase 미설정" }, { status: 500 });
  const db = createClient(url, key);

  const skuMaps: Record<string, Record<string, string>> = {};
  const { data } = await db.from("kv_store").select("key, data").like("key", "channel_pricing:skumap:%");
  for (const r of (data ?? []) as Array<{ key: string; data: unknown }>) {
    const ch = r.key.replace("channel_pricing:skumap:", "");
    if (r.data && typeof r.data === "object") skuMaps[ch] = r.data as Record<string, string>;
  }

  let nameMap: Record<string, string> = {};
  try {
    const token = await getAccessTokenFromStore();
    if (token) nameMap = Object.fromEntries(await buildCafe24NameMap(token));
  } catch { /* 토큰/카페24 실패 시 사전 매핑만으로 동작 */ }

  return Response.json({ ok: true, skuMaps, nameMap });
}
