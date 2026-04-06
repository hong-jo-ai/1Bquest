export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { runJewelryClearance } from "@/lib/jewelryClearance";
import { runClearanceAds } from "@/lib/clearanceAdEngine";
import { getAccessTokenFromStore } from "@/lib/cafe24TokenStore";
import { getMetaTokenFromStore } from "@/lib/metaTokenStore";

// Vercel Cron이 매일 오전 7시(KST) = 22:00(UTC, 전날)에 호출

export async function GET(request: NextRequest) {
  // Vercel Cron 인증 확인
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    // 1. 카페24 토큰으로 청산 엔진 실행
    const cafe24Token = await getAccessTokenFromStore();
    if (!cafe24Token) {
      return NextResponse.json(
        { error: "카페24 토큰 없음 — 대시보드에서 카페24 로그인 필요" },
        { status: 401 }
      );
    }

    const clearanceResult = await runJewelryClearance(cafe24Token);
    console.log(`[Cron] 주얼리 청산 완료 — 가격변경 ${clearanceResult.priceChanges}건, 진열변경 ${clearanceResult.displayChanges}건`);

    // 2. Meta 토큰으로 광고 자동 생성/업데이트
    let adResult = null;
    const metaToken = await getMetaTokenFromStore();
    if (metaToken && clearanceResult.products.length > 0) {
      try {
        adResult = await runClearanceAds(metaToken, clearanceResult);
        console.log(`[Cron] 광고 생성 ${adResult.adsCreated}건, 일시중지 ${adResult.adsPaused}건`);
      } catch (e: any) {
        console.error("[Cron] 광고 엔진 오류:", e);
        adResult = { error: e.message };
      }
    } else if (!metaToken) {
      console.log("[Cron] Meta 토큰 없음 — 광고 자동 생성 건너뜀");
    }

    return NextResponse.json({
      success: true,
      ...clearanceResult,
      adResult,
    });
  } catch (e: any) {
    console.error("[Cron] 주얼리 청산 실패:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
