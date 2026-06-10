import { getSmsSend } from "@/lib/sms/store";

export const dynamic = "force-dynamic";

/** 단건 발송 이력 상세 — 건별 수신자(이름/전화번호/상태/실제 발송본문). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const detail = await getSmsSend(id);
    if (!detail) return Response.json({ ok: false, error: "이력을 찾을 수 없습니다" }, { status: 404 });
    return Response.json({ ok: true, detail });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
