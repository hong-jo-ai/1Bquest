/**
 * 카카오선물하기 월별 정산서 업로드.
 *
 * POST /api/finance/kakao-gift-settlement/upload  (multipart: file=*.xlsx)
 *   1. 정산서 파일에서 year/month + 매출/수량/상품 추출
 *   2. channel_settlement:kakao_gift:YYYY-MM 에 raw 저장 (재업로드 시 덮어쓰기)
 *   3. 모든 정산서 + 시트 데이터 머지 → channel_upload:kakao_gift 갱신
 */
import type { NextRequest } from "next/server";
import { parseKakaoSettlement } from "@/lib/finance/kakaoGiftSettlement";
import {
  saveSettlement,
  rebuildKakaoGiftChannelData,
} from "@/lib/finance/kakaoGiftMerger";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_SIZE = 10 * 1024 * 1024;

export async function POST(req: NextRequest) {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return Response.json({ error: "multipart/form-data 파싱 실패" }, { status: 400 });
  }
  const file = formData.get("file") as File | null;
  if (!file) return Response.json({ error: "file 필드가 없습니다" }, { status: 400 });
  if (file.size > MAX_SIZE)
    return Response.json({ error: "파일 크기 10MB 초과" }, { status: 413 });
  if (!file.name.match(/\.(xlsx|xls)$/i))
    return Response.json({ error: ".xlsx / .xls 정산서 파일만 가능" }, { status: 415 });

  let settlement;
  try {
    const buffer = await file.arrayBuffer();
    settlement = parseKakaoSettlement(buffer, file.name);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 422 },
    );
  }

  try {
    await saveSettlement(settlement);
    const merged = await rebuildKakaoGiftChannelData();

    return Response.json({
      ok: true,
      year: settlement.year,
      month: settlement.month,
      totalRevenue: settlement.totalRevenue,
      totalSettlement: settlement.totalSettlement,
      totalSold: settlement.totalSold,
      productCount: settlement.products.length,
      // 머지 후 전체 상태
      settlementCount: merged.settlementCount,
      monthsWithData: merged.data.dailyRevenue?.length ?? 0,
      data: merged.data,
      meta: {
        fileName: file.name,
        rowCount: merged.data.topProducts.length,
        period: {
          start: merged.data.dailyRevenue?.[0]?.date ?? "",
          end: merged.data.dailyRevenue?.at(-1)?.date ?? "",
        },
        uploadedAt: new Date().toISOString(),
      },
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
