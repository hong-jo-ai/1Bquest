import { deleteDoc, updateDoc, type PashoDoc } from "@/lib/pasho/docs";

export const dynamic = "force-dynamic";

/** PATCH /api/pasho/docs/:id — 귀속 발주·종류·금액·지급여부 정정 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: Partial<PashoDoc>;
  try { body = await req.json(); } catch { return Response.json({ ok: false, error: "본문 파싱 실패" }, { status: 400 }); }
  const allowed: (keyof PashoDoc)[] = [
    "orderNo", "kind", "title", "docDate", "currency",
    "supplyAmount", "vat", "totalAmount", "note", "paid",
  ];
  const patch: Partial<PashoDoc> = {};
  for (const k of allowed) if (k in body) (patch as Record<string, unknown>)[k] = body[k];
  if (!Object.keys(patch).length) return Response.json({ ok: false, error: "변경할 항목이 없습니다" }, { status: 400 });
  const doc = await updateDoc(id, patch);
  if (!doc) return Response.json({ ok: false, error: "증빙 없음" }, { status: 404 });
  return Response.json({ ok: true, doc });
}

/** DELETE /api/pasho/docs/:id — 원본 파일까지 삭제 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ok = await deleteDoc(id);
  return Response.json({ ok }, { status: ok ? 200 : 404 });
}
