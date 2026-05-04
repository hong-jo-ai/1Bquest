/**
 * /api/profit/name-aliases
 *   GET  → 상품명 → SKU 별칭 매핑 전체
 *   PUT body { [name]: sku }  → patch 업데이트. sku 가 빈 문자열이면 해당 name 제거.
 */
import {
  getProductNameAliases,
  updateProductNameAliases,
  type ProductNameAliasMap,
} from "@/lib/profitSettings";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const aliases = await getProductNameAliases();
    return Response.json({ ok: true, aliases });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function PUT(req: Request) {
  try {
    const patch = (await req.json()) as ProductNameAliasMap;
    const aliases = await updateProductNameAliases(patch);
    return Response.json({ ok: true, aliases });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
