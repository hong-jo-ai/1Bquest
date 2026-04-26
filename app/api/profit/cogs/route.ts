import {
  getProductCogs,
  updateProductCogs,
  type ProductCogsMap,
} from "@/lib/profitSettings";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const cogs = await getProductCogs();
    return Response.json({ ok: true, cogs });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}

/**
 * Body: { sku: cost } 형태의 패치.
 * cost가 0이거나 null이면 해당 SKU 제거.
 */
export async function PUT(req: Request) {
  try {
    const patch = (await req.json()) as ProductCogsMap;
    const cogs = await updateProductCogs(patch);
    return Response.json({ ok: true, cogs });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
