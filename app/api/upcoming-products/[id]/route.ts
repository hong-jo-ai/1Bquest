import {
  updateUpcomingProduct,
  deleteUpcomingProduct,
  type UpcomingProduct,
} from "@/lib/upcomingProducts";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "본문 파싱 실패" }, { status: 400 });
  }
  try {
    const allowed: (keyof UpcomingProduct)[] = ["brand", "name", "category", "milestones", "status", "notes"];
    const patch: Record<string, unknown> = {};
    for (const k of allowed) if (k in body) patch[k] = body[k];
    const updated = await updateUpcomingProduct(id, patch as Partial<UpcomingProduct>);
    if (!updated) return Response.json({ ok: false, error: "신제품 없음" }, { status: 404 });
    return Response.json({ ok: true, product: updated });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const ok = await deleteUpcomingProduct(id);
    return Response.json({ ok });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
