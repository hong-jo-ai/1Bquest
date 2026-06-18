export const maxDuration = 60;

import { type NextRequest, NextResponse } from "next/server";
import { getValidC24Token } from "@/lib/cafe24Auth";
import { getAccessTokenFromStore } from "@/lib/cafe24TokenStore";
import { type MallId } from "@/lib/cafe24Client";
import { runInventorySync, getSyncLogs } from "@/lib/inventorySync";

function brandOf(req: NextRequest): MallId {
  return req.nextUrl.searchParams.get("brand") === "harriot" ? "harriot" : "paulvice";
}

/**
 * POST /api/cafe24/inventory-sync?brand=paulvice|harriot
 * Body: { skus?: string[] }  — 특정 SKU만 동기화 (없으면 전체)
 *
 * 수동 즉시 동기화 (해당 브랜드 몰의 재고를 카페24에 push)
 */
export async function POST(req: NextRequest) {
  const mall = brandOf(req);
  const { skus } = await req.json().catch(() => ({ skus: undefined }));

  let token = await getValidC24Token(mall);
  if (!token) {
    token = await getAccessTokenFromStore(mall);
  }
  if (!token) {
    return NextResponse.json({ error: "카페24 연결 필요" }, { status: 401 });
  }

  try {
    const result = await runInventorySync(token, "manual", skus, mall);
    return NextResponse.json({ success: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/**
 * GET /api/cafe24/inventory-sync?brand=  — 동기화 이력 조회
 */
export async function GET(req: NextRequest) {
  const logs = await getSyncLogs(brandOf(req));
  return NextResponse.json({ logs });
}
