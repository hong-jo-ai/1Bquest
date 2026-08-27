"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CalendarEvent } from "@/lib/today-hub/calendar";
import type { ActivityThread, Domain, Task } from "@/lib/today/types";
import { DOMAINS, DOMAIN_LABEL, REVENUE_DOMAINS } from "@/lib/today/types";
import { daysUntil, kstDateStr, todayLabel } from "@/lib/today/date";

/* ── 도메인 표기 ──────────────────────────────────────────────────────────── */

const CHIP: Record<Domain, string> = {
  paulvice: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  harriot:  "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  ars:      "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  personal: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
};
const HEAD: Record<Domain, string> = {
  paulvice: "border-t-blue-500 text-blue-700 dark:text-blue-300",
  harriot:  "border-t-amber-500 text-amber-700 dark:text-amber-300",
  ars:      "border-t-violet-500 text-violet-700 dark:text-violet-300",
  personal: "border-t-emerald-500 text-emerald-700 dark:text-emerald-300",
};
/** 매출 영역을 넓게. 우선순위를 문구가 아니라 면적으로 말한다. */
const COL_SPAN: Record<Domain, string> = {
  paulvice: "lg:col-span-4",
  harriot:  "lg:col-span-4",
  ars:      "lg:col-span-3",
  personal: "lg:col-span-3",
};

const SIDE_CHIP = "bg-slate-200 text-slate-700 dark:bg-slate-700/50 dark:text-slate-300";

/* ── 우선순위 ────────────────────────────────────────────────────────────── */

/**
 * 마감이 가까울수록·지연될수록 높다. 매출 영역은 가산점.
 * 마감 없는 일은 여기서 절대 못 이긴다 — 그래서 5번 칸을 따로 뺐다(고정석).
 */
function score(t: Task): number {
  let s = 0;
  if (t.due) {
    const d = daysUntil(t.due);
    if (d < 0)       s = 1000 - d * 10;
    else if (d === 0) s = 900;
    else if (d <= 3)  s = 700 - d * 20;
    else              s = 300 - d;
  }
  if (REVENUE_DOMAINS.includes(t.domain)) s += 60;
  return s;
}

function dueLabel(t: Task): { text: string; tone: "late" | "soon" | "none" } {
  if (!t.due) return { text: "", tone: "none" };
  const d = daysUntil(t.due);
  if (d < 0)  return { text: `${-d}일 지연`, tone: "late" };
  if (d === 0) return { text: "오늘 마감", tone: "late" };
  if (d <= 3)  return { text: `D-${d}`, tone: "soon" };
  return { text: `D-${d}`, tone: "none" };
}

const TONE: Record<"late" | "soon" | "none", string> = {
  late: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  soon: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
  none: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

/* ── 컴포넌트 ────────────────────────────────────────────────────────────── */

interface Props {
  events: CalendarEvent[];
  calendarError: string | null;
  threads: ActivityThread[];
  scannedAt: string | null;
  activityError: string | null;
}

export default function TodayBoard({ events, calendarError, threads, scannedAt, activityError }: Props) {
  const [tasks, setTasks]   = useState<Task[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [label, setLabel]   = useState<{ date: string; weekday: string } | null>(null);
  const [inbox, setInbox]   = useState<{ total: number; overdue: number } | null>(null);
  const lastSaved = useRef("");

  // 날짜 라벨은 클라이언트에서 — 서버/클라 시각 차로 인한 hydration 불일치를 피한다.
  useEffect(() => { setLabel(todayLabel()); }, []);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/today/tasks", { cache: "no-store" });
        const j = await r.json();
        if (j.ok && Array.isArray(j.tasks)) {
          setTasks(j.tasks);
          lastSaved.current = JSON.stringify(j.tasks);
        }
      } catch { /* 저장소가 막혀도 화면은 뜬다 */ }
      setLoaded(true);
    })();
    (async () => {
      try {
        const r = await fetch("/api/today-hub/inbox", { cache: "no-store" });
        const j = await r.json();
        if (j.ok && Array.isArray(j.items)) {
          setInbox({
            total:   j.items.length,
            overdue: j.items.filter((i: { overdue?: boolean }) => i.overdue).length,
          });
        }
      } catch { /* 인박스는 없어도 그만 */ }
    })();
  }, []);

  // 변경분만 저장. 첫 로드 직후의 되쓰기를 막으려고 loaded 이후에만 돈다.
  useEffect(() => {
    if (!loaded) return;
    const json = JSON.stringify(tasks);
    if (json === lastSaved.current) return;
    const id = setTimeout(() => {
      lastSaved.current = json;
      fetch("/api/today/tasks", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tasks }),
      }).catch(() => { lastSaved.current = ""; });
    }, 600);
    return () => clearTimeout(id);
  }, [tasks, loaded]);

  const toggle = useCallback((id: string) => {
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  }, []);

  const addTask = useCallback((title: string, domain: Domain, side = false, fromActivity = false) => {
    const t = title.trim();
    if (!t) return;
    setTasks((ts) => [
      ...ts,
      { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, title: t, domain, side, done: false, date: kstDateStr(), fromActivity },
    ]);
  }, []);

  const removeTask = useCallback((id: string) => {
    setTasks((ts) => ts.filter((t) => t.id !== id));
  }, []);

  /* ── 파생값 ───────────────────────────────────────────────────────────── */

  const today = kstDateStr();
  const todayEvents = useMemo(() => events.filter((e) => e.date === today), [events, today]);
  const upcoming = useMemo(
    () => events.filter((e) => e.date > today).slice(0, 4),
    [events, today],
  );

  const { top4, sideSlot } = useMemo(() => {
    const undone = tasks.filter((t) => !t.done);
    const ranked = [...undone].filter((t) => !t.side).sort((a, b) => score(b) - score(a));
    const sideTask = undone.find((t) => t.side);
    // 사이드 할일이 없으면 가장 오래 멈춘 사이드 프로젝트를 제안으로 띄운다.
    const sideThread = threads.filter((t) => t.side).sort((a, b) => b.staleDays - a.staleDays)[0];
    return { top4: ranked.slice(0, 4), sideSlot: sideTask ?? sideThread ?? null };
  }, [tasks, threads]);

  const doneCount = tasks.filter((t) => t.done).length;

  return (
    <main className="mx-auto max-w-[1600px] px-3 pb-24 pt-3 sm:px-6 sm:pt-4">
      {/* ── 1층 · 오늘의 지형 ─────────────────────────────────────────── */}
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-zinc-200 bg-white px-5 py-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-3">
          <h1 className="whitespace-nowrap text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {label ? label.date : " "}
            <span className="ml-2 text-sm font-normal text-zinc-500 dark:text-zinc-400">
              {label?.weekday}
            </span>
          </h1>

          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {calendarError ? (
              <span className="text-zinc-400 dark:text-zinc-500">캘린더 연결 안 됨</span>
            ) : todayEvents.length === 0 ? (
              <span className="rounded border border-dashed border-zinc-300 px-2 py-1 text-zinc-400 dark:border-zinc-700 dark:text-zinc-500">
                오늘 잡힌 일정 없음
              </span>
            ) : (
              todayEvents.map((e) => (
                <span key={e.id} className="rounded bg-teal-50 px-2 py-1 font-medium text-teal-700 ring-1 ring-teal-600/20 dark:bg-teal-900/30 dark:text-teal-300 dark:ring-teal-400/20">
                  {e.time} {e.title}
                </span>
              ))
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {upcoming.map((e) => (
              <span key={e.id} className="rounded-full border border-zinc-300 px-2.5 py-0.5 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
                {e.title} <span className="font-mono">D-{daysUntil(e.date)}</span>
              </span>
            ))}
          </div>
        </div>

        <ProgressRing done={doneCount} total={tasks.length} />
      </section>

      {/* ── 2층 · 오늘 반드시 ─────────────────────────────────────────── */}
      <section className="mt-3 rounded-lg border border-zinc-200 border-l-4 border-l-teal-600 bg-white px-5 py-4 dark:border-zinc-800 dark:border-l-teal-500 dark:bg-zinc-900">
        <div className="mb-3 flex items-baseline gap-3">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-teal-700 dark:text-teal-400">
            오늘 반드시
          </h2>
          <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
            네 영역 전체에서 자동 선정 · 5번은 사이드 프로젝트 고정석
          </span>
        </div>

        {top4.length === 0 && !sideSlot ? (
          <p className="py-3 text-sm text-zinc-400 dark:text-zinc-500">
            아직 할일이 없다. 아래 컬럼에서 추가하거나, 최근 작업을 눌러 올려라.
          </p>
        ) : (
          <ol className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {top4.map((t, i) => {
              const d = dueLabel(t);
              return (
                <li key={t.id} className="grid grid-cols-[1.25rem_1rem_3.25rem_1fr_auto] items-center gap-2 py-2.5 sm:grid-cols-[1.25rem_1rem_5rem_1fr_auto] sm:gap-3">
                  <span className="font-mono text-sm text-zinc-400 dark:text-zinc-500">{i + 1}</span>
                  <Check on={t.done} onClick={() => toggle(t.id)} />
                  <span className={`rounded px-1.5 py-0.5 text-center font-mono text-[10px] font-semibold ${CHIP[t.domain]}`}>
                    {DOMAIN_LABEL[t.domain]}
                  </span>
                  <span className="truncate text-sm text-zinc-800 dark:text-zinc-100">{t.title}</span>
                  {d.text && (
                    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 font-mono text-[10.5px] font-medium ${TONE[d.tone]}`}>
                      {d.text}
                    </span>
                  )}
                </li>
              );
            })}

            {/* 5번 — 자동 선정에서 빼고 사이드 프로젝트에 예약한 칸 */}
            <li className="mt-1 grid grid-cols-[1.25rem_1rem_3.25rem_1fr_auto] items-center gap-2 border-t border-dashed border-zinc-300 py-2.5 pt-3 sm:grid-cols-[1.25rem_1rem_5rem_1fr_auto] sm:gap-3 dark:border-zinc-700">
              <span className="font-mono text-sm text-slate-500 dark:text-slate-400">5</span>
              {sideSlot && "done" in sideSlot ? (
                <>
                  <Check on={sideSlot.done} onClick={() => toggle(sideSlot.id)} />
                  <span className={`rounded px-1.5 py-0.5 text-center font-mono text-[10px] font-semibold ${SIDE_CHIP}`}>사이드</span>
                  <span className="truncate text-sm text-zinc-800 dark:text-zinc-100">{sideSlot.title}</span>
                  <span />
                </>
              ) : sideSlot ? (
                <>
                  <button
                    onClick={() => addTask(sideSlot.title, sideSlot.domain, true, true)}
                    title="오늘 할일로 올리기"
                    className="h-4 w-4 rounded-[3px] border-[1.5px] border-dashed border-slate-400 hover:border-slate-600 dark:border-slate-500 dark:hover:border-slate-300"
                  />
                  <span className={`rounded px-1.5 py-0.5 text-center font-mono text-[10px] font-semibold ${SIDE_CHIP}`}>사이드</span>
                  <span className="truncate text-sm text-zinc-500 dark:text-zinc-400">{sideSlot.title}</span>
                  <span className="whitespace-nowrap rounded-full bg-slate-200 px-2 py-0.5 font-mono text-[10.5px] font-medium text-slate-700 dark:bg-slate-700/50 dark:text-slate-300">
                    {sideSlot.staleDays === 0 ? "오늘 진행" : `${sideSlot.staleDays}일째 멈춤`}
                  </span>
                </>
              ) : (
                <>
                  <span />
                  <span className={`rounded px-1.5 py-0.5 text-center font-mono text-[10px] font-semibold ${SIDE_CHIP}`}>사이드</span>
                  <span className="text-sm text-zinc-400 dark:text-zinc-500">진행 중인 사이드 프로젝트 없음</span>
                  <span />
                </>
              )}
            </li>
          </ol>
        )}
      </section>

      {/* ── 3층 · 영역 보드 ───────────────────────────────────────────── */}
      <section className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-14">
        {DOMAINS.map((d) => (
          <DomainColumn
            key={d}
            domain={d}
            tasks={tasks.filter((t) => t.domain === d)}
            threads={threads.filter((t) => t.domain === d)}
            onToggle={toggle}
            onRemove={removeTask}
            onAdd={addTask}
          />
        ))}
      </section>

      {/* ── 4층 · 확인 스트립 ─────────────────────────────────────────── */}
      <section className="mt-3 grid grid-cols-2 divide-x divide-y divide-zinc-200 overflow-hidden rounded-lg border border-zinc-200 bg-white sm:grid-cols-4 sm:divide-y-0 dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
        <Stat n={inbox?.overdue ?? null} label="24시간 넘긴 미답장" tone={inbox && inbox.overdue > 0 ? "alert" : "calm"} href="/inbox" />
        <Stat n={inbox?.total ?? null} label="미답장 전체" tone="calm" href="/inbox" />
        <Stat n={threads.filter((t) => t.staleDays >= 7).length} label="7일 넘게 멈춘 일" tone={threads.some((t) => t.staleDays >= 14) ? "warn" : "calm"} />
        <Stat n={threads.filter((t) => t.staleDays === 0).length} label="오늘 이미 만진 일" tone="calm" />
      </section>

      <p className="mt-4 text-center font-mono text-[11px] text-zinc-400 dark:text-zinc-600">
        {activityError
          ? `세션 스캔 없음 — ${activityError}`
          : scannedAt
            ? `클로드 코드 세션 ${threads.length}줄기 · 마지막 스캔 ${new Date(scannedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
            : ""}
      </p>
    </main>
  );
}

/* ── 조각들 ──────────────────────────────────────────────────────────────── */

function Check({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`flex h-4 w-4 items-center justify-center rounded-[3px] border-[1.5px] text-[10px] leading-none transition ${
        on
          ? "border-teal-600 bg-teal-600 text-white dark:border-teal-500 dark:bg-teal-500"
          : "border-zinc-300 hover:border-zinc-500 dark:border-zinc-600 dark:hover:border-zinc-400"
      }`}
    >
      {on ? "✓" : ""}
    </button>
  );
}

function ProgressRing({ done, total }: { done: number; total: number }) {
  const r = 19, circ = 2 * Math.PI * r;
  const pct = total ? done / total : 0;
  return (
    <div className="flex shrink-0 items-center gap-2.5">
      <svg width="46" height="46" viewBox="0 0 46 46" aria-hidden>
        <circle cx="23" cy="23" r={r} fill="none" strokeWidth="5" className="stroke-zinc-200 dark:stroke-zinc-800" />
        <circle
          cx="23" cy="23" r={r} fill="none" strokeWidth="5" strokeLinecap="round"
          className="stroke-teal-600 dark:stroke-teal-500"
          strokeDasharray={circ} strokeDashoffset={circ * (1 - pct)}
          transform="rotate(-90 23 23)"
        />
      </svg>
      <div className="font-mono text-[11px] leading-tight text-zinc-500 dark:text-zinc-400">
        <b className="block text-[15px] font-semibold text-zinc-900 dark:text-zinc-50">{done} / {total}</b>
        오늘 진행
      </div>
    </div>
  );
}

function Stat({ n, label, tone, href }: { n: number | null; label: string; tone: "alert" | "warn" | "calm"; href?: string }) {
  const color =
    tone === "alert" ? "text-red-600 dark:text-red-400"
    : tone === "warn" ? "text-yellow-600 dark:text-yellow-400"
    : "text-zinc-400 dark:text-zinc-500";
  const body = (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className={`font-mono text-xl font-semibold tabular-nums ${color}`}>{n ?? "—"}</span>
      <span className="text-xs leading-tight text-zinc-500 dark:text-zinc-400">{label}</span>
    </div>
  );
  return href ? <a href={href} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50">{body}</a> : body;
}

function DomainColumn({
  domain, tasks, threads, onToggle, onRemove, onAdd,
}: {
  domain: Domain;
  tasks: Task[];
  threads: ActivityThread[];
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onAdd: (title: string, domain: Domain, side?: boolean) => void;
}) {
  const [draft, setDraft] = useState("");
  const done = tasks.filter((t) => t.done).length;
  // 이미 할일로 올린 줄기는 목록에서 뺀다.
  const taskTitles = new Set(tasks.map((t) => t.title));
  const fresh = threads.filter((t) => !taskTitles.has(t.title)).slice(0, 6);

  return (
    <div className={`overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 ${COL_SPAN[domain]}`}>
      <div className={`border-b border-t-[3px] border-zinc-200 px-4 py-3 dark:border-b-zinc-800 ${HEAD[domain]}`}>
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold tracking-tight">{DOMAIN_LABEL[domain]}</h3>
          <span className="font-mono text-[11px] text-zinc-400 dark:text-zinc-500">{done} / {tasks.length}</span>
        </div>
      </div>

      <ul className="px-4 py-2">
        {tasks.length === 0 && (
          <li className="py-2 text-xs text-zinc-400 dark:text-zinc-600">할일 없음</li>
        )}
        {tasks.map((t) => {
          const d = dueLabel(t);
          return (
            <li key={t.id} className="group grid grid-cols-[0.875rem_1fr_auto] items-center gap-2.5 py-1.5">
              <Check on={t.done} onClick={() => onToggle(t.id)} />
              <span className={`text-[13px] leading-snug ${t.done ? "text-zinc-400 line-through dark:text-zinc-600" : "text-zinc-700 dark:text-zinc-200"}`}>
                {t.title}
              </span>
              <span className="flex items-center gap-1">
                {d.text && (
                  <span className={`whitespace-nowrap rounded-full px-1.5 py-0.5 font-mono text-[10px] ${TONE[d.tone]}`}>{d.text}</span>
                )}
                <button
                  onClick={() => onRemove(t.id)}
                  aria-label="삭제"
                  className="text-zinc-300 opacity-0 transition group-hover:opacity-100 hover:text-red-500 dark:text-zinc-600"
                >
                  ×
                </button>
              </span>
            </li>
          );
        })}
      </ul>

      {fresh.length > 0 && (
        <>
          <p className="border-t border-zinc-100 px-4 pt-2.5 font-mono text-[9.5px] uppercase tracking-[0.11em] text-zinc-400 dark:border-zinc-800 dark:text-zinc-600">
            최근 작업 · 클로드 코드
          </p>
          <ul className="px-4 pb-1 pt-1">
            {fresh.map((t) => (
              <li key={t.id} className="grid grid-cols-[0.875rem_1fr_auto] items-center gap-2.5 py-1">
                <button
                  onClick={() => onAdd(t.title, t.domain, t.side)}
                  title="오늘 할일로 올리기"
                  className="h-3.5 w-3.5 rounded-[3px] border-[1.5px] border-dashed border-zinc-300 hover:border-teal-600 dark:border-zinc-600 dark:hover:border-teal-400"
                />
                <span className="truncate text-[12.5px] leading-snug text-zinc-500 dark:text-zinc-400" title={t.title}>
                  {t.title}
                </span>
                <span className="whitespace-nowrap font-mono text-[10px] text-zinc-400 dark:text-zinc-600">
                  {t.staleDays === 0 ? "오늘" : `${t.staleDays}일`}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="border-t border-zinc-100 px-4 py-2 dark:border-zinc-800">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { onAdd(draft, domain); setDraft(""); }
          }}
          placeholder="할일 추가"
          className="w-full bg-transparent py-1 text-[13px] text-zinc-700 outline-none placeholder:text-zinc-300 dark:text-zinc-200 dark:placeholder:text-zinc-600"
        />
      </div>
    </div>
  );
}
