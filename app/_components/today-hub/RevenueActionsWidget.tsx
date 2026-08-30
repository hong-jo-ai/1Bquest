"use client";

import { useMemo, useState } from "react";
import type { ElementType } from "react";
import {
  AlertTriangle, BarChart3, CalendarClock, Flag, Gauge,
  PackagePlus, Pencil, Target, TrendingUp,
} from "lucide-react";
import { daysUntil } from "./dateUtils";
import type {
  BigEvent, ChannelRevenueSnapshot, LeverSources, RevenueAction, RevenueGoal,
} from "./types";

function fmtKRW(n: number) {
  if (n >= 100_000_000) return (n / 100_000_000).toFixed(1) + "억원";
  if (n >= 10_000) return (n / 10_000).toFixed(0) + "만원";
  return n.toLocaleString("ko-KR") + "원";
}

function fmtCompact(n: number) {
  if (n >= 100_000_000) return `${Math.round(n / 100_000_000)}억`;
  if (n >= 10_000) return `${Math.round(n / 10_000)}만`;
  return n.toLocaleString("ko-KR");
}

function monthProgressPct() {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const day = now.getUTCDate();
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return Math.min(100, Math.round((day / last) * 100));
}

function quarterLabel() {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const q = Math.floor(now.getUTCMonth() / 3) + 1;
  return `${now.getUTCFullYear()} Q${q}`;
}

function currentMonthKey() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 7);
}

function currentDateKey() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const PRODUCT_FAST_LEAD_DAYS = 150;
const PRODUCT_NORMAL_LEAD_DAYS = 180;
const PRODUCT_PIPELINE_TARGET_6M = 2;
const MONTHLY_CONTENT_POST_TARGET = 8;

type LeverKey = "product" | "campaign" | "ads" | "content" | "channel";

const LEVERS: Record<LeverKey, { label: string; icon: ElementType; tone: string; words: RegExp }> = {
  product: {
    label: "상품",
    icon: PackagePlus,
    tone: "text-violet-700 bg-violet-50 border-violet-100 dark:text-violet-300 dark:bg-violet-950/30 dark:border-violet-900/50",
    words: /상품|신상|신규|샘플|디자인|발주|리오더|재고|컬러|스트랩|상세페이지/,
  },
  campaign: {
    label: "캠페인",
    icon: CalendarClock,
    tone: "text-rose-700 bg-rose-50 border-rose-100 dark:text-rose-300 dark:bg-rose-950/30 dark:border-rose-900/50",
    words: /공구|공동구매|협찬|인플루언서|컨택|파트너|콜라보|캠페인/,
  },
  ads: {
    label: "광고",
    icon: Gauge,
    tone: "text-blue-700 bg-blue-50 border-blue-100 dark:text-blue-300 dark:bg-blue-950/30 dark:border-blue-900/50",
    words: /광고|Meta|ROAS|소재|CPC|예산|리타겟|메타/i,
  },
  content: {
    label: "콘텐츠",
    icon: BarChart3,
    tone: "text-pink-700 bg-pink-50 border-pink-100 dark:text-pink-300 dark:bg-pink-950/30 dark:border-pink-900/50",
    words: /콘텐츠|인스타|릴스|카피|촬영|게시|브랜드|스토리/,
  },
  channel: {
    label: "채널",
    icon: TrendingUp,
    tone: "text-emerald-700 bg-emerald-50 border-emerald-100 dark:text-emerald-300 dark:bg-emerald-950/30 dark:border-emerald-900/50",
    words: /카카오|W컨셉|무신사|29|면세|채널|노출|입점|스마트스토어/,
  },
};

function inferLever(title: string): LeverKey {
  const entries = Object.entries(LEVERS) as Array<[LeverKey, typeof LEVERS[LeverKey]]>;
  return entries.find(([, v]) => v.words.test(title))?.[0] ?? "channel";
}

function isCampaignEvent(title: string) {
  return /공구|공동구매|협찬|인플루언서|콜라보|캠페인|프로모션|이벤트/i.test(title);
}

function isProductEvent(title: string) {
  return /상품|신상|신규|출시|샘플|디자인|발주|리오더|재고|컬러|스트랩/i.test(title);
}

function addDaysKst(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function normalizeGoal(goal: RevenueGoal): Required<RevenueGoal> {
  return {
    target: goal.target || 80_000_000,
    annualProfitTarget: goal.annualProfitTarget ?? 400_000_000,
    monthlyProfitTarget: goal.monthlyProfitTarget ?? 33_333_333,
    monthlyUnitsTarget: goal.monthlyUnitsTarget ?? 1_000,
    annualLaunchTarget: Math.max(goal.annualLaunchTarget ?? 4, 4),
    monthlyCampaignTarget: goal.monthlyCampaignTarget ?? 2,
  };
}

interface Props {
  routines: RevenueAction[];
  setRoutines: React.Dispatch<React.SetStateAction<RevenueAction[]>>;
  goal: RevenueGoal;
  setGoal: React.Dispatch<React.SetStateAction<RevenueGoal>>;
  currentRevenue: number;
  brandLabel: string;
  events: BigEvent[];
  leverSources: LeverSources | null;
  channelRevenues: ChannelRevenueSnapshot[];
}

type EventSnapshot = {
  event: BigEvent;
  daysLeft: number;
  total: number;
  done: number;
  pct: number;
  lever: LeverKey;
};

type WeeklyAction = {
  title: string;
  source: string;
  detail: string;
  tone: "risk" | "review" | "plan";
};

export default function RevenueActionsWidget({
  goal, setGoal, currentRevenue, brandLabel, events, leverSources, channelRevenues,
}: Props) {
  const resolvedGoal = normalizeGoal(goal);
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalDraft, setGoalDraft] = useState<string>(String(Math.round(resolvedGoal.target / 10_000)));
  const [todayKey] = useState(() => currentDateKey());

  const revenuePct = resolvedGoal.target > 0
    ? Math.min(100, Math.round((currentRevenue / resolvedGoal.target) * 100))
    : 0;
  const estimatedProfit = Math.round(currentRevenue * 0.42);
  const profitPct = Math.min(100, Math.round((estimatedProfit / resolvedGoal.monthlyProfitTarget) * 100));
  const estimatedUnits = Math.round(currentRevenue / 82_000);
  const unitsPct = Math.min(100, Math.round((estimatedUnits / resolvedGoal.monthlyUnitsTarget) * 100));
  const expectedPct = monthProgressPct();
  const monthKey = currentMonthKey();

  const eventSnapshots = useMemo<EventSnapshot[]>(() => {
    return [...events]
      .map((event) => {
        const daysLeft = daysUntil(event.targetDate);
        const total = event.checklist.length;
        const done = event.checklist.filter((c) => c.done).length;
        return {
          event,
          daysLeft,
          total,
          done,
          pct: total > 0 ? Math.round((done / total) * 100) : 0,
          lever: inferLever(event.title),
        };
      })
      .sort((a, b) => a.daysLeft - b.daysLeft);
  }, [events]);

  const upcomingEvents = useMemo(
    () => eventSnapshots.filter((snapshot) => snapshot.daysLeft >= 0),
    [eventSnapshots],
  );

  const nextEvent = upcomingEvents[0] ?? null;

  const recentEndedEvent = useMemo(() => {
    return eventSnapshots
      .filter((snapshot) => snapshot.daysLeft < 0 && snapshot.daysLeft >= -30)
      .sort((a, b) => b.daysLeft - a.daysLeft)[0] ?? null;
  }, [eventSnapshots]);

  const monthlyCampaignCount = useMemo(() => {
    const eventCardCount = eventSnapshots.filter((snapshot) =>
      snapshot.event.targetDate.startsWith(monthKey) && isCampaignEvent(snapshot.event.title)
    ).length;
    return Math.max(eventCardCount, leverSources?.campaigns.monthlyCount ?? 0);
  }, [eventSnapshots, leverSources?.campaigns.monthlyCount, monthKey]);

  const topChannel = useMemo(() => {
    return [...channelRevenues].sort((a, b) => b.monthRevenue - a.monthRevenue)[0] ?? null;
  }, [channelRevenues]);

  const productPipeline = useMemo(() => {
    const sixMonthCutoff = addDaysKst(todayKey, PRODUCT_NORMAL_LEAD_DAYS);
    const products = leverSources?.products ?? [];
    const launchesInSixMonths = products.filter((product) =>
      product.launchDate !== null && product.launchDate >= todayKey && product.launchDate <= sixMonthCutoff
    );
    return {
      today: todayKey,
      sixMonthCutoff,
      products,
      launchesInSixMonths,
      coveragePct: Math.min(100, Math.round((launchesInSixMonths.length / PRODUCT_PIPELINE_TARGET_6M) * 100)),
      shortfall: Math.max(0, PRODUCT_PIPELINE_TARGET_6M - launchesInSixMonths.length),
    };
  }, [leverSources?.products, todayKey]);

  const connectedContentCount = (leverSources?.content.instagram.connected ? 1 : 0)
    + (leverSources?.content.threads.connected ? 1 : 0);

  const contentPerformance = useMemo(() => {
    const instagram = leverSources?.content.instagram;
    const threads = leverSources?.content.threads;
    const posts = (instagram?.postsThisMonth ?? 0) + (threads?.postsThisMonth ?? 0);
    const engagements = (instagram?.engagements ?? 0) + (threads?.likes ?? 0) + (threads?.replies ?? 0);
    return {
      posts,
      engagements,
      views: threads?.views ?? 0,
      pct: Math.min(100, Math.round((posts / MONTHLY_CONTENT_POST_TARGET) * 100)),
    };
  }, [leverSources?.content.instagram, leverSources?.content.threads]);

  const weeklyActions = useMemo<WeeklyAction[]>(() => {
    const actions: WeeklyAction[] = [];
    if (revenuePct + 8 < expectedPct) {
      actions.push({
        title: "매출 회복 레버 1개 확정",
        source: "매출 속도",
        detail: `월 매출 ${revenuePct}% / 시간 ${expectedPct}%. 광고 증액, 공구 추가, 채널 프로모션 중 하나를 선택해야 함.`,
        tone: "risk",
      });
    }
    if (!nextEvent) {
      actions.push({
        title: "다음 이벤트 카드 등록",
        source: "이벤트 카드",
        detail: "예정된 출시/공구/프로모션이 없어서 성장 운영판이 다음 액션을 계산할 기준이 부족함.",
        tone: "plan",
      });
    }
    if (monthlyCampaignCount < resolvedGoal.monthlyCampaignTarget) {
      actions.push({
        title: "이번 달 캠페인 공백 메우기",
        source: "캠페인 트래커",
        detail: `캠페인 ${monthlyCampaignCount}/${resolvedGoal.monthlyCampaignTarget}. 캠페인 트래커 또는 이벤트 카드에 실제 일정을 등록해야 함.`,
        tone: "plan",
      });
    }
    if (leverSources?.campaigns.performance?.connected === false && leverSources.campaigns.performance.warnings.length > 0) {
      actions.push({
        title: "캠페인 성과 원천 연결",
        source: "캠페인 매출",
        detail: leverSources.campaigns.performance.warnings[0],
        tone: "plan",
      });
    }
    if ((leverSources?.products.length ?? 0) === 0 && !upcomingEvents.some((snapshot) => isProductEvent(snapshot.event.title))) {
      actions.push({
        title: "다음 상품/리오더 의사결정",
        source: "신제품 로드맵",
        detail: `분기 1회 출시 목표인데 최소 ${Math.round(PRODUCT_FAST_LEAD_DAYS / 30)}~${Math.round(PRODUCT_NORMAL_LEAD_DAYS / 30)}개월 리드타임을 고려한 신제품 로드맵이 비어 있음.`,
        tone: "plan",
      });
    } else if (productPipeline.shortfall > 0) {
      actions.push({
        title: "6개월 제품 파이프라인 보강",
        source: "제품 리드타임",
        detail: `분기 1회 출시를 유지하려면 6개월 안 출시/입고 예정 2개가 필요함. 현재 ${productPipeline.launchesInSixMonths.length}/2개.`,
        tone: "plan",
      });
    }
    if (leverSources?.ads.connected === false) {
      actions.push({
        title: "Meta 광고 데이터 연결 복구",
        source: "Meta API",
        detail: leverSources.ads.error ? `광고 레버 미연동: ${leverSources.ads.error}` : "광고비/ROAS를 읽지 못해 광고 레버 판단 불가.",
        tone: "plan",
      });
    }
    if (leverSources && connectedContentCount === 0) {
      actions.push({
        title: "콘텐츠 데이터 연결",
        source: "Instagram/Threads",
        detail: "인스타그램 또는 Threads 게시 데이터가 연결되지 않아 콘텐츠 레버 판단 불가.",
        tone: "plan",
      });
    } else if (leverSources && contentPerformance.posts < MONTHLY_CONTENT_POST_TARGET) {
      actions.push({
        title: "콘텐츠 발행량 보강",
        source: "콘텐츠 성과",
        detail: `이번 달 IG+Threads 게시 ${contentPerformance.posts}/${MONTHLY_CONTENT_POST_TARGET}건. 반응 ${contentPerformance.engagements.toLocaleString("ko-KR")}건.`,
        tone: "plan",
      });
    }
    if (recentEndedEvent) {
      actions.push({
        title: "종료 이벤트 회고 및 후속 결정",
        source: recentEndedEvent.event.title,
        detail: "성과, 재고 소진, 고객 반응을 보고 리오더/재공구/광고 재활용 여부를 결정.",
        tone: "review",
      });
    }
    return actions.slice(0, 3);
  }, [
    expectedPct,
    monthlyCampaignCount,
    nextEvent,
    recentEndedEvent,
    resolvedGoal.monthlyCampaignTarget,
    revenuePct,
    upcomingEvents,
    leverSources,
    connectedContentCount,
    productPipeline,
    contentPerformance,
  ]);

  const leverHealth = useMemo(() => {
    const nextProduct = upcomingEvents.find((snapshot) => isProductEvent(snapshot.event.title));
    const nextCampaign = upcomingEvents.find((snapshot) => isCampaignEvent(snapshot.event.title));
    const roadmapProduct = leverSources?.products[0] ?? null;
    const productPct = roadmapProduct && roadmapProduct.totalMilestones > 0
      ? productPipeline.coveragePct
      : nextProduct ? nextProduct.pct : 0;
    const ads = leverSources?.ads ?? null;
    const instagram = leverSources?.content.instagram ?? null;
    const threads = leverSources?.content.threads ?? null;
    const campaignPerformance = leverSources?.campaigns.performance ?? null;
    const channelPct = currentRevenue > 0 && topChannel
      ? Math.min(100, Math.round((topChannel.monthRevenue / currentRevenue) * 100))
      : 0;

    return {
      product: {
        value: roadmapProduct ? `${productPipeline.launchesInSixMonths.length}/2` : nextProduct ? `D-${nextProduct.daysLeft}` : "공백",
        detail: roadmapProduct
          ? `6개월 파이프라인 · ${roadmapProduct.name}${roadmapProduct.launchDate ? ` ${roadmapProduct.launchDate}` : ""}`
          : nextProduct ? nextProduct.event.title : "신제품 로드맵/출시 이벤트 없음",
        pct: productPct,
      },
      campaign: {
        value: campaignPerformance?.connected
          ? fmtCompact(campaignPerformance.revenue)
          : `${monthlyCampaignCount}/${resolvedGoal.monthlyCampaignTarget}`,
        detail: campaignPerformance?.connected
          ? `주문 ${campaignPerformance.ordersCount}건 · 측정 캠페인 ${campaignPerformance.campaignsMeasured}개`
          : campaignPerformance?.warnings?.[0] ?? leverSources?.campaigns.next?.name ?? nextCampaign?.event.title ?? "캠페인 트래커/이벤트 카드 없음",
        pct: campaignPerformance?.connected
          ? Math.min(100, Math.round((campaignPerformance.ordersCount / 10) * 100))
          : Math.min(100, Math.round((monthlyCampaignCount / resolvedGoal.monthlyCampaignTarget) * 100)),
      },
      ads: {
        value: !ads ? "확인중" : ads.connected ? `${(ads.roas ?? 0).toFixed(1)}x` : "미연동",
        detail: !ads
          ? "Meta 광고 데이터 확인 중"
          : ads.connected
            ? `이번 달 지출 ${fmtKRW(ads.spend ?? 0)} · 구매 ${ads.purchaseCount ?? 0}건`
            : `Meta API 미연동: ${ads.error ?? "토큰/계정 확인 필요"}`,
        pct: ads?.connected ? Math.min(100, Math.round(((ads.roas ?? 0) / 3) * 100)) : 0,
      },
      content: {
        value: !leverSources ? "확인중" : `${contentPerformance.posts}건`,
        detail: !leverSources
          ? "콘텐츠 데이터 확인 중"
          : instagram?.connected
            ? `IG ${instagram.postsThisMonth ?? 0}건/${instagram.engagements ?? 0}반응 · Threads ${threads?.postsThisMonth ?? 0}건/${threads?.views ?? 0}조회`
            : `Instagram 미연동${threads?.connected ? ` · Threads ${threads.postsThisMonth ?? 0}건` : ""}`,
        pct: contentPerformance.pct,
      },
      channel: {
        value: topChannel && topChannel.monthRevenue > 0 ? fmtCompact(topChannel.monthRevenue) : "0원",
        detail: topChannel && topChannel.monthRevenue > 0
          ? `이번 달 1위 채널: ${topChannel.name}`
          : "이번 달 채널 매출 데이터 없음",
        pct: channelPct,
      },
    } satisfies Record<LeverKey, { value: string; detail: string; pct: number }>;
  }, [
    currentRevenue,
    leverSources,
    monthlyCampaignCount,
    productPipeline,
    resolvedGoal.monthlyCampaignTarget,
    topChannel,
    upcomingEvents,
    contentPerformance,
  ]);

  const bottlenecks = useMemo(() => {
    const items: Array<{ tone: string; text: string }> = [];
    for (const snapshot of eventSnapshots) {
      for (const c of snapshot.event.checklist) {
        const delta = snapshot.daysLeft - c.dDay;
        if (!c.done && delta < 0) items.push({ tone: "overdue", text: `${snapshot.event.title}: ${c.title}` });
      }
    }
    if (revenuePct + 8 < expectedPct) {
      items.push({ tone: "risk", text: `월 매출 속도 ${revenuePct}% / 시간 경과 ${expectedPct}%` });
    }
    if (monthlyCampaignCount < resolvedGoal.monthlyCampaignTarget) {
      items.push({ tone: "plan", text: `이번 달 캠페인 ${monthlyCampaignCount}/${resolvedGoal.monthlyCampaignTarget}` });
    }
    if (productPipeline.shortfall > 0) {
      items.push({ tone: "plan", text: `6개월 제품 파이프라인 ${productPipeline.launchesInSixMonths.length}/2` });
    }
    if (leverSources?.campaigns.performance?.connected === false && leverSources.campaigns.performance.warnings.length > 0) {
      items.push({ tone: "plan", text: "캠페인 매출 성과 미연동" });
    }
    if (leverSources?.ads.connected === false) {
      items.push({ tone: "plan", text: `Meta 광고 미연동: ${leverSources.ads.error ?? "토큰/계정 확인 필요"}` });
    }
    if (leverSources && connectedContentCount === 0) {
      items.push({ tone: "plan", text: "콘텐츠 데이터 미연동" });
    } else if (leverSources && contentPerformance.posts < MONTHLY_CONTENT_POST_TARGET) {
      items.push({ tone: "plan", text: `콘텐츠 게시 ${contentPerformance.posts}/${MONTHLY_CONTENT_POST_TARGET}` });
    }
    if (!nextEvent) {
      items.push({ tone: "plan", text: "다가오는 이벤트 카드 없음" });
    }
    if (recentEndedEvent) {
      items.push({ tone: "review", text: `${recentEndedEvent.event.title} 회고 필요` });
    }
    return items.slice(0, 4);
  }, [
    eventSnapshots,
    expectedPct,
    monthlyCampaignCount,
    nextEvent,
    recentEndedEvent,
    resolvedGoal.monthlyCampaignTarget,
    revenuePct,
    leverSources,
    connectedContentCount,
    productPipeline,
    contentPerformance,
  ]);

  const startGoalEdit = () => {
    setGoalDraft(String(Math.round(resolvedGoal.target / 10_000)));
    setEditingGoal(true);
  };

  const saveGoalEdit = () => {
    const n = parseInt(goalDraft, 10);
    if (Number.isFinite(n) && n >= 0) {
      setGoal({ ...resolvedGoal, target: n * 10_000 });
    }
    setEditingGoal(false);
  };

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 overflow-hidden h-full">
      <div className="px-5 py-3 border-b border-zinc-100 dark:border-zinc-800 flex items-center gap-2.5">
        <div className="w-7 h-7 bg-zinc-900 dark:bg-zinc-100 rounded-lg flex items-center justify-center text-white dark:text-zinc-900 shrink-0">
          <Flag size={13} />
        </div>
        <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 flex-1">성장 운영판</h3>
        <span className="text-[10px] font-bold text-zinc-600 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded-full shrink-0">{brandLabel} 기준</span>
      </div>

      <div className="p-4 space-y-3">
        {/* ① 판정 한 줄 — 이 판이 답해야 할 첫 질문은 "되고 있나" 하나다.
            예전엔 목표카드 3개·진행바 3개·분기일정·레버 4개를 10px 글씨로 동시에 늘어놓아
            무엇도 눈에 안 들어왔다(사장님 지적 2026-08-30). 판정을 크게 하나만 남기고 나머지는 접는다. */}
        <div className="rounded-xl border border-zinc-200 p-3.5 dark:border-zinc-800">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] text-zinc-500">이번 달 {brandLabel} 매출</p>
              <p className="mt-1 text-[26px] font-bold leading-none tabular-nums text-zinc-900 dark:text-zinc-50">
                {fmtKRW(currentRevenue)}
              </p>
              <p className="mt-1.5 text-[11px] text-zinc-500">
                목표{" "}
                {editingGoal ? (
                  <input
                    type="number" min={0} value={goalDraft}
                    onChange={(e) => setGoalDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") saveGoalEdit(); if (e.key === "Escape") setEditingGoal(false); }}
                    onBlur={saveGoalEdit}
                    autoFocus
                    className="w-16 rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-[11px] tabular-nums dark:border-zinc-700 dark:bg-zinc-800"
                  />
                ) : (
                  <button onClick={startGoalEdit} className="group inline-flex items-center gap-1 font-semibold text-zinc-700 hover:text-zinc-900 dark:text-zinc-300">
                    {fmtKRW(resolvedGoal.target)}
                    <Pencil size={9} className="opacity-0 transition group-hover:opacity-100" />
                  </button>
                )}
                {" · "}
                {resolvedGoal.target > currentRevenue
                  ? `${fmtKRW(resolvedGoal.target - currentRevenue)} 남음`
                  : "달성"}
              </p>
            </div>
            <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${
              revenuePct >= expectedPct
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
            }`}>
              {revenuePct >= expectedPct ? "순조" : `${expectedPct - revenuePct}%p 뒤처짐`}
            </span>
          </div>

          {/* 진행바 위의 세로선 = 오늘 날짜 기준으로 있어야 할 위치. 이 하나로 페이스가 읽힌다. */}
          <div className="relative mt-3 h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
            <div
              className={`h-full transition-all ${revenuePct >= expectedPct ? "bg-emerald-500" : "bg-amber-500"}`}
              style={{ width: `${Math.min(100, Math.max(0, revenuePct))}%` }}
            />
            <div
              className="absolute top-0 h-full w-0.5 bg-zinc-900 dark:bg-zinc-100"
              style={{ left: `${Math.min(100, Math.max(0, expectedPct))}%` }}
              title={`오늘 기준 있어야 할 위치 ${expectedPct}%`}
            />
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-zinc-400">
            <span>{revenuePct}% 달성</span>
            <span>오늘 기준 {expectedPct}%</span>
          </div>
        </div>

        {/* ② 지금 할 일 — 최대 3개. 읽히는 크기로. */}
        <div>
          <p className="mb-1.5 px-0.5 text-[11px] font-semibold text-zinc-500">지금 할 일</p>
          {weeklyActions.length === 0 && bottlenecks.length === 0 ? (
            <p className="rounded-xl bg-zinc-50 px-3 py-3 text-xs text-zinc-400 dark:bg-zinc-800/50">
              자동으로 잡히는 과제가 없습니다. 페이스가 맞고 지연 신호도 없다는 뜻입니다.
            </p>
          ) : (
            <div className="space-y-1.5">
              {weeklyActions.slice(0, 3).map((action) => (
                <div key={`${action.source}-${action.title}`} className="rounded-xl border border-zinc-200 p-2.5 dark:border-zinc-800">
                  <div className="flex items-center gap-2">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      action.tone === "risk" ? "bg-amber-500" : action.tone === "review" ? "bg-violet-500" : "bg-zinc-400"
                    }`} />
                    <p className="min-w-0 flex-1 text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">{action.title}</p>
                    <span className="shrink-0 text-[10px] text-zinc-400">{action.source}</span>
                  </div>
                  <p className="mt-1 pl-3.5 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">{action.detail}</p>
                </div>
              ))}
              {bottlenecks.slice(0, 3 - Math.min(3, weeklyActions.length)).map((item, idx) => (
                <div key={`bn-${idx}`} className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/60 p-2.5 dark:border-amber-900/50 dark:bg-amber-950/20">
                  <AlertTriangle size={13} className="shrink-0 text-amber-600 dark:text-amber-400" />
                  <p className="min-w-0 flex-1 text-[12px] text-zinc-800 dark:text-zinc-100">{item.text}</p>
                </div>
              ))}
            </div>
          )}
          {weeklyActions.length > 3 && (
            <p className="mt-1 px-0.5 text-[10px] text-zinc-400">+{weeklyActions.length - 3}건 더 — 아래 자세히에서</p>
          )}
        </div>

        {/* ③ 나머지 지표는 접는다. 필요할 때만 열어 본다. */}
        <details className="group rounded-xl border border-zinc-200 dark:border-zinc-800">
          <summary className="cursor-pointer list-none px-3 py-2.5 text-[11px] font-semibold text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
            자세히 — 목표·일정·레버
            <span className="float-right text-zinc-400 transition group-open:rotate-180">⌄</span>
          </summary>
          <div className="space-y-3 border-t border-zinc-100 p-3 dark:border-zinc-800">
            <div className="grid grid-cols-3 gap-2">
              <MetricCard label="연 순이익" value={fmtCompact(resolvedGoal.annualProfitTarget)} sub={`월 ${fmtCompact(resolvedGoal.monthlyProfitTarget)}`} />
              <MetricCard label="월 판매량" value={`${resolvedGoal.monthlyUnitsTarget.toLocaleString("ko-KR")}개`} sub={`현재 ${estimatedUnits.toLocaleString("ko-KR")}개`} />
              <MetricCard label="연 출시" value={`${resolvedGoal.annualLaunchTarget}회`} sub={`월 캠페인 ${resolvedGoal.monthlyCampaignTarget}회`} />
            </div>

            <div>
              <Progress label="추정 순이익" value={profitPct} detail={fmtKRW(estimatedProfit)} />
              <Progress label="판매량" value={unitsPct} detail={`${estimatedUnits.toLocaleString("ko-KR")}개`} />
            </div>

            <div className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[11px] font-semibold text-zinc-500">{quarterLabel()} 핵심 일정</p>
                <Target size={13} className="text-zinc-400" />
              </div>
              {nextEvent ? (
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">{nextEvent.event.title}</p>
                    <span className={`shrink-0 text-[10px] font-bold ${nextEvent.daysLeft < 0 ? "text-rose-600" : "text-violet-600 dark:text-violet-400"}`}>
                      {nextEvent.daysLeft < 0 ? `D+${Math.abs(nextEvent.daysLeft)}` : `D-${nextEvent.daysLeft}`}
                    </span>
                  </div>
                  <div className="mt-2">
                    <Progress label="준비율" value={nextEvent.pct} detail={`${nextEvent.done}/${nextEvent.total}`} />
                  </div>
                </div>
              ) : (
                <p className="py-2 text-xs text-zinc-400">예정된 이벤트 카드 없음</p>
              )}
            </div>

            <div>
              <p className="mb-2 text-[11px] font-semibold text-zinc-500">자동 성장 레버 <span className="font-normal text-zinc-400">· 실데이터</span></p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {(Object.keys(LEVERS) as LeverKey[]).map((key) => {
                  const meta = LEVERS[key];
                  const Icon = meta.icon;
                  const health = leverHealth[key];
                  return (
                    <div key={key} className={`rounded-lg border p-2 ${meta.tone}`}>
                      <div className="flex items-center gap-1.5">
                        <Icon size={12} className="shrink-0" />
                        <span className="flex-1 text-[11px] font-bold">{meta.label}</span>
                        <span className="text-[10px] font-semibold tabular-nums">{health.value}</span>
                      </div>
                      <p className="mt-1 truncate text-[10px] leading-snug opacity-80">{health.detail}</p>
                      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/60 dark:bg-zinc-900/40">
                        <div className="h-full bg-current opacity-70" style={{ width: `${Math.min(100, Math.max(0, health.pct))}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {weeklyActions.length > 3 && (
              <div className="space-y-1.5">
                {weeklyActions.slice(3).map((a) => (
                  <div key={`${a.source}-${a.title}`} className="rounded-lg bg-zinc-50 p-2 dark:bg-zinc-800/50">
                    <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-100">{a.title}</p>
                    <p className="mt-0.5 text-[10px] text-zinc-500">{a.detail}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </details>
      </div>
    </div>
  );
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-2 min-w-0">
      <p className="text-[10px] font-semibold text-zinc-500 truncate">{label}</p>
      <p className="text-sm font-bold text-zinc-900 dark:text-zinc-50 tabular-nums truncate mt-0.5">{value}</p>
      <p className="text-[10px] text-zinc-400 truncate mt-0.5">{sub}</p>
    </div>
  );
}

function Progress({ label, value, detail }: { label: string; value: number; detail?: string }) {
  return (
    <div className="mt-2 first:mt-0">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-[10px] font-medium text-zinc-500">{label}</span>
        <span className="text-[10px] text-zinc-500 tabular-nums">{detail ? `${detail} · ` : ""}{value}%</span>
      </div>
      <div className="h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
        <div className="h-full bg-zinc-900 dark:bg-zinc-100 transition-all" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      </div>
    </div>
  );
}
