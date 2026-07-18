// 2026-07-18: 재고 SKU 대량 등록 후 120s 하드 타임아웃(하트비트도 못 남기고 죽음) → 300s로 상향.
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { getAccessTokenFromStore } from "@/lib/cafe24TokenStore";
import { type MallId } from "@/lib/cafe24Client";
import { runInventorySync } from "@/lib/inventorySync";
import { runBatterySync } from "@/lib/batterySync";
import { withCron, manualRun } from "@/lib/cron/withCron";

/**
 * 매일 오전 7시(KST) 실행 — 폴바이스 + 해리엇 두 몰의 재고를 각각 카페24에 동기화.
 * 채널 판매분(폴바이스=무신사·29CM·W컨셉·카카오, 해리엇=식스샵)은 fetchOtherChannelsSales 가
 * 몰별 카페24 상품명으로 매칭해 차감한다. 한 몰 토큰이 없어도 다른 몰은 계속 진행.
 */
const MALLS: MallId[] = ["paulvice", "harriot"];

async function cronMain() {

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

  // 시계 판매분 → 배터리 부자재 자동차감 (재고 동기화 후, 델타 방식)
  let battery: unknown;
  try {
    battery = await runBatterySync();
    console.log(`[Cron:inventory-sync] 배터리 차감:`, JSON.stringify(battery));
  } catch (e: any) {
    battery = { error: e?.message ?? String(e) };
    console.error(`[Cron:inventory-sync] 배터리 차감 실패:`, e);
  }

  // 두 몰 전부 에러/스킵이면 실패로 처리 (감사 지적: 전부 실패해도 success:true 반환하던 버그)
  const allFailed = MALLS.every((m) => {
    const r = malls[m] as Record<string, unknown> | undefined;
    return !r || "error" in r || "skipped" in r;
  });
  if (allFailed) {
    return NextResponse.json({ success: false, malls, battery }, { status: 500 });
  }
  return NextResponse.json({ success: true, malls, battery });
}

export const GET = withCron("inventory-sync", () => cronMain());
// 수동 즉시 실행(관리자 세션) — 성공 시 하트비트도 갱신돼 워치독 오탐이 자동 회복된다.
export const POST = () => manualRun("inventory-sync", () => cronMain());
