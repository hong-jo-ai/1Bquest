"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import RevenueActionsWidget   from "./RevenueActionsWidget";
import RevenueTrendWidget     from "./RevenueTrendWidget";
import BigEventsWidget        from "./BigEventsWidget";
import type { MirroredCampaign } from "./BigEventsWidget";
import {
  SEED_ROUTINES_PAULVICE,
  SEED_GOAL_PAULVICE, SEED_GOAL_HARRIOT,
  SEED_EVENTS_PAULVICE,
} from "./mockData";
import { kstDateStr, kstMonthStr, kstWeekStartStr } from "./dateUtils";
import type {
  RevenueAction, RevenueGoal, BigEvent,
  ChannelRevenueSnapshot, LeverSources,
} from "./types";
import { CHANNELS, type Brand } from "@/lib/multiChannelData";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const BRAND_NAMES: Record<Brand, string> = { paulvice: "폴바이스", harriot: "해리엇" };

function todayLabel(): string {
  const d = new Date();
  const y   = d.getFullYear();
  const m   = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}.${m}.${day} ${WEEKDAYS[d.getDay()]}`;
}

// ── 정규화 ──────────────────────────────────────────────────────────────────

function normalizeRoutines(routines: RevenueAction[]): RevenueAction[] {
  const week  = kstWeekStartStr();
  const month = kstMonthStr();
  return routines.map((r) => {
    const expected = r.cadenceType === "weekly" ? week : month;
    if (r.periodKey !== expected) return { ...r, done: 0, periodKey: expected };
    return r;
  });
}

// ── seed 결정 ──────────────────────────────────────────────────────────────

function seedRoutines(brand: Brand): RevenueAction[] {
  return brand === "paulvice" ? SEED_ROUTINES_PAULVICE : [];
}
function seedGoal(brand: Brand): RevenueGoal {
  return brand === "paulvice" ? SEED_GOAL_PAULVICE : SEED_GOAL_HARRIOT;
}
function seedEvents(brand: Brand): BigEvent[] {
  return brand === "paulvice" ? SEED_EVENTS_PAULVICE : [];
}

// ── 본체 ────────────────────────────────────────────────────────────────────

interface Props {
  brand: Brand;
  /** 상단 판매채널 탭 선택값 — 매출 추이가 이 채널을 따라간다.
   *  같은 화면에서 채널을 바꿔가며 추이를 비교하려고 연동했다(사장님 요청 2026-08-30). */
  activeChannel?: string;
  /** 이번 달(KST) 누적 매출. 브랜드의 모든 채널 합산. */
  monthRevenue: number;
  channelRevenues: ChannelRevenueSnapshot[];
}

export default function TodayHubSection({ brand, monthRevenue, channelRevenues, activeChannel = "all" }: Props) {
  const [label, setLabel] = useState("");
  const [loaded, setLoaded] = useState(false);

  const [routines, setRoutines] = useState<RevenueAction[]>(() => seedRoutines(brand));
  const [goal,     setGoal]     = useState<RevenueGoal>(() => seedGoal(brand));
  const [events,   setEvents]   = useState<BigEvent[]>(() => seedEvents(brand));
  const [mirroredCampaigns, setMirroredCampaigns] = useState<MirroredCampaign[]>([]);
  const [leverSources, setLeverSources] = useState<LeverSources | null>(null);

  const lastSaved = useRef({ routines: "", goal: "", events: "" });

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setLabel(todayLabel()); }, []);

  // 캠페인 미러 — /api/campaigns 에서 진행중/예정 캠페인만 가져와서 빅이벤트 카드처럼 노출
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/campaigns?brand=${brand}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled || !j.ok) return;
        const today = kstDateStr(0);
        type Raw = { id: string; name: string; startDate: string; endDate: string | null; productNos?: number[]; couponCode: string | null };
        const active = ((j.campaigns ?? []) as Raw[])
          .filter((c) => !c.endDate || c.endDate >= today) // 종료된 건 노출 안 함
          .sort((a, b) => a.startDate.localeCompare(b.startDate))
          .map<MirroredCampaign>((c) => ({
            id:           c.id,
            name:         c.name,
            startDate:    c.startDate,
            endDate:      c.endDate,
            productNos:   c.productNos,
            couponCode:   c.couponCode,
            trackerHref:  "#campaigns",
          }));
        setMirroredCampaigns(active);
      })
      .catch(() => { /* 실패해도 위젯 정상 동작 */ });
    return () => { cancelled = true; };
  }, [brand]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/today-hub/lever-sources?brand=${brand}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled || !j.ok) return;
        setLeverSources({
          products: j.products ?? [],
          campaigns: j.campaigns ?? { activeCount: 0, monthlyCount: 0, next: null },
          ads: j.ads ?? { connected: false, error: "응답 없음" },
          content: j.content ?? {
            instagram: { connected: false, error: "응답 없음" },
            threads: { connected: false, error: "응답 없음" },
          },
        });
      })
      .catch(() => {
        if (!cancelled) setLeverSources(null);
      });
    return () => { cancelled = true; };
  }, [brand]);

  const save = useCallback(
    (type: "routines" | "goal" | "events", payload: unknown) => {
      const body: { type: string; payload: unknown; brand?: Brand } = { type, payload };
      body.brand = brand;
      fetch("/api/today-hub", {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      }).catch((e) => console.error("[today-hub] save failed:", e));
    },
    [brand],
  );

  // 초기 로드 — brand 별로 fetch (key={brand} 로 인스턴스가 새로 마운트되어 한 번만 실행)
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/today-hub?brand=${brand}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;

        const rawRoutines = (j.routines ?? seedRoutines(brand)) as RevenueAction[];
        const rawGoal     = (j.goal     ?? seedGoal(brand))     as RevenueGoal;
        const rawEvents   = (j.events   ?? seedEvents(brand))   as BigEvent[];

        const r = normalizeRoutines(rawRoutines);
        const g = rawGoal;
        const e = rawEvents;

        const rStr = JSON.stringify(r);
        const gStr = JSON.stringify(g);
        const eStr = JSON.stringify(e);

        setRoutines(r);
        setGoal(g);
        setEvents(e);
        lastSaved.current = { routines: rStr, goal: gStr, events: eStr };

        if (j.routines === undefined || rStr !== JSON.stringify(rawRoutines)) save("routines", r);
        if (j.goal     === undefined || gStr !== JSON.stringify(rawGoal))     save("goal",     g);
        if (j.events   === undefined || eStr !== JSON.stringify(rawEvents))   save("events",   e);

        setLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        const r = normalizeRoutines(seedRoutines(brand));
        const g = seedGoal(brand);
        const e = seedEvents(brand);
        setRoutines(r); setGoal(g); setEvents(e);
        lastSaved.current = {
          routines: JSON.stringify(r), goal: JSON.stringify(g), events: JSON.stringify(e),
        };
        setLoaded(true);
      });
    return () => { cancelled = true; };
  }, [brand, save]);


  useEffect(() => {
    if (!loaded) return;
    const s = JSON.stringify(routines);
    if (s === lastSaved.current.routines) return;
    lastSaved.current.routines = s;
    save("routines", routines);
  }, [routines, loaded, save]);

  useEffect(() => {
    if (!loaded) return;
    const s = JSON.stringify(goal);
    if (s === lastSaved.current.goal) return;
    lastSaved.current.goal = s;
    save("goal", goal);
  }, [goal, loaded, save]);

  useEffect(() => {
    if (!loaded) return;
    const s = JSON.stringify(events);
    if (s === lastSaved.current.events) return;
    lastSaved.current.events = s;
    save("events", events);
  }, [events, loaded, save]);

  // 빅 이벤트 체크리스트는 BigEventsWidget 안에서 직접 체크한다.
  // 예전엔 오늘 할일 위젯으로 주입했지만, 그 위젯이 /today 보드와 중복이라 대시보드에서 걷어냈다(2026-08-29).

  return (
    <section className="space-y-3 sm:space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2 px-1">
        <h2 className="text-base sm:text-lg font-bold text-zinc-800 dark:text-zinc-100">
          오늘
          {label && (
            <span className="font-medium text-zinc-500 ml-2 text-sm sm:text-base">({label})</span>
          )}
        </h2>
        <span className="text-[11px] text-zinc-400">할 일·일정은 <a href="/today" className="underline">오늘 보드</a>에서</span>
      </div>

      {/* 매출 추이 — 전폭. 예전엔 7/12 칸에 360px 로 박아두고 옆 칸에 위젯 둘을 세로로 쌓아서,
          데스크톱에서 왼쪽 아래가 수백 px 씩 비어 있었다(사장님 지적 2026-08-30).
          채널 탭과 연동되면서 이 그래프를 자주 보게 됐으니 폭도 높이도 키운다. */}
      <div className="h-[300px] sm:h-[380px] xl:h-[420px]">
        <RevenueTrendWidget
          brand={brand}
          brandLabel={BRAND_NAMES[brand]}
          channel={activeChannel}
          channelLabel={CHANNELS.find((c) => c.id === activeChannel)?.name}
          channelColor={CHANNELS.find((c) => c.id === activeChannel)?.color}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-2">
        <RevenueActionsWidget
          routines={routines}
          setRoutines={setRoutines}
          goal={goal}
          setGoal={setGoal}
          currentRevenue={monthRevenue}
          brandLabel={BRAND_NAMES[brand]}
          events={events}
          leverSources={leverSources}
          channelRevenues={channelRevenues}
        />
        <BigEventsWidget
          events={events}
          setEvents={setEvents}
          brandLabel={BRAND_NAMES[brand]}
          mirroredCampaigns={mirroredCampaigns}
        />
      </div>
    </section>
  );
}
