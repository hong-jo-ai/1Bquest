import {
  getProductCogs,
  updateProductCogs,
  type ProductCogsMap,
} from "@/lib/profitSettings";

export const dynamic = "force-dynamic";

function brandOf(req: Request): string {
  return new URL(req.url).searchParams.get("brand") === "harriot" ? "harriot" : "paulvice";
}

export async function GET(req: Request) {
  try {
    const cogs = await getProductCogs(brandOf(req));
    return Response.json({ ok: true, cogs });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}

/**
 * Body: { sku: cost } 형태의 패치. ?brand=harriot 으로 몰 구분.
 * cost가 0이거나 null이면 해당 SKU 제거.
 */
export async function PUT(req: Request) {
  try {
    const patch = (await req.json()) as ProductCogsMap;
    const cogs = await updateProductCogs(patch, brandOf(req));
    return Response.json({ ok: true, cogs });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
