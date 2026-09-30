/**
 * GET /api/inventory/levels?brand=paulvice|harriot
 * 서버가 카페24에 실제로 push 하는 재고 계산값(computeInventoryLevels)을 그대로 내려준다.
 *
 * 🔴 왜 필요한가(2026-09-30): 재고 화면은 판매를 클라이언트에서 따로 셌다(입고일 이전 판매까지 전 기간·면세점 출고 미반영).
 * 서버는 입고일 이후만 센다. 사장님이 화면에서 에끌라 골드를 "108"로 맞추자 화면 기준 판매로 조정값이 잡혀
 * 서버 push 는 398 이 됐다. 화면이 이 값을 쓰면 "화면에서 맞춘 수 = 카페24에 들어가는 수"가 된다.
 */
import { type NextRequest } from "next/server";
import { getValidC24Token } from "@/lib/cafe24Auth";
import { getAccessTokenFromStore } from "@/lib/cafe24TokenStore";
import { type MallId } from "@/lib/cafe24Client";
import { computeInventoryLevels } from "@/lib/inventorySync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const mall: MallId = req.nextUrl.searchParams.get("brand") === "harriot" ? "harriot" : "paulvice";
  let token = await getValidC24Token(mall);
  if (!token) token = await getAccessTokenFromStore(mall);
  if (!token) return Response.json({ ok: false, error: "카페24 연결 필요" }, { status: 401 });
  try {
    const levels = await computeInventoryLevels(token, mall);
    return Response.json({ ok: true, levels });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
