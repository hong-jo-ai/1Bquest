export const maxDuration = 120;

import { NextRequest, NextResponse } from "next/server";
import { getAccessTokenFromStore } from "@/lib/cafe24TokenStore";
import { type MallId } from "@/lib/cafe24Client";
import { runInventorySync } from "@/lib/inventorySync";

/**
 * 매일 오전 7시(KST) 실행 — 폴바이스 + 해리엇 두 몰의 재고를 각각 카페24에 동기화.
 * 채널 판매분(폴바이스=무신사·29CM·W컨셉·카카오, 해리엇=식스샵)은 fetchOtherChannelsSales 가
 * 몰별 카페24 상품명으로 매칭해 차감한다. 한 몰 토큰이 없어도 다른 몰은 계속 진행.
 */
const MALLS: MallId[] = ["paulvice", "harriot"];

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const malls: Record<string, unknown> = {};
  for (const mall of MALLS) {
    try {
      const token = await getAccessTokenFromStore(mall);
      if (!token) {
        malls[mall] = { skipped: "카페24 토큰 없음" };
        console.log(`[Cron:inventory-sync] ${mall} 건너뜀 — 토큰 없음`);
        continue;
      }
      const { synced, failed, results } = await runInventorySync(token, "cron", undefined, mall);
      malls[mall] = { synced, failed, results };
      console.log(`[Cron:inventory-sync] ${mall} 완료 — 성공 ${synced}건, 실패 ${failed}건`);
    } catch (e: any) {
      malls[mall] = { error: e?.message ?? String(e) };
      console.error(`[Cron:inventory-sync] ${mall} 실패:`, e);
    }
  }

  return NextResponse.json({ success: true, malls });
}
