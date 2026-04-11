export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { getAccessTokenFromStore } from "@/lib/cafe24TokenStore";
import { runInventorySync } from "@/lib/inventorySync";

/**
 * 매일 오전 7시(KST) 실행
 * 대시보드 재고 데이터를 Cafe24에 동기화
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const token = await getAccessTokenFromStore();
    if (!token) {
      return NextResponse.json(
        { error: "카페24 토큰 없음 — 대시보드에서 카페24 로그인 필요" },
        { status: 401 },
      );
    }

    const { synced, failed, results } = await runInventorySync(token, "cron");

    console.log(`[Cron:inventory-sync] 완료 — 성공 ${synced}건, 실패 ${failed}건`);
    return NextResponse.json({ success: true, synced, failed, results });
  } catch (e: any) {
    console.error("[Cron:inventory-sync] 실패:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
