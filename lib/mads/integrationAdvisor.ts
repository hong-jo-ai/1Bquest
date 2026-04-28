/**
 * 통합 어드바이저 — 작은 세트가 너무 많으면 합치라고 권장.
 *
 * Meta 머신러닝 임계는 광고세트 단위 50건/주. 폴바이스 객단가 8만원에선
 * 일예산 15만원 정도가 안전한 학습 도달선. 그보다 작은 untrusted/learning 세트가
 * 여러 개면 어떤 세트도 학습 못 함 → 통합 권장.
 */
import { createClient } from "@supabase/supabase-js";

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

const POLICY = {
  MIN_SETS_TO_TRIGGER:    3,        // 이 개수 이상이면 권장
  MIN_AVG_DAILY_BUDGET:   50_000,   // 평균 일예산이 이 미만이면 분산 신호
  TARGET_CONVERSIONS_7D:  50,       // Meta 학습 임계
  ASSUMED_AOV_KRW:        80_000,   // 폴바이스 객단가
  ASSUMED_ROAS:           2.0,      // 학습 도달 시점 평균 가정 (보수적)
} as const;

export interface IntegrationAdvice {
  triggered:           boolean;
  reason:              string;
  smallSetCount:       number;
  smallSetIds:         string[];
  totalDailyBudget:    number;          // 합산 일예산
  totalConversions7d:  number;          // 합산 7일 전환
  totalSpend7d:        number;          // 합산 7일 지출
  estDaysToLearning:   number | null;   // 통합 시 50건 도달까지 추정 일수
  policy: {
    minSetsToTrigger: number;
    minAvgDailyBudget: number;
    targetConversions7d: number;
  };
  smallSets: Array<{
    metaAdsetId:      string;
    name:             string;
    campaignName:     string | null;
    dailyBudget:      number | null;
    trustLevel:       string;
    conversions7d:    number;
    spend7d:          number;
    roas7d:           number;
  }>;
}

export async function buildIntegrationAdvice(): Promise<IntegrationAdvice> {
  const db = getDb();
  const empty: IntegrationAdvice = {
    triggered: false,
    reason: "데이터 없음",
    smallSetCount: 0, smallSetIds: [], totalDailyBudget: 0,
    totalConversions7d: 0, totalSpend7d: 0, estDaysToLearning: null,
    policy: {
      minSetsToTrigger: POLICY.MIN_SETS_TO_TRIGGER,
      minAvgDailyBudget: POLICY.MIN_AVG_DAILY_BUDGET,
      targetConversions7d: POLICY.TARGET_CONVERSIONS_7D,
    },
    smallSets: [],
  };
  if (!db) return empty;

  // 1) 활성 광고세트 조회 + 가장 최근 trust evaluation 조인
  const { data: ads } = await db
    .from("mads_ad_sets")
    .select("meta_adset_id, name, campaign_name, daily_budget, status")
    .eq("status", "ACTIVE");

  if (!ads || ads.length === 0) return empty;

  // 각 세트의 가장 최근 trust eval
  const ids = ads.map((a) => a.meta_adset_id);
  const { data: trusts } = await db
    .from("mads_trust_evaluations")
    .select("meta_adset_id, trust_level, conversions_7d, spend_7d, roas_7d, evaluated_at")
    .in("meta_adset_id", ids)
    .order("evaluated_at", { ascending: false });

  const latestTrust = new Map<string, { trust_level: string; conversions_7d: number; spend_7d: number; roas_7d: number }>();
  for (const t of trusts ?? []) {
    if (!latestTrust.has(t.meta_adset_id)) {
      latestTrust.set(t.meta_adset_id, {
        trust_level: t.trust_level,
        conversions_7d: t.conversions_7d,
        spend_7d: Number(t.spend_7d),
        roas_7d: Number(t.roas_7d),
      });
    }
  }

  // 2) untrusted/learning 세트만 필터 (= 학습 미완)
  const small = ads
    .filter((a) => a.daily_budget !== null) // CBO는 제외
    .map((a) => {
      const t = latestTrust.get(a.meta_adset_id) ?? {
        trust_level: "untrusted", conversions_7d: 0, spend_7d: 0, roas_7d: 0,
      };
      return { ...a, ...t };
    })
    .filter((a) => a.trust_level === "untrusted" || a.trust_level === "learning");

  if (small.length < POLICY.MIN_SETS_TO_TRIGGER) {
    return { ...empty, triggered: false, reason: `학습 미완 세트 ${small.length}개 (트리거 ${POLICY.MIN_SETS_TO_TRIGGER}개 미만)` };
  }

  const totalBudget = small.reduce((s, a) => s + (a.daily_budget ?? 0), 0);
  const avgBudget = totalBudget / small.length;
  if (avgBudget >= POLICY.MIN_AVG_DAILY_BUDGET) {
    return {
      ...empty, triggered: false,
      reason: `학습 미완 세트 ${small.length}개지만 평균 일예산 ${Math.round(avgBudget).toLocaleString("ko-KR")}원 (≥ ${POLICY.MIN_AVG_DAILY_BUDGET.toLocaleString("ko-KR")}원)`,
    };
  }

  const totalConv7d = small.reduce((s, a) => s + a.conversions_7d, 0);
  const totalSpend7d = small.reduce((s, a) => s + a.spend_7d, 0);

  // 통합 시 학습 도달 추정:
  //   현재 합산 7일 전환이 totalConv7d. 일평균 = totalConv7d / 7.
  //   목표 = 50 - totalConv7d. 필요한 일수 = (50 - totalConv7d) / (totalConv7d / 7).
  //   또는 합산 일예산으로 추정: totalBudget * ROAS / AOV = 일 전환.
  const dailyConvFromBudget = (totalBudget * POLICY.ASSUMED_ROAS) / POLICY.ASSUMED_AOV_KRW;
  const dailyConvFromHistory = totalConv7d / 7;
  const dailyConv = Math.max(dailyConvFromBudget, dailyConvFromHistory, 0.1);
  const estDays = Math.ceil(POLICY.TARGET_CONVERSIONS_7D / dailyConv);

  return {
    triggered: true,
    reason: `학습 미완 세트 ${small.length}개, 평균 일예산 ${Math.round(avgBudget).toLocaleString("ko-KR")}원 (< ${POLICY.MIN_AVG_DAILY_BUDGET.toLocaleString("ko-KR")}원). 분산되어 어떤 세트도 학습 임계(50건/주) 도달 못 함.`,
    smallSetCount: small.length,
    smallSetIds: small.map((a) => a.meta_adset_id),
    totalDailyBudget: totalBudget,
    totalConversions7d: totalConv7d,
    totalSpend7d: Math.round(totalSpend7d),
    estDaysToLearning: estDays,
    policy: {
      minSetsToTrigger: POLICY.MIN_SETS_TO_TRIGGER,
      minAvgDailyBudget: POLICY.MIN_AVG_DAILY_BUDGET,
      targetConversions7d: POLICY.TARGET_CONVERSIONS_7D,
    },
    smallSets: small.map((a) => ({
      metaAdsetId:    a.meta_adset_id,
      name:           a.name,
      campaignName:   a.campaign_name,
      dailyBudget:    a.daily_budget,
      trustLevel:     a.trust_level,
      conversions7d:  a.conversions_7d,
      spend7d:        a.spend_7d,
      roas7d:         a.roas_7d,
    })),
  };
}
