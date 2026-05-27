/**
 * 성장 조언 엔진 — 계정 전체를 진단해 매출·전환을 끌어올릴 실행 가능한 조언을 생성.
 *
 * 개별 세트 예산 추천(ruleEngine)과 별개로, 포트폴리오 수준의 구조적 기회를 본다:
 *   - 리타게팅 공백 (신규유입만 운영)
 *   - 전환율 저조 (클릭 대비 구매 약함)
 *   - 소재 유형 편중 (영상만 / 이미지만)
 *   - 활성 광고 과소 (테스트 여력 없음)
 *   - 수익 구간인데 지출 과소 (확장 여력)
 *   - 학습 미완 세트 파편화 (통합 권장)
 *
 * DB만 읽음 (Meta 토큰 불필요) — 페이지 로드 시 빠르게 응답.
 */
import { createClient } from "@supabase/supabase-js";
import { getMarginConfig, resolveThresholds } from "./marginConfig";
import { buildIntegrationAdvice } from "./integrationAdvisor";

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export type AdviceSeverity = "warning" | "opportunity" | "info";

export interface GrowthAdvice {
  id:          string;
  severity:    AdviceSeverity;
  title:       string;
  reason:      string;
  actionGuide: string;
  metrics:     Array<{ label: string; value: string }>;
}

export interface GrowthAdviceResult {
  generatedAt:    string;
  activeSetCount: number;
  advices:        GrowthAdvice[];
}

const POLICY = {
  MIN_ACTIVE_SETS:    2,       // 미만이면 다양성 경고
  MIN_CLICKS_FOR_CVR: 80,      // CVR 판단 최소 표본(7일 클릭)
  LOW_CVR:            0.015,   // 클릭→구매 1.5% 미만이면 저조
} as const;

function fmtKRW(n: number) {
  if (n >= 100_000_000) return (n / 100_000_000).toFixed(1) + "억";
  if (n >= 10_000) return (n / 10_000).toFixed(1) + "만";
  return Math.round(n).toLocaleString("ko-KR");
}
const pct = (v: number) => (v * 100).toFixed(2) + "%";
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);

const SEVERITY_RANK: Record<AdviceSeverity, number> = { warning: 0, opportunity: 1, info: 2 };

export async function buildGrowthAdvice(): Promise<GrowthAdviceResult> {
  const generatedAt = new Date().toISOString();
  const db = getDb();
  if (!db) return { generatedAt, activeSetCount: 0, advices: [] };

  const { data: adsRaw } = await db
    .from("mads_ad_sets")
    .select("meta_adset_id, name, campaign_name, campaign_objective, daily_budget, funnel_stage, creative_formats")
    .eq("status", "ACTIVE");
  const ads = adsRaw ?? [];
  const activeSetCount = ads.length;
  const advices: GrowthAdvice[] = [];

  // ── 활성 광고 0개 ─────────────────────────────────────────────
  if (activeSetCount === 0) {
    advices.push({
      id: "no-active", severity: "warning",
      title: "현재 운영 중인 광고가 없습니다",
      reason: "활성 광고세트가 0개입니다. 광고가 멈춰 있으면 신규 유입도 함께 멈춥니다.",
      actionGuide: "Meta 광고 관리자에서 신규유입 캠페인을 1개 이상 다시 활성화하거나 새로 만드세요.",
      metrics: [{ label: "활성 세트", value: "0개" }],
    });
    return { generatedAt, activeSetCount, advices };
  }

  const ids = ads.map((a) => a.meta_adset_id);

  // 최신 trust per set
  const latestTrust = new Map<string, { trust_level: string; roas_7d: number; conversions_7d: number; spend_7d: number }>();
  {
    const { data: trusts } = await db
      .from("mads_trust_evaluations")
      .select("meta_adset_id, trust_level, roas_7d, conversions_7d, spend_7d, evaluated_at")
      .in("meta_adset_id", ids)
      .order("evaluated_at", { ascending: false });
    for (const t of trusts ?? []) {
      if (!latestTrust.has(t.meta_adset_id)) {
        latestTrust.set(t.meta_adset_id, {
          trust_level: t.trust_level,
          roas_7d: Number(t.roas_7d),
          conversions_7d: t.conversions_7d,
          spend_7d: Number(t.spend_7d),
        });
      }
    }
  }

  // 최근 7일(확정분) 합산 메트릭
  let clicks7d = 0, conv7d = 0, spend7d = 0, rev7d = 0;
  {
    const cutoff = ymd(Date.now() - 7 * 86_400_000);
    const { data: metrics } = await db
      .from("mads_daily_metrics")
      .select("date, clicks, conversions, spend, revenue, is_provisional")
      .in("meta_adset_id", ids)
      .eq("is_provisional", false)
      .gte("date", cutoff);
    for (const m of metrics ?? []) {
      clicks7d += Number(m.clicks ?? 0);
      conv7d   += m.conversions ?? 0;
      spend7d  += Number(m.spend ?? 0);
      rev7d    += Number(m.revenue ?? 0);
    }
  }

  const cfg = await getMarginConfig();
  const th = resolveThresholds(cfg);

  const prospecting = ads.filter((a) => a.funnel_stage === "prospecting");
  const retargeting = ads.filter((a) => a.funnel_stage === "retargeting");
  const formats = new Set<string>();
  for (const a of ads) for (const f of (a.creative_formats ?? [])) formats.add(f);

  const roas7d = spend7d > 0 ? rev7d / spend7d : 0;
  const cvr = clicks7d > 0 ? conv7d / clicks7d : 0;

  // ── 리타게팅 공백 ──────────────────────────────────────────────
  if (prospecting.length >= 1 && retargeting.length === 0) {
    advices.push({
      id: "retargeting-gap", severity: "opportunity",
      title: "리타게팅 광고가 없습니다",
      reason: `신규유입(프로스펙팅) 광고 ${prospecting.length}개가 도는데 리타게팅 광고는 0개입니다. 광고를 보고 방문했지만 구매하지 않은 사람을 다시 잡는 리타게팅은 보통 계정에서 가장 높은 ROAS를 냅니다.`,
      actionGuide: "Meta에서 리타게팅 캠페인을 추가하세요. 모수: 최근 7~14일 '상품 조회·장바구니 담기·인스타/페이지 인게이지'. 신규유입 예산의 20~30%로 시작해 ROAS를 보며 확장하세요.",
      metrics: [{ label: "신규유입", value: `${prospecting.length}개` }, { label: "리타게팅", value: "0개" }],
    });
  }

  // ── 전환율 저조 ────────────────────────────────────────────────
  if (clicks7d >= POLICY.MIN_CLICKS_FOR_CVR && cvr < POLICY.LOW_CVR) {
    advices.push({
      id: "low-cvr", severity: "warning",
      title: "클릭은 많은데 전환이 적습니다",
      reason: `최근 7일 클릭 ${clicks7d.toLocaleString("ko-KR")}건 중 구매 전환은 ${conv7d}건(전환율 ${pct(cvr)}). 클릭은 잘 일어나는데 구매로 이어지지 않습니다 — 광고보다 '클릭 이후'(랜딩·오퍼·신뢰)에 병목이 있을 가능성이 큽니다.`,
      actionGuide: "① 리타게팅으로 재방문 유도 ② 상품 상세 첫 화면에 핵심 혜택·실착/후기·배송·교환 정보 정리 ③ 가격 대비 가치(보증·사은품) 강조 ④ 결제 단계 이탈 점검.",
      metrics: [
        { label: "7일 클릭", value: clicks7d.toLocaleString("ko-KR") },
        { label: "7일 전환", value: `${conv7d}건` },
        { label: "전환율", value: pct(cvr) },
      ],
    });
  }

  // ── 소재 유형 편중 ─────────────────────────────────────────────
  if (formats.size > 0 && !(formats.has("video") && formats.has("image"))) {
    if (formats.has("video")) {
      advices.push({
        id: "creative-add-image", severity: "opportunity",
        title: "광고 소재가 전부 영상입니다",
        reason: "활성 광고 소재가 모두 영상입니다. 이미지(단일/카루셀) 소재는 제작이 빠르고 가격·스펙·후기 같은 정보를 한눈에 전달해, 영상과는 다른 사람에게서 반응을 얻습니다.",
        actionGuide: "대표 상품 정지컷·실착 사진·후기 캡처·스펙 비교 이미지로 단일/카루셀 광고를 1~2개 추가해 영상과 나란히 테스트하세요.",
        metrics: [{ label: "현재 소재", value: "영상만" }],
      });
    } else if (formats.has("image")) {
      advices.push({
        id: "creative-add-video", severity: "opportunity",
        title: "광고 소재가 전부 이미지입니다",
        reason: "활성 광고 소재가 모두 이미지입니다. 영상(릴스/숏폼) 소재는 착용감·움직임·브랜드 무드를 전달하고 도달 단가가 낮은 경우가 많아 신규 도달을 넓힙니다.",
        actionGuide: "숏폼 릴스(착용·언박싱·비포애프터)로 영상 광고를 1~2개 추가해 이미지와 A/B 테스트하세요.",
        metrics: [{ label: "현재 소재", value: "이미지만" }],
      });
    }
  }

  // ── 활성 광고 과소 ─────────────────────────────────────────────
  if (activeSetCount < POLICY.MIN_ACTIVE_SETS) {
    advices.push({
      id: "too-few-sets", severity: "warning",
      title: "활성 광고가 너무 적습니다",
      reason: `현재 활성 광고세트가 ${activeSetCount}개뿐입니다. 한 세트에 의존하면 소재 피로·성과 변동에 그대로 노출되고, 더 나은 타겟·소재 조합을 찾을 테스트 여력이 없습니다.`,
      actionGuide: "소재 또는 타겟을 바꾼 테스트 세트를 1~2개 추가하세요. 같은 캠페인 안에서 시작해 승자에 예산을 몰아주는 방식이 안전합니다.",
      metrics: [{ label: "활성 세트", value: `${activeSetCount}개` }],
    });
  }

  // ── 수익 구간 — 확장 여력 ──────────────────────────────────────
  if (spend7d > 0 && roas7d >= th.roasBase) {
    const dailySpend = spend7d / 7;
    advices.push({
      id: "scale-up", severity: "opportunity",
      title: "수익 구간 — 예산을 키울 때입니다",
      reason: `최근 7일 ROAS ${roas7d.toFixed(2)}배로 손익분기(${th.beRoas}배)와 증액 기준(${th.roasBase}배)을 넘었습니다. 일 지출은 약 ${fmtKRW(dailySpend)}원 수준 — 수익이 나는 광고는 키울수록 매출이 커집니다.`,
      actionGuide: "승자 세트(또는 CBO 캠페인) 예산을 3~5일 간격으로 +20~30%씩 올리며 ROAS가 유지되는 한계까지 확장하세요. 한 번에 2배 이상 올리면 학습이 리셋됩니다.",
      metrics: [
        { label: "7일 ROAS", value: `${roas7d.toFixed(2)}x` },
        { label: "BE ROAS", value: `${th.beRoas}x` },
        { label: "일 지출", value: `${fmtKRW(dailySpend)}원` },
      ],
    });
  }

  // ── 학습 미완 세트 파편화 (통합 권장) ──────────────────────────
  try {
    const integ = await buildIntegrationAdvice();
    if (integ.triggered) {
      advices.push({
        id: "fragmentation", severity: "opportunity",
        title: "학습 미완 세트가 잘게 쪼개져 있습니다",
        reason: integ.reason,
        actionGuide: `성과 좋은 1~2개만 남기고 나머지를 일시중지 → 남긴 세트 예산을 합산값(${fmtKRW(integ.totalDailyBudget)}원) 근처로 올리세요. 동일 캠페인 내 통합이 안전합니다.`,
        metrics: [
          { label: "대상 세트", value: `${integ.smallSetCount}개` },
          { label: "합산 일예산", value: `${fmtKRW(integ.totalDailyBudget)}원` },
          { label: "통합 시 학습도달", value: integ.estDaysToLearning ? `약 ${integ.estDaysToLearning}일` : "-" },
        ],
      });
    }
  } catch { /* 통합 분석 실패는 무시 */ }

  // ── 조언 없음 ──────────────────────────────────────────────────
  if (advices.length === 0) {
    advices.push({
      id: "all-clear", severity: "info",
      title: "지금은 권장 조치가 없습니다",
      reason: `활성 광고 ${activeSetCount}개가 안정적으로 운영 중입니다. 새로운 개선 포인트가 생기면 여기에 표시됩니다.`,
      actionGuide: "현 운영을 유지하면서 '대기 중 추천'의 개별 세트 조정을 검토하세요.",
      metrics: [
        { label: "활성 세트", value: `${activeSetCount}개` },
        { label: "7일 ROAS", value: roas7d > 0 ? `${roas7d.toFixed(2)}x` : "-" },
      ],
    });
  }

  advices.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  return { generatedAt, activeSetCount, advices };
}
