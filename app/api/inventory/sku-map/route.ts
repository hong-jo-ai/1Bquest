/**
 * 재고 매핑 사전 — 채널 판매상품을 재고 SKU(카페24 product_code)로 변환하기 위한 사전.
 * 클라이언트(InventoryManager)가 채널 topProducts 의 sku/name 을 재고 SKU로 remap 할 때 사용.
 *   skuMaps: { <채널>: { 채널코드: 카페24코드 } }   (channel_pricing:skumap:*)
 *   nameMap: { 정규화상품명: 카페24코드 }            (카페24 상품명 사전 — 브랜드 몰별)
 *
 * ?brand=paulvice|harriot — nameMap 은 해당 몰의 카페24 상품으로 빌드(해리엇=식스샵 상품 매칭).
 * skuMaps(채널코드 사전)는 채널 단위라 브랜드 무관 — 그대로 내려보낸다(이름매칭이 우선).
 */
import { type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAccessTokenFromStore } from "@/lib/cafe24TokenStore";
import { type MallId } from "@/lib/cafe24Client";
import { buildCafe24NameMap, loadSkuAlias } from "@/lib/inventorySync";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const mall: MallId = req.nextUrl.searchParams.get("brand") === "harriot" ? "harriot" : "paulvice";
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return Response.json({ ok: false, error: "Supabase 미설정" }, { status: 500 });
  const db = createClient(url, key);

  const skuMaps: Record<string, Record<string, string>> = {};
  const { data } = await db.from("kv_store").select("key, data").like("key", "channel_pricing:skumap:%");
  for (const r of (data ?? []) as Array<{ key: string; data: unknown }>) {
    const ch = r.key.replace("channel_pricing:skumap:", "");
    if (r.data && typeof r.data === "object") skuMaps[ch] = r.data as Record<string, string>;
  }

  // 엄브렐러 옵션맵 (channel_pricing:optmap:<채널>: 채널코드 → { 옵션값: 카페24코드 })
  const optMaps: Record<string, Record<string, Record<string, string>>> = {};
  const { data: omap } = await db.from("kv_store").select("key, data").like("key", "channel_pricing:optmap:%");
  for (const r of (omap ?? []) as Array<{ key: string; data: unknown }>) {
    const ch = r.key.replace("channel_pricing:optmap:", "");
    if (r.data && typeof r.data === "object") optMaps[ch] = r.data as Record<string, Record<string, string>>;
  }

  let nameMap: Record<string, string> = {};
  try {
    const token = await getAccessTokenFromStore(mall);
    if (token) nameMap = Object.fromEntries(await buildCafe24NameMap(token, mall));
  } catch { /* 토큰/카페24 실패 시 사전 매핑만으로 동작 */ }

  // 중복/임시 상품코드 → 정식 SKU 별칭 (예: 인플루언서 임시 P00000IZ → P00000HO)
  const alias = await loadSkuAlias(mall);

  return Response.json({ ok: true, mall, skuMaps, optMaps, nameMap, alias });
}
