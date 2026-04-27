/**
 * 신뢰 등급 평가.
 *
 *   untrusted: 7일 전환 < 25  → 데이터 불신 (어떤 변경도 추천 안 함, 단 명백한 죽은 광고 종료는 가능)
 *   learning : 7일 전환 25~49 → 보수적 추천만
 *   trusted  : 7일 전환 ≥ 50  → 정상 룰 적용
 *   decaying : trusted 후보지만 직전 7일 대비 ROAS 30%+ 하락 → 크리에이티브 교체
 *
 * 큰 주문 보정: 7일 매출 중 1건이 40%+ 차지하면 그 1건 빼고 ROAS 재계산.
 */
import type { DailyMetric, TrustEvaluation, TrustLevel } from "./types";

function sum(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0);
}

function safeRoas(revenue: number, spend: number): number {
  if (spend <= 0) return 0;
  return revenue / spend;
}

interface EvalOptions {
  largeOrderShareThreshold: number;
  decayingDropPct: number;       // ex 0.30 = 30% drop
  conversionsLearningMin: number; // 25
  conversionsTrustedMin: number;  // 50
}

const DEFAULT_OPTS: EvalOptions = {
  largeOrderShareThreshold: 0.40,
  decayingDropPct:         0.30,
  conversionsLearningMin:  25,
  conversionsTrustedMin:   50,
};

/**
 * @param metrics 최근 14일 분의 일별 메트릭 (오름차순). 없는 날은 빠져있어도 OK.
 */
export function evaluateTrust(
  metrics: DailyMetric[],
  opts: Partial<EvalOptions> = {},
): TrustEvaluation {
  const o = { ...DEFAULT_OPTS, ...opts };

  // metrics는 오름차순(과거→최신)이라고 가정. 최근 7일 / 그 이전 7일 분리.
  const sorted = [...metrics].sort((a, b) => a.date.localeCompare(b.date));
  const last7  = sorted.slice(-7);
  const prev7  = sorted.slice(-14, -7);
  const last3  = sorted.slice(-3);

  const conv7d    = sum(last7.map((m) => m.conversions));
  const spend7d   = sum(last7.map((m) => m.spend));
  const revenue7d = sum(last7.map((m) => m.revenue));
  const roas7d    = safeRoas(revenue7d, spend7d);

  const spend3d   = sum(last3.map((m) => m.spend));
  const revenue3d = sum(last3.map((m) => m.revenue));
  const roas3d    = safeRoas(revenue3d, spend3d);

  // 큰 주문 보정 ROAS
  const largestOrder = Math.max(0, ...last7.map((m) => m.largestOrderValue));
  const largestShare = revenue7d > 0 ? largestOrder / revenue7d : 0;
  const adjustedRevenue7d = largestShare >= o.largeOrderShareThreshold
    ? Math.max(0, revenue7d - largestOrder)
    : revenue7d;
  const adjustedRoas7d = safeRoas(adjustedRevenue7d, spend7d);

  // 직전 7일 ROAS (decaying 판정용)
  const prevSpend7d   = sum(prev7.map((m) => m.spend));
  const prevRevenue7d = sum(prev7.map((m) => m.revenue));
  const prevRoas7d    = prevSpend7d > 0 ? prevRevenue7d / prevSpend7d : null;

  // 등급 분류
  let level: TrustLevel;
  let reason: string;

  if (conv7d < o.conversionsLearningMin) {
    level = "untrusted";
    reason = `7일 전환 ${conv7d}건 (< ${o.conversionsLearningMin}). Meta 머신러닝 임계 미달, 데이터 불신.`;
  } else if (conv7d < o.conversionsTrustedMin) {
    level = "learning";
    reason = `7일 전환 ${conv7d}건 (학습 단계, < ${o.conversionsTrustedMin}). 보수적 운영.`;
  } else {
    // trusted 후보. decaying 체크.
    if (
      prevRoas7d !== null &&
      prevRoas7d > 0 &&
      (prevRoas7d - roas7d) / prevRoas7d >= o.decayingDropPct
    ) {
      level = "decaying";
      reason = `이전 7일 ROAS ${prevRoas7d.toFixed(2)} → 최근 ${roas7d.toFixed(2)} (${(((roas7d - prevRoas7d) / prevRoas7d) * 100).toFixed(0)}%). 크리에이티브 피로도 의심.`;
    } else {
      level = "trusted";
      reason = `7일 전환 ${conv7d}건, ROAS ${roas7d.toFixed(2)}. 데이터 신뢰 OK.`;
    }
  }

  return {
    level,
    conversions7d: conv7d,
    spend7d: Math.round(spend7d),
    revenue7d: Math.round(revenue7d),
    roas7d: +roas7d.toFixed(3),
    roas3d: +roas3d.toFixed(3),
    adjustedRoas7d: +adjustedRoas7d.toFixed(3),
    largestOrderShare: +largestShare.toFixed(3),
    prevRoas7d: prevRoas7d !== null ? +prevRoas7d.toFixed(3) : null,
    reason,
  };
}
