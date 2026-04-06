export const maxDuration = 60; // 최대 60초 (Vercel Pro)

import { getValidC24Token } from "@/lib/cafe24Auth";
import { runJewelryClearance, getClearanceStatus } from "@/lib/jewelryClearance";
import { runClearanceAds, getClearanceAdStatus } from "@/lib/clearanceAdEngine";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

// GET: 현재 상태 및 변경 이력 + 광고 상태
export async function GET() {
  try {
    const status = await getClearanceStatus();

    let adStatus = null;
    let metaError: string | null = null;
    const cookieStore = await cookies();
    const metaToken = cookieStore.get("meta_at")?.value || process.env.META_SYSTEM_TOKEN;
    if (metaToken) {
      try {
        adStatus = await getClearanceAdStatus(metaToken);
      } catch (e: any) {
        metaError = e.message;
      }
    }

    return NextResponse.json({
      ...status,
      adStatus,
      _meta: { hasMetaToken: !!metaToken, metaError },
    });
  } catch (e: any) {
    console.error("[JewelryClearance] status error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST: 수동 실행 (청산 + 광고)
export async function POST() {
  const token = await getValidC24Token();
  if (!token) {
    return NextResponse.json({ error: "카페24 미연결 — 카페24 로그인을 먼저 해주세요" }, { status: 401 });
  }

  try {
    // 1. 청산 엔진 실행
    const clearanceResult = await runJewelryClearance(token);

    // 2. Meta 광고 자동 생성/업데이트
    let adResult: any = null;
    const cookieStore2 = await cookies();
    const metaToken = cookieStore2.get("meta_at")?.value || process.env.META_SYSTEM_TOKEN;

    if (!metaToken) {
      adResult = { skipped: true, reason: "Meta 미연결 — 광고 탭에서 Meta를 연결하세요" };
    } else if (clearanceResult.products.length === 0) {
      adResult = { skipped: true, reason: "주얼리 상품이 없어서 광고를 생성하지 않았습니다" };
    } else {
      try {
        adResult = await runClearanceAds(metaToken, clearanceResult);
        console.log(`[JewelryClearance] 광고 생성 ${adResult.adsCreated}건`);
      } catch (e: any) {
        console.error("[JewelryClearance] 광고 엔진 오류:", e);
        adResult = { error: e.message };
      }
    }

    return NextResponse.json({
      ...clearanceResult,
      adResult,
      _debug: {
        hasC24Token: true,
        hasMetaToken: !!metaToken,
        productsFound: clearanceResult.products.length,
      },
    });
  } catch (e: any) {
    console.error("[JewelryClearance] execution error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
