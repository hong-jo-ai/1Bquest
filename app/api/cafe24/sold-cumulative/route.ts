/**
 * SKU별 누적 판매 수량 — 재고관리 현재고 차감 소스.
 * (기존 재고관리는 /api/cafe24/data 의 topProducts=이번달 TOP10 을 판매로 썼는데,
 *  TOP10 밖 상품 유령재고 + 월 리셋 버그가 있어 누적 집계로 교체. 2026-07-29)
 */
import { getCumulativeSoldBySku } from "@/lib/cafe24/cumulativeSold";
import { getValidC24Token } from "@/lib/cafe24Auth";
import { getAccessTokenFromStore } from "@/lib/cafe24TokenStore";
import { type MallId } from "@/lib/cafe24Client";
import { type NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const mall: MallId = req.nextUrl.searchParams.get("brand") === "harriot" ? "harriot" : "paulvice";
  const force = req.nextUrl.searchParams.get("force") === "1";

  let token = await getValidC24Token(mall);
  if (!token) token = await getAccessTokenFromStore(mall);
  if (!token) return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });

  try {
    const r = await getCumulativeSoldBySku(token, mall, force);
    return NextResponse.json({ ok: true, ...r });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[cafe24] sold-cumulative error:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
