import {
  listUpcomingProducts,
  createUpcomingProduct,
  type UpsertInput,
} from "@/lib/upcomingProducts";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const products = await listUpcomingProducts();
    return Response.json({ ok: true, products });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let body: UpsertInput;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "본문 파싱 실패" }, { status: 400 });
  }
  if (!body.brand?.trim() || !body.name?.trim()) {
    return Response.json({ ok: false, error: "brand, name 필수" }, { status: 400 });
  }
  try {
    const product = await createUpcomingProduct(body);
    return Response.json({ ok: true, product });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
