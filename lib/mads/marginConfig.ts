/**
 * 마진 / BE ROAS 설정.
 *
 * 모든 임계값은 BE_ROAS의 배수로 표현 → 마진 바뀌면 임계값 자동 재계산.
 *
 * 폴바이스 기준 (대표상품 에끌라 오벌, 자사몰 = 카페24):
 *   판매가 79,570 - COGS 15,883 - 포장 1,780 - 택배 2,500
 *   - 카페24 수수료 3.85% (3,063) - 부가세 부담 (5,790)
 *   = 공헌이익 50,554 (공헌이익률 63.5%)
 *   → BE ROAS = 79,570 / 50,554 ≈ 1.57
 *
 * 매출 우선 정책:
 *   ROAS_LOW  = BE × 0.95  ≈ 1.49  → 미만이면 종료 후보
 *   ROAS_BASE = BE × 1.6   ≈ 2.51  → 이상이면 +30% 증액
 *   ROAS_HIGH = BE × 2.2   ≈ 3.45  → 이상이면 +50% 증액 (또는 복제)
 */
import { createClient } from "@supabase/supabase-js";

const KV_KEY = "mads:margin_config";

export interface MarginConfig {
  beRoas: number;
  referenceProduct: string;
  calc: {
    price: number;
    cogs: number;
    packaging: number;
    shipping: number;
    channelFeeRate: number;        // 0.0385 = 3.85%
    vatBurden: number;             // 매출세액-매입세액 추정
    contributionMargin: number;
    contributionMarginRate: number;
  };
  multipliers: {
    low: number;    // BE × 0.95 → 종료 임계
    base: number;   // BE × 1.6  → 증액 임계
    high: number;   // BE × 2.2  → 공격 증액 임계
  };
  // 정책 파라미터
  policy: {
    incrPctBase: number;          // BASE 충족 시 증액 %
    incrPctHigh: number;          // HIGH 충족 시 증액 %
    minBudgetKrw: number;         // 일 예산 하한
    duplicateBudgetKrw: number;   // 단일 세트 무한 증액 대신 복제 트리거
    pauseMinSpendKrw: number;     // 종료 추천 최소 누적 지출
    changeLockHours: number;      // 직전 변경 후 락 시간
    largeOrderShareThreshold: number; // 큰 주문 1건이 7일 매출의 N% 이상이면 보정
  };
  updatedAt: string;
}

export const DEFAULT_MARGIN_CONFIG: MarginConfig = {
  beRoas: 1.57,
  referenceProduct: "에끌라 오벌 (P00000HN)",
  calc: {
    price:                  79_570,
    cogs:                   15_883,
    packaging:              1_780,
    shipping:               2_500,
    channelFeeRate:         0.0385,
    vatBurden:              5_790,
    contributionMargin:     50_554,
    contributionMarginRate: 0.635,
  },
  multipliers: {
    low:  0.95,
    base: 1.60,
    high: 2.20,
  },
  policy: {
    incrPctBase:              30,
    incrPctHigh:              50,
    minBudgetKrw:             5_000,
    duplicateBudgetKrw:       300_000,
    pauseMinSpendKrw:         50_000,
    changeLockHours:          72,
    largeOrderShareThreshold: 0.40,
  },
  updatedAt: new Date().toISOString(),
};

export interface ResolvedThresholds {
  beRoas: number;
  roasLow: number;
  roasBase: number;
  roasHigh: number;
  policy: MarginConfig["policy"];
}

export function resolveThresholds(
  cfg: MarginConfig,
  seasonModifier = 0,
): ResolvedThresholds {
  const be = cfg.beRoas;
  return {
    beRoas: be,
    roasLow:  +(be * cfg.multipliers.low).toFixed(2),
    roasBase: +(be * cfg.multipliers.base + seasonModifier).toFixed(2),
    roasHigh: +(be * cfg.multipliers.high + seasonModifier).toFixed(2),
    policy: cfg.policy,
  };
}

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export async function getMarginConfig(): Promise<MarginConfig> {
  const db = getDb();
  if (!db) return DEFAULT_MARGIN_CONFIG;
  const { data } = await db
    .from("kv_store")
    .select("data")
    .eq("key", KV_KEY)
    .maybeSingle();
  if (!data?.data) return DEFAULT_MARGIN_CONFIG;
  return { ...DEFAULT_MARGIN_CONFIG, ...(data.data as Partial<MarginConfig>) };
}

export async function saveMarginConfig(cfg: MarginConfig): Promise<void> {
  const db = getDb();
  if (!db) throw new Error("Supabase 미설정");
  const next = { ...cfg, updatedAt: new Date().toISOString() };
  const { error } = await db
    .from("kv_store")
    .upsert({ key: KV_KEY, data: next, updated_at: next.updatedAt }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}
