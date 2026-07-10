import { updateOrderStatus, ORDER_STAGES } from "@/lib/pasho/store";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/pasho/orders/:no  body { status }
 * 파쇼 발주 진행 단계 변경. 신제품 로드맵의 파생 마일스톤도 이 status를 따라간다.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ no: string }> }) {
  const { no } = await params;
  let body: { status?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "본문 파싱 실패" }, { status: 400 });
  }
  const status = (body.status ?? "").trim();
  if (!ORDER_STAGES.includes(status as (typeof ORDER_STAGES)[number])) {
    return Response.json(
      { ok: false, error: `status는 다음 중 하나여야 합니다: ${ORDER_STAGES.join(", ")}` },
      { status: 400 },
    );
  }
  try {
    const updated = await updateOrderStatus(no, status);
    if (!updated) return Response.json({ ok: false, error: "발주 없음" }, { status: 404 });
    return Response.json({ ok: true, order: updated });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
