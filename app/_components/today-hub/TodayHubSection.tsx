"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import TodayScheduleWidget    from "./TodayScheduleWidget";
import InboxActionWidget      from "./InboxActionWidget";
import TodayTasksWidget       from "./TodayTasksWidget";
import RevenueActionsWidget   from "./RevenueActionsWidget";
import BigEventsWidget        from "./BigEventsWidget";
import {
  SEED_TASKS,
  SEED_ROUTINES_PAULVICE,
  SEED_GOAL_PAULVICE, SEED_GOAL_HARRIOT,
  SEED_EVENTS_PAULVICE,
} from "./mockData";
import { kstDateStr, kstMonthStr, kstWeekStartStr, daysUntil } from "./dateUtils";
import type {
  Task, RevenueAction, RevenueGoal, BigEvent, InjectedEventItem,
} from "./types";
import type { Brand } from "@/lib/multiChannelData";

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

function normalizeTasks(tasks: Task[]): Task[] {
  const today = kstDateStr(0);
  const out: Task[] = [];
  for (const t of tasks) {
    if (t.date === today)              out.push(t);
    else if (t.date < today && !t.done) out.push({ ...t, date: today });
  }
  return out;
}

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
  /** 이번 달(KST) 누적 매출. 브랜드의 모든 채널 합산. */
  monthRevenue: number;
}

export default function TodayHubSection({ brand, monthRevenue }: Props) {
  const [label, setLabel] = useState("");
  const [loaded, setLoaded] = useState(false);

  const [tasks,    setTasks]    = useState<Task[]>(SEED_TASKS);
  const [routines, setRoutines] = useState<RevenueAction[]>(() => seedRoutines(brand));
  const [goal,     setGoal]     = useState<RevenueGoal>(() => seedGoal(brand));
  const [events,   setEvents]   = useState<BigEvent[]>(() => seedEvents(brand));

  const lastSaved = useRef({ tasks: "", routines: "", goal: "", events: "" });

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setLabel(todayLabel()); }, []);

  const save = useCallback(
    (type: "tasks" | "routines" | "goal" | "events", payload: unknown) => {
      const body: { type: string; payload: unknown; brand?: Brand } = { type, payload };
      if (type !== "tasks") body.brand = brand;
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

        const rawTasks    = (j.tasks    ?? SEED_TASKS)         as Task[];
        const rawRoutines = (j.routines ?? seedRoutines(brand)) as RevenueAction[];
        const rawGoal     = (j.goal     ?? seedGoal(brand))     as RevenueGoal;
        const rawEvents   = (j.events   ?? seedEvents(brand))   as BigEvent[];

        const t = normalizeTasks(rawTasks);
        const r = normalizeRoutines(rawRoutines);
        const g = rawGoal;
        const e = rawEvents;

        const tStr = JSON.stringify(t);
        const rStr = JSON.stringify(r);
        const gStr = JSON.stringify(g);
        const eStr = JSON.stringify(e);

        setTasks(t);
        setRoutines(r);
        setGoal(g);
        setEvents(e);
        lastSaved.current = { tasks: tStr, routines: rStr, goal: gStr, events: eStr };

        if (j.tasks    === undefined || tStr !== JSON.stringify(rawTasks))    save("tasks",    t);
        if (j.routines === undefined || rStr !== JSON.stringify(rawRoutines)) save("routines", r);
        if (j.goal     === undefined || gStr !== JSON.stringify(rawGoal))     save("goal",     g);
        if (j.events   === undefined || eStr !== JSON.stringify(rawEvents))   save("events",   e);

        setLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        const t = normalizeTasks(SEED_TASKS);
        const r = normalizeRoutines(seedRoutines(brand));
        const g = seedGoal(brand);
        const e = seedEvents(brand);
        setTasks(t); setRoutines(r); setGoal(g); setEvents(e);
        lastSaved.current = {
          tasks: JSON.stringify(t), routines: JSON.stringify(r),
          goal:  JSON.stringify(g), events:   JSON.stringify(e),
        };
        setLoaded(true);
      });
    return () => { cancelled = true; };
  }, [brand, save]);

  useEffect(() => {
    if (!loaded) return;
    const s = JSON.stringify(tasks);
    if (s === lastSaved.current.tasks) return;
    lastSaved.current.tasks = s;
    save("tasks", tasks);
  }, [tasks, loaded, save]);

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

  const injectedItems = useMemo<InjectedEventItem[]>(() => {
    return events.flatMap((e) => {
      const daysLeft = daysUntil(e.targetDate);
      return e.checklist
        .filter((c) => !c.done && c.dDay >= daysLeft)
        .map((c) => ({
          eventId:        e.id,
          eventTitle:     e.title,
          checklistId:    c.id,
          dDay:           c.dDay,
          daysLeftDelta:  daysLeft - c.dDay,
          title:          c.title,
        }));
    });
  }, [events]);

  const toggleEventChecklist = useCallback(
    (eventId: string, checklistId: string) => {
      setEvents((prev) =>
        prev.map((e) =>
          e.id !== eventId
            ? e
            : { ...e, checklist: e.checklist.map((c) => (c.id === checklistId ? { ...c, done: !c.done } : c)) }
        )
      );
    },
    []
  );

  return (
    <section className="space-y-3 sm:space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2 px-1">
        <h2 className="text-base sm:text-lg font-bold text-zinc-800 dark:text-zinc-100">
          오늘
          {label && (
            <span className="font-medium text-zinc-500 ml-2 text-sm sm:text-base">({label})</span>
          )}
        </h2>
        <span className="text-[11px] text-zinc-400">출근 직후 5분 체크 · 매출/이벤트는 {BRAND_NAMES[brand]}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 sm:gap-4">
        <div className="lg:col-span-7">
          <TodayTasksWidget
            tasks={tasks}
            setTasks={setTasks}
            injectedItems={injectedItems}
            onToggleInjected={toggleEventChecklist}
          />
        </div>
        <div className="lg:col-span-5 grid grid-cols-1 gap-3 sm:gap-4">
          <TodayScheduleWidget />
          <InboxActionWidget />
          <RevenueActionsWidget
            routines={routines}
            setRoutines={setRoutines}
            goal={goal}
            setGoal={setGoal}
            currentRevenue={monthRevenue}
            brandLabel={BRAND_NAMES[brand]}
          />
          <BigEventsWidget events={events} setEvents={setEvents} brandLabel={BRAND_NAMES[brand]} />
        </div>
      </div>
    </section>
  );
}
