export const maxDuration = 60;

import { NextResponse } from "next/server";
import { getAccessTokenFromStore } from "@/lib/cafe24TokenStore";
import { runRevenueSnapshot } from "@/lib/finance/revenueSnapshot";
import { withCron } from "@/lib/cron/withCron";
import { syncMusinsaAdSpend } from "@/lib/finance/musinsaAdSpend";

/**
 * 매일 KST 03:30 실행.
 * 카페24 + channel_upload:* 의 dailyRevenue 를 모아 brand 별 매출 히스토리에 적재.
 * 매출 추이 그래프(대시보드)의 데이터 소스.
 */
async function cronMain() {

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

    // 무신사 파트너 광고비(카드/체크 출금) → ad_spend:musinsa. 크론 한도(40개) 때문에 여기에 얹는다.
    // 실패해도 매출 스냅샷은 성공 처리 — 광고비는 부가 정보.
    try {
      const ad = await syncMusinsaAdSpend(90);
      console.log(`[Cron:revenue-snapshot] 무신사 광고비 ${ad.days}일/${(ad.total ?? 0).toLocaleString()}원`);
    } catch (e) {
      console.warn("[Cron:revenue-snapshot] 무신사 광고비 집계 실패:", e instanceof Error ? e.message : String(e));
    }
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

export const GET = withCron("revenue-snapshot", () => cronMain());
