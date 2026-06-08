/**
 * 범용 단발 우체국 접수 — 임의 앱/수동에서 "확인 한 번"으로 택배 접수.
 * POST { order, name, addr(또는 addr1/addr2), zip, mobile|tel, prod, qty?, color?, msg?, source?, reqType? }
 *   → { success, regiNo, regipoNm, price, test }
 * 접수는 로컬 에이전트(계약 IP) 경유.
 */
import { type NextRequest } from "next/server";
import { registerOne } from "@/lib/postParcel/agentCall";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { source, reqType, ...order } = body;
  if (!order.order || !order.name || !(order.addr || order.addr1) || !order.zip) {
    return Response.json({ error: "order, name, addr, zip 필요" }, { status: 400 });
  }
  try {
    const result = await registerOne(order, source || "manual", reqType === "2" ? "2" : "1");
    if (!result.success) {
      return Response.json({ error: result.error || "접수 실패", code: result.code }, { status: 502 });
    }
    return Response.json(result);
  } catch (e) {
    return Response.json(
      { error: (e as Error).message || "에이전트 호출 실패 (로컬 에이전트 실행 중인지 확인)" },
      { status: 502 }
    );
  }
}
