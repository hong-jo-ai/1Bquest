"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CalendarEvent } from "@/lib/today-hub/calendar";
import type { ActivityThread, Domain, Task } from "@/lib/today/types";
import type { KakaoItem } from "@/lib/today/kakao";
import { KIND_LABEL } from "@/lib/today/kakao";
import { DOMAINS, DOMAIN_LABEL, REVENUE_DOMAINS } from "@/lib/today/types";
import { daysUntil } from "@/lib/today/date";

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

/* ── 우선순위 ────────────────────────────────────────────────────────────── */

/**
 * 마감이 가까울수록·지연될수록 높다. 매출 영역은 가산점.
 * 마감이 없으면 0점이라 마감 있는 일에 밀린다. 그건 의도대로다 — 급한 건 마감이 정한다.
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
  /** 오늘 날짜(KST)와 라벨은 서버에서 계산해 내려준다 — 클라이언트 시계로 다시 재면 하이드레이션이 어긋난다. */
  today: string;
  label: { date: string; weekday: string };
  events: CalendarEvent[];
  calendarError: string | null;
  threads: ActivityThread[];
  scannedAt: string | null;
  closedCount: number;
  activityError: string | null;
  /** 카톡 요약에서 추려진 항목. 원문은 아이맥 로컬에만 있고 여기로 오지 않는다. */
  kakaoItems: KakaoItem[];
  kakaoAt: string | null;
}

export default function TodayBoard({ today, label, events, calendarError, threads, scannedAt, closedCount, activityError, kakaoItems, kakaoAt }: Props) {
  const [tasks, setTasks]   = useState<Task[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [inbox, setInbox]   = useState<{ total: number; overdue: number } | null>(null);
  // 서버는 다음 요청에서야 반영되므로, 누르는 즉시 화면에서 빼려고 로컬로도 들고 있는다.
  const [closedIds, setClosedIds] = useState<Set<string>>(new Set());
  const lastSaved = useRef("");

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
      { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, title: t, domain, side, done: false, date: today, fromActivity },
    ]);
  }, [today]);

  const removeTask = useCallback((id: string) => {
    setTasks((ts) => ts.filter((t) => t.id !== id));
  }, []);

  /** 줄기를 끝난 것으로 닫는다. 나중에 같은 일감으로 세션이 또 생기면 알아서 되살아난다. */
  const closeThread = useCallback((t: ActivityThread) => {
    setClosedIds((prev) => new Set(prev).add(t.id));
    fetch("/api/today/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId: t.id, lastTouchedAt: t.lastTouchedAt, closed: true }),
    }).catch(() => {
      // 저장 실패면 되돌린다 — 끝났다고 표시해놓고 사라지지 않는 게 낫다.
      setClosedIds((prev) => { const next = new Set(prev); next.delete(t.id); return next; });
    });
  }, []);

  const openThreads = useMemo(() => threads.filter((t) => !closedIds.has(t.id)), [threads, closedIds]);

  /* ── 파생값 ───────────────────────────────────────────────────────────── */

  const todayEvents = useMemo(() => events.filter((e) => e.date === today), [events, today]);
  const upcoming = useMemo(
    () => events.filter((e) => e.date > today).slice(0, 4),
    [events, today],
  );

  // 사이드 프로젝트도 그냥 개인 영역의 할일로 같이 줄 세운다.
  const top5 = useMemo(
    () => tasks.filter((t) => !t.done).sort((a, b) => score(b) - score(a)).slice(0, 5),
    [tasks],
  );

  const doneCount = tasks.filter((t) => t.done).length;

  return (
    <main className="mx-auto max-w-[1600px] px-3 pb-24 pt-3 sm:px-6 sm:pt-4">
      {/* ── 1층 · 오늘의 지형 ─────────────────────────────────────────── */}
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-zinc-200 bg-white px-5 py-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-3">
          <h1 className="whitespace-nowrap text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {label.date}
            <span className="ml-2 text-sm font-normal text-zinc-500 dark:text-zinc-400">
              {label.weekday}
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
            네 영역 전체에서 마감·지연 순으로 자동 선정
          </span>
        </div>

        {top5.length === 0 ? (
          <p className="py-3 text-sm text-zinc-400 dark:text-zinc-500">
            아직 할일이 없다. 아래 컬럼에서 추가하거나, 최근 작업을 눌러 올려라.
          </p>
        ) : (
          <ol className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {top5.map((t, i) => {
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
            threads={openThreads.filter((t) => t.domain === d)}
            kakao={kakaoItems.filter((k) => k.domain === d)}
            onToggle={toggle}
            onRemove={removeTask}
            onAdd={addTask}
            onClose={closeThread}
          />
        ))}
      </section>

      {/* ── 4층 · 확인 스트립 ─────────────────────────────────────────── */}
      <section className="mt-3 grid grid-cols-2 divide-x divide-y divide-zinc-200 overflow-hidden rounded-lg border border-zinc-200 bg-white sm:grid-cols-4 sm:divide-y-0 dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
        <Stat n={inbox?.overdue ?? null} label="24시간 넘긴 미답장" tone={inbox && inbox.overdue > 0 ? "alert" : "calm"} href="/inbox" />
        <Stat n={inbox?.total ?? null} label="미답장 전체" tone="calm" href="/inbox" />
        <Stat n={openThreads.filter((t) => t.staleDays >= 7).length} label="7일 넘게 멈춘 일" tone={openThreads.some((t) => t.staleDays >= 14) ? "warn" : "calm"} />
        <Stat n={openThreads.filter((t) => t.staleDays === 0).length} label="오늘 이미 만진 일" tone="calm" />
      </section>

      {kakaoAt && (
        <p className="mt-4 text-center font-mono text-[11px] text-zinc-400 dark:text-zinc-600">
          카톡 요약 {kakaoItems.length}건 · {new Date(kakaoAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} · 원문은 아이맥에만 보관
        </p>
      )}
      <p className="mt-1 text-center font-mono text-[11px] text-zinc-400 dark:text-zinc-600">
        {activityError
          ? `세션 스캔 없음 — ${activityError}`
          : scannedAt
            ? `클로드 코드 세션 ${openThreads.length}줄기 진행 중 · 끝냄 ${closedCount + closedIds.size} · 마지막 스캔 ${new Date(scannedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
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
  domain, tasks, threads, kakao, onToggle, onRemove, onAdd, onClose,
}: {
  domain: Domain;
  tasks: Task[];
  threads: ActivityThread[];
  kakao: KakaoItem[];
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onAdd: (title: string, domain: Domain, side?: boolean, fromActivity?: boolean) => void;
  onClose: (t: ActivityThread) => void;
}) {
  const [draft, setDraft] = useState("");
  const done = tasks.filter((t) => t.done).length;
  const taskTitleSet = new Set(tasks.map((t) => t.title));
  const freshKakao = kakao.filter((k) => !taskTitleSet.has(k.title));
  // 이미 할일로 올린 줄기는 목록에서 뺀다.
  const taskTitles = new Set(tasks.map((t) => t.title));
  // 잘라내지 않는다 — 폴바이스·해리엇은 하루에도 여러 건이라 위에서부터 지워야 아래가
  // 보이는 형태였다. 대신 목록 영역에 스크롤을 준다.
  const fresh = threads.filter((t) => !taskTitles.has(t.title));

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
              <span className={`break-words text-[13px] leading-snug ${t.done ? "text-zinc-400 line-through dark:text-zinc-600" : "text-zinc-700 dark:text-zinc-200"}`}>
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

      {freshKakao.length > 0 && (
        <>
          <p className="border-t border-zinc-100 px-4 pt-2.5 font-mono text-[9.5px] uppercase tracking-[0.11em] text-zinc-400 dark:border-zinc-800 dark:text-zinc-600">
            카톡에서
          </p>
          <ul className="px-4 pb-1 pt-1">
            {freshKakao.map((k) => (
              <li key={k.id} className="grid grid-cols-[0.875rem_1fr_auto] items-start gap-2 py-1.5">
                <button
                  onClick={() => onAdd(k.title, k.domain)}
                  title="오늘 할일로 올리기"
                  className="mt-[3px] h-3.5 w-3.5 shrink-0 rounded-[3px] border-[1.5px] border-dashed border-zinc-300 hover:border-teal-600 dark:border-zinc-600 dark:hover:border-teal-400"
                />
                <span className="break-words text-[12.5px] leading-snug text-zinc-500 dark:text-zinc-400">
                  {k.title}
                  <span className="ml-1.5 text-[10px] text-zinc-400 dark:text-zinc-600">
                    {k.room}{k.who ? ` · ${k.who}` : ""}
                  </span>
                </span>
                <span className={`mt-[2px] whitespace-nowrap rounded-full px-1.5 py-0.5 font-mono text-[10px] ${
                  k.kind === "todo" ? TONE.soon : k.kind === "waiting" ? TONE.none : "bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500"
                }`}>
                  {KIND_LABEL[k.kind]}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {fresh.length > 0 && (
        <>
          <p className="flex items-baseline justify-between border-t border-zinc-100 px-4 pt-2.5 font-mono text-[9.5px] uppercase tracking-[0.11em] text-zinc-400 dark:border-zinc-800 dark:text-zinc-600">
            <span>최근 작업 · 클로드 코드</span>
            <span className="normal-case tracking-normal">{fresh.length}</span>
          </p>
          <ul className="max-h-72 overflow-y-auto px-4 pb-1 pt-1">
            {fresh.map((t) => (
              <li key={t.id} className="grid grid-cols-[0.875rem_1fr_auto_auto] items-start gap-2 py-1.5">
                <button
                  onClick={() => onAdd(t.title, t.domain, t.side, true)}
                  title="오늘 할일로 올리기"
                  className="mt-[3px] h-3.5 w-3.5 shrink-0 rounded-[3px] border-[1.5px] border-dashed border-zinc-300 hover:border-teal-600 dark:border-zinc-600 dark:hover:border-teal-400"
                />
                {/* 잘라내지 않는다 — 무슨 일이었는지 읽을 수 없으면 끝났는지 판단할 수가 없다. */}
                <span className="break-words text-[12.5px] leading-snug text-zinc-500 dark:text-zinc-400">
                  {t.title}
                </span>
                <span className="mt-[2px] whitespace-nowrap font-mono text-[10px] text-zinc-400 dark:text-zinc-600">
                  {t.staleDays === 0 ? "오늘" : `${t.staleDays}일`}
                </span>
                <button
                  onClick={() => onClose(t)}
                  title="이미 끝난 일 — 목록에서 내리기"
                  className="mt-[1px] rounded px-1 font-mono text-[10px] text-zinc-300 hover:bg-teal-50 hover:text-teal-700 dark:text-zinc-600 dark:hover:bg-teal-900/30 dark:hover:text-teal-300"
                >
                  끝남
                </button>
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
            // 한글 조합 중에는 Enter 가 조합 확정용으로 한 번 더 들어온다. 이걸 안 걸러내면
            // "필기하기" 를 넣을 때 마지막 글자 "기" 가 별도 할일로 하나 더 등록된다.
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (e.key === "Enter") { onAdd(draft, domain); setDraft(""); }
          }}
          placeholder="할일 추가"
          className="w-full bg-transparent py-1 text-[13px] text-zinc-700 outline-none placeholder:text-zinc-300 dark:text-zinc-200 dark:placeholder:text-zinc-600"
        />
      </div>
    </div>
  );
}
