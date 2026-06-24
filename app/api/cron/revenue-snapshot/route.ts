export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { getAccessTokenFromStore } from "@/lib/cafe24TokenStore";
import { runRevenueSnapshot } from "@/lib/finance/revenueSnapshot";

/**
 * 매일 KST 03:30 실행.
 * 카페24 + channel_upload:* 의 dailyRevenue 를 모아 brand 별 매출 히스토리에 적재.
 * 매출 추이 그래프(대시보드)의 데이터 소스.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const token = await getAccessTokenFromStore();
    if (!token) {
      console.warn("[Cron:revenue-snapshot] cafe24 토큰 없음(paulvice) — paulvice cafe24 부분 skip");
    }
    const harriotToken = await getAccessTokenFromStore("harriot");
    if (!harriotToken) {
      console.warn("[Cron:revenue-snapshot] cafe24 토큰 없음(harriot) — harriot cafe24 부분 skip");
    }

    const result = await runRevenueSnapshot(token ?? null, harriotToken ?? null);
    console.log(
      `[Cron:revenue-snapshot] paulvice=${result.paulvice.days}일/` +
        `${result.paulvice.channels.join(",")} · ` +
        `harriot=${result.harriot.days}일/${result.harriot.channels.join(",")}`,
    );
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    console.error("[Cron:revenue-snapshot] 실패:", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
