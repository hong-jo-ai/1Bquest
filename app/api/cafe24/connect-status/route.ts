/**
 * 카페24 몰 연결 상태 점검.
 *   GET /api/cafe24/connect-status?mall=paulvice|harriot
 * 토큰을 받아 가벼운 read 호출(store/products)로 연결·스코프를 확인한다.
 */
import { type NextRequest } from "next/server";
import { getValidC24Token } from "@/lib/cafe24Auth";
import { cafe24Get, type MallId } from "@/lib/cafe24Client";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const mall: MallId = req.nextUrl.searchParams.get("mall") === "harriot" ? "harriot" : "paulvice";
  const connectUrl = `/api/auth/login?mall=${mall}`;
  try {
    const token = await getValidC24Token(mall);
    if (!token) {
      return Response.json({ mall, connected: false, reason: "no_token", connectUrl });
    }
    const store = (await cafe24Get("/api/v2/admin/store", token, mall).catch(() => null)) as
      | { store?: { shop_no?: number; shop_name?: string; base_domain?: string; primary_domain?: string } }
      | null;
    const products = (await cafe24Get("/api/v2/admin/products?limit=1", token, mall).catch(() => null)) as
      | { products?: unknown[] }
      | null;
    return Response.json({
      mall,
      connected: true,
      shopName: store?.store?.shop_name ?? null,
      domain: store?.store?.primary_domain ?? store?.store?.base_domain ?? null,
      productReadOk: Array.isArray(products?.products),
    });
  } catch (e) {
    return Response.json({
      mall,
      connected: false,
      error: e instanceof Error ? e.message : String(e),
      connectUrl,
    });
  }
}
