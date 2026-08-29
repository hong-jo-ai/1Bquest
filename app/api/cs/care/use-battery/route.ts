/**
 * 배터리 무료 1회 사용 처리 — 상담에서 실제로 접수했을 때 누른다.
 *
 * 자동으로 소진시키지 않는 이유: 문의만 하고 안 보내는 경우가 많다.
 * 접수하지도 않았는데 소진되면 고객은 혜택을 잃고, 우리는 그걸 알아채지 못한다.
 * 그래서 **사람이 접수를 확인한 시점에만** 기록한다.
 */
import { type NextRequest } from "next/server";
import { useBattery, lookup } from "@/lib/care/store";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { phone } = (await req.json().catch(() => ({}))) as { phone?: string };
  if (!phone) return Response.json({ ok: false, error: "phone 필요" }, { status: 400 });
  const ok = await useBattery(phone);
  // 실패는 대개 "이미 사용함" — 조회 결과를 같이 돌려줘 화면이 바로 최신 상태가 되게 한다.
  return Response.json({ ok, care: await lookup(phone) });
}
