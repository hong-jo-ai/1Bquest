"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import TodayScheduleWidget    from "./TodayScheduleWidget";
import InboxActionWidget      from "./InboxActionWidget";
import TodayTasksWidget       from "./TodayTasksWidget";
import RevenueActionsWidget   from "./RevenueActionsWidget";
import BigEventsWidget        from "./BigEventsWidget";
import {
  SEED_TASKS, SEED_ROUTINES, SEED_GOAL, SEED_EVENTS,
} from "./mockData";
import { kstDateStr, kstMonthStr, kstWeekStartStr, daysUntil } from "./dateUtils";
import type {
  Task, RevenueAction, RevenueGoal, BigEvent, InjectedEventItem,
} from "./types";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function todayLabel(): string {
  const d = new Date();
  const y   = d.getFullYear();
  const m   = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}.${m}.${day} ${WEEKDAYS[d.getDay()]}`;
}

// ── 정규화 ──────────────────────────────────────────────────────────────────

/** 어제 미완료 → 오늘로 이월. 어제 완료된 항목은 화면에서 제외. */
function normalizeTasks(tasks: Task[]): Task[] {
  const today = kstDateStr(0);
  const out: Task[] = [];
  for (const t of tasks) {
    if (t.date === today)            out.push(t);
    else if (t.date < today && !t.done) out.push({ ...t, date: today });
    // 그 외(과거 완료 / 미래 등)는 표시 대상에서 제외
  }
  return out;
}

/** 주/월이 바뀌면 done = 0 으로 리셋하고 periodKey 갱신. */
function normalizeRoutines(routines: RevenueAction[]): RevenueAction[] {
  const week  = kstWeekStartStr();
  const month = kstMonthStr();
  return routines.map((r) => {
    const expected = r.cadenceType === "weekly" ? week : month;
    if (r.periodKey !== expected) return { ...r, done: 0, periodKey: expected };
    return r;
  });
}

/** 월이 바뀌면 current = 0 리셋 (실 매출 연동은 v3). */
function normalizeGoal(goal: RevenueGoal): RevenueGoal {
  const month = kstMonthStr();
  if (goal.monthKey !== month) return { ...goal, current: 0, monthKey: month };
  return goal;
}

// ── 본체 ────────────────────────────────────────────────────────────────────

export default function TodayHubSection() {
  const [label, setLabel] = useState("");
  const [loaded, setLoaded] = useState(false);

  const [tasks,    setTasks]    = useState<Task[]>(SEED_TASKS);
  const [routines, setRoutines] = useState<RevenueAction[]>(SEED_ROUTINES);
  const [goal,     setGoal]     = useState<RevenueGoal>(SEED_GOAL);
  const [events,   setEvents]   = useState<BigEvent[]>(SEED_EVENTS);

  // 마지막으로 서버에 저장한 직렬화 — 동일 값이면 PUT 스킵
  const lastSaved = useRef({
    tasks:    "" as string,
    routines: "" as string,
    goal:     "" as string,
    events:   "" as string,
  });

  // 서버(UTC)/클라(KST) 시간대 차이로 인한 hydration mismatch 방지 — 클라이언트에서만 채움
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setLabel(todayLabel()); }, []);

  const save = useCallback((type: "tasks" | "routines" | "goal" | "events", payload: unknown) => {
    fetch("/api/today-hub", {
      method:  "PUT",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ type, payload }),
    }).catch((e) => console.error("[today-hub] save failed:", e));
  }, []);

  // 초기 로드: 서버 → 정규화 → state 셋팅. 정규화로 값이 바뀐 항목은 즉시 저장.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/today-hub")
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;

        const rawTasks    = (j.tasks    ?? SEED_TASKS)    as Task[];
        const rawRoutines = (j.routines ?? SEED_ROUTINES) as RevenueAction[];
        const rawGoal     = (j.goal     ?? SEED_GOAL)     as RevenueGoal;
        const rawEvents   = (j.events   ?? SEED_EVENTS)   as BigEvent[];

        const t = normalizeTasks(rawTasks);
        const r = normalizeRoutines(rawRoutines);
        const g = normalizeGoal(rawGoal);
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

        // 정규화 결과가 서버 값과 다르거나, 서버에 데이터 없어 seed 사용 시 즉시 저장
        if (j.tasks    === undefined || tStr !== JSON.stringify(rawTasks))    save("tasks",    t);
        if (j.routines === undefined || rStr !== JSON.stringify(rawRoutines)) save("routines", r);
        if (j.goal     === undefined || gStr !== JSON.stringify(rawGoal))     save("goal",     g);
        if (j.events   === undefined || eStr !== JSON.stringify(rawEvents))   save("events",   e);

        setLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        // 네트워크 실패: seed 정규화 후 표시만, 저장은 다음 변경 시 시도
        const t = normalizeTasks(SEED_TASKS);
        const r = normalizeRoutines(SEED_ROUTINES);
        const g = normalizeGoal(SEED_GOAL);
        setTasks(t);
        setRoutines(r);
        setGoal(g);
        setEvents(SEED_EVENTS);
        lastSaved.current = {
          tasks:    JSON.stringify(t),
          routines: JSON.stringify(r),
          goal:     JSON.stringify(g),
          events:   JSON.stringify(SEED_EVENTS),
        };
        setLoaded(true);
      });
    return () => { cancelled = true; };
  }, [save]);

  // 변경 감지 → 자동 저장 (직전 저장값과 동일하면 스킵)
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

  // 빅 이벤트 → 오늘 할일 자동 주입 (오늘 마감 + 지난 미완료)
  const injectedItems = useMemo<InjectedEventItem[]>(() => {
    return events.flatMap((e) => {
      const daysLeft = daysUntil(e.targetDate);
      return e.checklist
        .filter((c) => !c.done && c.dDay >= daysLeft) // 오늘 또는 지남
        .map((c) => ({
          eventId:        e.id,
          eventTitle:     e.title,
          checklistId:    c.id,
          dDay:           c.dDay,
          daysLeftDelta:  daysLeft - c.dDay, // 0 = 오늘, 음수 = 지남
          title:          c.title,
        }));
    });
  }, [events]);

  // injected item 체크박스 → 해당 이벤트 체크리스트 토글
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
        <span className="text-[11px] text-zinc-400">출근 직후 5분 체크</span>
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
          <RevenueActionsWidget routines={routines} setRoutines={setRoutines} goal={goal} />
          <BigEventsWidget events={events} setEvents={setEvents} />
        </div>
      </div>
    </section>
  );
}
