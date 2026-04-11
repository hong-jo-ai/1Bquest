export const maxDuration = 60;

import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { getValidC24Token } from "@/lib/cafe24Auth";
import { getAccessTokenFromStore } from "@/lib/cafe24TokenStore";
import { runInventorySync, getSyncLogs } from "@/lib/inventorySync";

/**
 * POST /api/cafe24/inventory-sync
 * Body: { skus?: string[] }  — 특정 SKU만 동기화 (없으면 전체)
 *
 * 수동 즉시 동기화
 */
export async function POST(req: NextRequest) {
  const { skus } = await req.json().catch(() => ({ skus: undefined }));

  // 토큰 확보 (쿠키 우선 → Supabase fallback)
  let token = await getValidC24Token();
  if (!token) {
    token = await getAccessTokenFromStore();
  }
  if (!token) {
    return NextResponse.json({ error: "카페24 연결 필요" }, { status: 401 });
  }

  try {
    const result = await runInventorySync(token, "manual", skus);
    return NextResponse.json({ success: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/**
 * GET /api/cafe24/inventory-sync
 * 동기화 이력 조회
 */
export async function GET() {
  const logs = await getSyncLogs();
  return NextResponse.json({ logs });
}
