"use client";

import { useMemo, useState } from "react";
import type { ElementType } from "react";
import {
  AlertTriangle, BarChart3, CalendarClock, Check, Flag, Gauge,
  PackagePlus, Pencil, Plus, Target, TrendingUp, X,
} from "lucide-react";
import { daysUntil, kstWeekStartStr } from "./dateUtils";
import type { BigEvent, CadenceType, RevenueAction, RevenueGoal } from "./types";

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

function newId() {
  return `r${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function makeCadenceLabel(type: CadenceType, target: number): string {
  return type === "weekly" ? `주 ${target}회` : `월 ${target}회`;
}

function makeScopeLabel(type: CadenceType): string {
  return type === "weekly" ? "이번주" : "이번달";
}

function currentPeriodKey(type: CadenceType): string {
  if (type === "weekly") return kstWeekStartStr();
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 7);
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

function normalizeGoal(goal: RevenueGoal): Required<RevenueGoal> {
  return {
    target: goal.target || 80_000_000,
    annualProfitTarget: goal.annualProfitTarget ?? 400_000_000,
    monthlyProfitTarget: goal.monthlyProfitTarget ?? 33_333_333,
    monthlyUnitsTarget: goal.monthlyUnitsTarget ?? 1_000,
    annualLaunchTarget: goal.annualLaunchTarget ?? 4,
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
}

export default function RevenueActionsWidget({
  routines, setRoutines, goal, setGoal, currentRevenue, brandLabel, events,
}: Props) {
  const resolvedGoal = normalizeGoal(goal);
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalDraft, setGoalDraft] = useState<string>(String(Math.round(resolvedGoal.target / 10_000)));

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editType, setEditType] = useState<CadenceType>("weekly");
  const [editTarget, setEditTarget] = useState(1);

  const [addingNew, setAddingNew] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newType, setNewType] = useState<CadenceType>("weekly");
  const [newTarget, setNewTarget] = useState(1);

  const revenuePct = resolvedGoal.target > 0
    ? Math.min(100, Math.round((currentRevenue / resolvedGoal.target) * 100))
    : 0;
  const estimatedProfit = Math.round(currentRevenue * 0.42);
  const profitPct = Math.min(100, Math.round((estimatedProfit / resolvedGoal.monthlyProfitTarget) * 100));
  const estimatedUnits = Math.round(currentRevenue / 82_000);
  const unitsPct = Math.min(100, Math.round((estimatedUnits / resolvedGoal.monthlyUnitsTarget) * 100));
  const expectedPct = monthProgressPct();

  const nextEvent = useMemo(() => {
    return [...events]
      .map((event) => {
        const daysLeft = daysUntil(event.targetDate);
        const total = event.checklist.length;
        const done = event.checklist.filter((c) => c.done).length;
        return { event, daysLeft, total, done, pct: total > 0 ? Math.round((done / total) * 100) : 0 };
      })
      .filter((e) => e.daysLeft >= -7)
      .sort((a, b) => a.daysLeft - b.daysLeft)[0] ?? null;
  }, [events]);

  const bottlenecks = useMemo(() => {
    const items: Array<{ tone: string; text: string }> = [];
    for (const event of events) {
      const left = daysUntil(event.targetDate);
      for (const c of event.checklist) {
        const delta = left - c.dDay;
        if (!c.done && delta < 0) items.push({ tone: "overdue", text: `${event.title}: ${c.title}` });
      }
    }
    if (revenuePct + 8 < expectedPct) {
      items.push({ tone: "risk", text: `월 매출 속도 ${revenuePct}% / 시간 경과 ${expectedPct}%` });
    }
    const stale = routines.filter((r) => r.done < r.target).slice(0, 2);
    for (const r of stale) items.push({ tone: "routine", text: `${r.title} ${r.done}/${r.target}` });
    return items.slice(0, 3);
  }, [events, expectedPct, revenuePct, routines]);

  const leverStats = useMemo(() => {
    const base: Record<LeverKey, { done: number; target: number; routines: RevenueAction[] }> = {
      product: { done: 0, target: 0, routines: [] },
      campaign: { done: 0, target: 0, routines: [] },
      ads: { done: 0, target: 0, routines: [] },
      content: { done: 0, target: 0, routines: [] },
      channel: { done: 0, target: 0, routines: [] },
    };
    for (const r of routines) {
      const key = inferLever(r.title);
      base[key].done += r.done;
      base[key].target += r.target;
      base[key].routines.push(r);
    }
    return base;
  }, [routines]);

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

  const tick = (id: string) =>
    setRoutines((prev) =>
      prev.map((a) => {
        if (a.id !== id) return a;
        const next = a.done < a.target ? a.done + 1 : 0;
        return { ...a, done: next };
      }),
    );

  const startEdit = (r: RevenueAction) => {
    setEditingId(r.id);
    setEditTitle(r.title);
    setEditType(r.cadenceType);
    setEditTarget(r.target);
  };

  const saveEdit = () => {
    const title = editTitle.trim();
    const target = Math.max(1, editTarget);
    if (!title || !editingId) return;
    setRoutines((prev) =>
      prev.map((a) =>
        a.id === editingId
          ? {
              ...a,
              title,
              target,
              cadenceType: editType,
              cadence: makeCadenceLabel(editType, target),
              scope: makeScopeLabel(editType),
              done: Math.min(a.done, target),
              periodKey: a.cadenceType === editType ? a.periodKey : currentPeriodKey(editType),
            }
          : a,
      ),
    );
    setEditingId(null);
  };

  const remove = (id: string) => setRoutines((prev) => prev.filter((a) => a.id !== id));

  const addRoutine = () => {
    const title = newTitle.trim();
    const target = Math.max(1, newTarget);
    if (!title) return;
    setRoutines((prev) => [
      ...prev,
      {
        id: newId(),
        title,
        cadence: makeCadenceLabel(newType, target),
        scope: makeScopeLabel(newType),
        cadenceType: newType,
        target,
        done: 0,
        periodKey: currentPeriodKey(newType),
      },
    ]);
    setNewTitle("");
    setNewTarget(1);
    setNewType("weekly");
    setAddingNew(false);
  };

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 overflow-hidden h-full">
      <div className="px-5 py-3 border-b border-zinc-100 dark:border-zinc-800 flex items-center gap-2.5">
        <div className="w-7 h-7 bg-zinc-900 dark:bg-zinc-100 rounded-lg flex items-center justify-center text-white dark:text-zinc-900 shrink-0">
          <Flag size={13} />
        </div>
        <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 flex-1">성장 운영판</h3>
        <span className="text-[10px] font-medium text-zinc-400">{brandLabel}</span>
      </div>

      <div className="p-4 space-y-4">
        <div className="grid grid-cols-3 gap-2">
          <MetricCard label="연 순이익" value={fmtCompact(resolvedGoal.annualProfitTarget)} sub={`월 ${fmtCompact(resolvedGoal.monthlyProfitTarget)}`} />
          <MetricCard label="월 판매량" value={`${resolvedGoal.monthlyUnitsTarget.toLocaleString("ko-KR")}개`} sub={`현재 ${estimatedUnits.toLocaleString("ko-KR")}개`} />
          <MetricCard label="연 출시" value={`${resolvedGoal.annualLaunchTarget}회`} sub={`월 캠페인 ${resolvedGoal.monthlyCampaignTarget}회`} />
        </div>

        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div>
              <p className="text-[11px] font-semibold text-zinc-500">이번 달 스코어</p>
              <div className="flex items-baseline gap-1 flex-wrap mt-0.5">
                <span className="text-base font-bold text-zinc-900 dark:text-zinc-50 tabular-nums">{fmtKRW(currentRevenue)}</span>
                <span className="text-zinc-400 text-xs">/</span>
                {editingGoal ? (
                  <span className="inline-flex items-center gap-1">
                    <input
                      type="number"
                      min={0}
                      value={goalDraft}
                      onChange={(e) => setGoalDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveGoalEdit();
                        if (e.key === "Escape") setEditingGoal(false);
                      }}
                      onBlur={saveGoalEdit}
                      autoFocus
                      className="w-20 text-sm font-bold px-2 py-0.5 rounded bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-50 tabular-nums"
                    />
                    <span className="text-xs text-zinc-500">만원</span>
                  </span>
                ) : (
                  <button
                    onClick={startGoalEdit}
                    className="text-sm font-bold text-zinc-900 dark:text-zinc-50 inline-flex items-center gap-1 hover:text-zinc-600 dark:hover:text-zinc-300 group"
                    title="목표 수정"
                  >
                    {fmtKRW(resolvedGoal.target)}
                    <Pencil size={10} className="opacity-0 group-hover:opacity-100 transition" />
                  </button>
                )}
              </div>
            </div>
            <span className={`text-[11px] font-bold px-2 py-1 rounded-full ${
              revenuePct >= expectedPct ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
            }`}>
              {revenuePct}% / {expectedPct}%
            </span>
          </div>
          <Progress label="매출" value={revenuePct} />
          <Progress label="추정 순이익" value={profitPct} detail={fmtKRW(estimatedProfit)} />
          <Progress label="판매량" value={unitsPct} detail={`${estimatedUnits.toLocaleString("ko-KR")}개`} />
        </div>

        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] font-semibold text-zinc-500">{quarterLabel()} 핵심 일정</p>
            <Target size={13} className="text-zinc-400" />
          </div>
          {nextEvent ? (
            <div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50 truncate">{nextEvent.event.title}</p>
                <span className={`text-[10px] font-bold shrink-0 ${nextEvent.daysLeft < 0 ? "text-rose-600" : "text-violet-600 dark:text-violet-400"}`}>
                  {nextEvent.daysLeft < 0 ? `D+${Math.abs(nextEvent.daysLeft)}` : `D-${nextEvent.daysLeft}`}
                </span>
              </div>
              <div className="mt-2">
                <Progress label="준비율" value={nextEvent.pct} detail={`${nextEvent.done}/${nextEvent.total}`} />
              </div>
            </div>
          ) : (
            <p className="text-xs text-zinc-400 py-2">등록된 분기 일정 없음</p>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] font-semibold text-zinc-500">월간 성장 레버</p>
            {!addingNew && (
              <button
                onClick={() => setAddingNew(true)}
                className="text-[10px] font-medium text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white inline-flex items-center gap-0.5"
              >
                <Plus size={10} /> 추가
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {(Object.keys(LEVERS) as LeverKey[]).map((key) => {
              const meta = LEVERS[key];
              const Icon = meta.icon;
              const stat = leverStats[key];
              const pct = stat.target > 0 ? Math.min(100, Math.round((stat.done / stat.target) * 100)) : 0;
              return (
                <div key={key} className={`rounded-lg border p-2 ${meta.tone}`}>
                  <div className="flex items-center gap-1.5">
                    <Icon size={12} className="shrink-0" />
                    <span className="text-[11px] font-bold flex-1">{meta.label}</span>
                    <span className="text-[10px] font-semibold tabular-nums">{stat.done}/{stat.target}</span>
                  </div>
                  <div className="mt-1.5 h-1 bg-white/60 dark:bg-zinc-900/40 rounded-full overflow-hidden">
                    <div className="h-full bg-current opacity-70" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>

          <ul className="mt-3 space-y-1">
            {routines.map((a) => {
              const completed = a.done >= a.target;
              if (editingId === a.id) {
                return (
                  <li key={a.id} className="flex items-center gap-1.5 py-1 bg-zinc-50 dark:bg-zinc-800/50 rounded px-1.5">
                    <input
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditingId(null); }}
                      autoFocus
                      placeholder="레버 이름"
                      className="flex-1 min-w-0 text-xs px-2 py-1 rounded bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700"
                    />
                    <select
                      value={editType}
                      onChange={(e) => setEditType(e.target.value as CadenceType)}
                      className="text-xs px-1.5 py-1 rounded bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700"
                    >
                      <option value="weekly">주</option>
                      <option value="monthly">월</option>
                    </select>
                    <input
                      type="number"
                      min={1}
                      value={editTarget}
                      onChange={(e) => setEditTarget(parseInt(e.target.value) || 1)}
                      className="w-12 text-xs px-1.5 py-1 rounded bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 tabular-nums"
                    />
                    <button onClick={saveEdit} className="text-[10px] font-semibold bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 px-2 py-1 rounded">저장</button>
                    <button onClick={() => setEditingId(null)} className="text-zinc-400 hover:text-zinc-600"><X size={12} /></button>
                  </li>
                );
              }
              return (
                <li key={a.id} className="group flex items-center gap-2 py-1">
                  <button
                    onClick={() => tick(a.id)}
                    className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition ${
                      completed ? "bg-zinc-900 border-zinc-900 dark:bg-zinc-100 dark:border-zinc-100" : "border-zinc-300 dark:border-zinc-600 hover:border-zinc-500"
                    }`}
                    aria-label={completed ? "리셋" : "완료 카운트 증가"}
                    title={completed ? "클릭 시 리셋" : "1회 완료"}
                  >
                    {completed && <Check size={10} className="text-white dark:text-zinc-900" />}
                  </button>
                  <span className={`text-xs flex-1 truncate ${completed ? "opacity-50 line-through" : "text-zinc-700 dark:text-zinc-200"}`}>
                    {a.title}
                  </span>
                  <span className="text-[10px] text-zinc-400 shrink-0 tabular-nums">{a.scope} {a.done}/{a.target}</span>
                  <button onClick={() => startEdit(a)} className="text-zinc-300 hover:text-zinc-700 dark:hover:text-zinc-100 opacity-0 group-hover:opacity-100 transition shrink-0" aria-label="편집">
                    <Pencil size={11} />
                  </button>
                  <button onClick={() => remove(a.id)} className="text-zinc-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition shrink-0" aria-label="삭제">
                    <X size={11} />
                  </button>
                </li>
              );
            })}
          </ul>

          {addingNew && (
            <div className="mt-2 flex items-center gap-1.5 bg-zinc-50 dark:bg-zinc-800/50 rounded px-1.5 py-1.5">
              <input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") addRoutine(); if (e.key === "Escape") setAddingNew(false); }}
                autoFocus
                placeholder="예: 9월 공구 후보 10명 컨택"
                className="flex-1 min-w-0 text-xs px-2 py-1 rounded bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700"
              />
              <select
                value={newType}
                onChange={(e) => setNewType(e.target.value as CadenceType)}
                className="text-xs px-1.5 py-1 rounded bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700"
              >
                <option value="weekly">주</option>
                <option value="monthly">월</option>
              </select>
              <input
                type="number"
                min={1}
                value={newTarget}
                onChange={(e) => setNewTarget(parseInt(e.target.value) || 1)}
                className="w-12 text-xs px-1.5 py-1 rounded bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 tabular-nums"
              />
              <button onClick={addRoutine} disabled={!newTitle.trim()} className="text-[10px] font-semibold bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 px-2 py-1 rounded disabled:opacity-50">추가</button>
              <button onClick={() => setAddingNew(false)} className="text-zinc-400 hover:text-zinc-600"><X size={12} /></button>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/60 dark:bg-amber-950/20 p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <AlertTriangle size={13} className="text-amber-700 dark:text-amber-300" />
            <p className="text-[11px] font-bold text-amber-800 dark:text-amber-300">이번 주 병목</p>
          </div>
          <ul className="space-y-1">
            {bottlenecks.map((item, idx) => (
              <li key={`${item.tone}-${idx}`} className="text-xs text-zinc-700 dark:text-zinc-200 truncate">
                {item.text}
              </li>
            ))}
            {bottlenecks.length === 0 && (
              <li className="text-xs text-zinc-500 dark:text-zinc-400">지연 신호 없음</li>
            )}
          </ul>
        </div>
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
