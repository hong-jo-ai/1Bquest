export const maxDuration = 120;

import { NextResponse } from "next/server";
import { runBatterySync } from "@/lib/batterySync";

/**
 * POST /api/inventory/battery-sync — 시계 판매분에 따라 배터리 부자재 재고 차감(멱등, 델타 방식).
 * 첫 실행은 기준선만 잡고 차감하지 않는다.
 */
export async function POST() {
  try {
    const result = await runBatterySync();
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export const GET = POST;
