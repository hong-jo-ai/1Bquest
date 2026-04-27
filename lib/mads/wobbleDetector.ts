/**
 * 흔들림 감지 + 경고 생성.
 *
 *   1. 같은 광고세트 24h 내 수동 액션 ≥ 2회 → wobble 경고 + 추천 보류 권장
 *   2. 큰 주문 1건이 7일 매출 N%+ 차지 → 데이터 왜곡 경고
 *   3. 직전 예산 변경 후 changeLockHours 미경과 → 락 (룰 엔진에서 hold 처리)
 *   4. 일별 메트릭 결손이 7일 중 3일+ → data_gap
 */
import { createClient } from "@supabase/supabase-js";
import type { DailyMetric, Warning } from "./types";

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export async function getManualActionCount24h(metaAdsetId: string): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await db
    .from("mads_manual_action_logs")
    .select("id", { count: "exact", head: true })
    .eq("meta_adset_id", metaAdsetId)
    .gte("created_at", since);
  return count ?? 0;
}

export async function logManualAction(
  metaAdsetId: string,
  action: string,
  source: "mads" | "manual" | "meta_ui",
  detail: Record<string, unknown> = {},
): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db.from("mads_manual_action_logs").insert({
    meta_adset_id: metaAdsetId,
    action,
    source,
    detail,
  });
}

export interface WarningInput {
  metaAdsetId: string;
  metrics: DailyMetric[];
  lastBudgetChangeAt: string | null;
  changeLockHours: number;
  largeOrderShareThreshold: number;
  manualActionCount24h: number;
}

export function buildWarnings(input: WarningInput): Warning[] {
  const warnings: Warning[] = [];

  // 1. 흔들림
  if (input.manualActionCount24h >= 2) {
    warnings.push({
      code: "wobble",
      message: `최근 24시간 내 수동 변경 ${input.manualActionCount24h}회. 흔들림 감지 — 결정 보류 권장.`,
    });
  }

  // 2. 큰 주문 왜곡
  const last7 = [...input.metrics]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-7);
  const totalRev = last7.reduce((s, m) => s + m.revenue, 0);
  const largest  = Math.max(0, ...last7.map((m) => m.largestOrderValue));
  if (totalRev > 0 && largest / totalRev >= input.largeOrderShareThreshold) {
    const pct = Math.round((largest / totalRev) * 100);
    warnings.push({
      code: "large_order_distortion",
      message: `큰 주문 1건(${largest.toLocaleString("ko-KR")}원)이 7일 매출의 ${pct}% — 데이터 왜곡. 보정 ROAS 참고.`,
    });
  }

  // 3. 변경 락
  if (input.lastBudgetChangeAt) {
    const elapsed =
      (Date.now() - new Date(input.lastBudgetChangeAt).getTime()) / 1000 / 3600;
    if (elapsed < input.changeLockHours) {
      const remaining = Math.ceil(input.changeLockHours - elapsed);
      warnings.push({
        code: "recent_budget_change",
        message: `직전 예산 변경 후 ${Math.floor(elapsed)}h 경과. 락 ${input.changeLockHours}h, ${remaining}h 더 대기 필요.`,
      });
    }
  }

  // 4. 데이터 결손
  const missingDays = 7 - last7.length;
  if (missingDays >= 3) {
    warnings.push({
      code: "data_gap",
      message: `최근 7일 중 ${missingDays}일치 메트릭 누락. 평가 신뢰도 낮음.`,
    });
  }

  return warnings;
}
