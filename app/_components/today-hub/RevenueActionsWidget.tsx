"use client";

import { useState } from "react";
import { TrendingUp, Check, Pencil, X, Plus } from "lucide-react";
import { kstWeekStartStr } from "./dateUtils";
import type { RevenueAction, RevenueGoal, CadenceType } from "./types";

function fmtKRW(n: number) {
  if (n >= 100_000_000) return (n / 100_000_000).toFixed(1) + "억원";
  if (n >= 10_000)      return (n / 10_000).toFixed(0) + "만원";
  return n.toLocaleString("ko-KR") + "원";
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

interface Props {
  routines:      RevenueAction[];
  setRoutines:   React.Dispatch<React.SetStateAction<RevenueAction[]>>;
  goal:          RevenueGoal;
  setGoal:       React.Dispatch<React.SetStateAction<RevenueGoal>>;
  currentRevenue: number;
  brandLabel:    string;
}

export default function RevenueActionsWidget({
  routines, setRoutines, goal, setGoal, currentRevenue, brandLabel,
}: Props) {
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalDraft, setGoalDraft]     = useState<string>(String(Math.round(goal.target / 10_000)));

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editType,  setEditType]  = useState<CadenceType>("weekly");
  const [editTarget, setEditTarget] = useState(1);

  const [addingNew, setAddingNew] = useState(false);
  const [newTitle,  setNewTitle]  = useState("");
  const [newType,   setNewType]   = useState<CadenceType>("weekly");
  const [newTarget, setNewTarget] = useState(1);

  const pct = goal.target > 0
    ? Math.min(100, Math.round((currentRevenue / goal.target) * 100))
    : 0;

  // ── 목표 편집 ──
  const startGoalEdit = () => {
    setGoalDraft(String(Math.round(goal.target / 10_000)));
    setEditingGoal(true);
  };
  const saveGoalEdit = () => {
    const n = parseInt(goalDraft, 10);
    if (Number.isFinite(n) && n >= 0) setGoal({ target: n * 10_000 });
    setEditingGoal(false);
  };

  // ── 루틴 카운트 ──
  const tick = (id: string) =>
    setRoutines((prev) =>
      prev.map((a) => {
        if (a.id !== id) return a;
        const next = a.done < a.target ? a.done + 1 : 0;
        return { ...a, done: next };
      })
    );

  // ── 루틴 편집 ──
  const startEdit = (r: RevenueAction) => {
    setEditingId(r.id);
    setEditTitle(r.title);
    setEditType(r.cadenceType);
    setEditTarget(r.target);
  };
  const cancelEdit = () => setEditingId(null);
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
              cadence:     makeCadenceLabel(editType, target),
              scope:       makeScopeLabel(editType),
              done:        Math.min(a.done, target),
              periodKey:   a.cadenceType === editType ? a.periodKey : currentPeriodKey(editType),
            }
          : a
      )
    );
    setEditingId(null);
  };

  const remove = (id: string) =>
    setRoutines((prev) => prev.filter((a) => a.id !== id));

  // ── 새 루틴 추가 ──
  const addRoutine = () => {
    const title = newTitle.trim();
    const target = Math.max(1, newTarget);
    if (!title) return;
    setRoutines((prev) => [
      ...prev,
      {
        id:          newId(),
        title,
        cadence:     makeCadenceLabel(newType, target),
        scope:       makeScopeLabel(newType),
        cadenceType: newType,
        target,
        done:        0,
        periodKey:   currentPeriodKey(newType),
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
        <div className="w-7 h-7 bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-lg flex items-center justify-center text-white shrink-0">
          <TrendingUp size={13} />
        </div>
        <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 flex-1">오늘 매출 액션</h3>
        <span className="text-[10px] font-medium text-zinc-400">{brandLabel}</span>
      </div>

      <div className="p-4 space-y-4">
        {/* 이번 달 목표 */}
        <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/30 p-3">
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-300">이번 달 목표</span>
            <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300 tabular-nums">{pct}%</span>
          </div>

          <div className="flex items-baseline gap-1 flex-wrap">
            <span className="text-sm font-bold text-zinc-800 dark:text-zinc-100 tabular-nums">
              {fmtKRW(currentRevenue)}
            </span>
            <span className="text-zinc-400 font-medium text-xs">/</span>
            {editingGoal ? (
              <span className="inline-flex items-center gap-1">
                <input
                  type="number"
                  min={0}
                  value={goalDraft}
                  onChange={(e) => setGoalDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter")  saveGoalEdit();
                    if (e.key === "Escape") setEditingGoal(false);
                  }}
                  onBlur={saveGoalEdit}
                  autoFocus
                  className="w-20 text-sm font-bold px-2 py-0.5 rounded bg-white dark:bg-zinc-800 border border-emerald-300 dark:border-emerald-700 text-zinc-800 dark:text-zinc-100 tabular-nums"
                />
                <span className="text-xs text-zinc-500">만원</span>
              </span>
            ) : (
              <button
                onClick={startGoalEdit}
                className="text-sm font-bold text-zinc-800 dark:text-zinc-100 tabular-nums inline-flex items-center gap-1 hover:text-emerald-700 dark:hover:text-emerald-400 transition group"
                title="목표 수정"
              >
                {fmtKRW(goal.target)}
                <Pencil size={10} className="opacity-0 group-hover:opacity-100 transition" />
              </button>
            )}
          </div>

          <div className="mt-2 h-1.5 bg-emerald-100 dark:bg-emerald-900/50 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 to-emerald-600 transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {/* 주간/월간 루틴 */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
              꾸준히 굴려야 하는 루틴
            </p>
            {!addingNew && (
              <button
                onClick={() => setAddingNew(true)}
                className="text-[10px] font-medium text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 inline-flex items-center gap-0.5"
              >
                <Plus size={10} /> 추가
              </button>
            )}
          </div>

          <ul className="space-y-1">
            {routines.map((a) => {
              const completed = a.done >= a.target;
              if (editingId === a.id) {
                return (
                  <li key={a.id} className="flex items-center gap-1.5 py-1 bg-zinc-50 dark:bg-zinc-800/50 rounded px-1.5">
                    <input
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") cancelEdit(); }}
                      autoFocus
                      placeholder="루틴 이름"
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
                    <span className="text-[10px] text-zinc-500">회</span>
                    <button
                      onClick={saveEdit}
                      className="text-[10px] font-semibold bg-emerald-600 hover:bg-emerald-700 text-white px-2 py-1 rounded"
                    >
                      저장
                    </button>
                    <button onClick={cancelEdit} className="text-zinc-400 hover:text-zinc-600">
                      <X size={12} />
                    </button>
                  </li>
                );
              }
              return (
                <li key={a.id} className="group flex items-center gap-2 py-1">
                  <button
                    onClick={() => tick(a.id)}
                    className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition ${
                      completed
                        ? "bg-emerald-500 border-emerald-500"
                        : "border-zinc-300 dark:border-zinc-600 hover:border-emerald-400"
                    }`}
                    aria-label={completed ? "리셋" : "완료 카운트 증가"}
                    title={completed ? "클릭 시 리셋" : "1회 완료"}
                  >
                    {completed && <Check size={10} className="text-white" />}
                  </button>
                  <span className={`text-xs flex-1 truncate ${
                    completed ? "opacity-50 line-through" : "text-zinc-700 dark:text-zinc-200"
                  }`}>
                    {a.title}
                  </span>
                  <span className="text-[10px] text-zinc-400 shrink-0 tabular-nums">
                    {a.scope} {a.done}/{a.target}
                  </span>
                  <button
                    onClick={() => startEdit(a)}
                    className="text-zinc-300 hover:text-emerald-600 opacity-0 group-hover:opacity-100 transition shrink-0"
                    aria-label="편집"
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    onClick={() => remove(a.id)}
                    className="text-zinc-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition shrink-0"
                    aria-label="삭제"
                  >
                    <X size={11} />
                  </button>
                </li>
              );
            })}
            {routines.length === 0 && !addingNew && (
              <p className="text-xs text-zinc-400 text-center py-2">루틴이 없습니다 — 위 &lsquo;추가&rsquo; 버튼으로 시작하세요.</p>
            )}
          </ul>

          {addingNew && (
            <div className="mt-2 flex items-center gap-1.5 bg-zinc-50 dark:bg-zinc-800/50 rounded px-1.5 py-1.5">
              <input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") addRoutine(); if (e.key === "Escape") setAddingNew(false); }}
                autoFocus
                placeholder="예: 인스타 릴스 1개 게시"
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
              <span className="text-[10px] text-zinc-500">회</span>
              <button
                onClick={addRoutine}
                disabled={!newTitle.trim()}
                className="text-[10px] font-semibold bg-emerald-600 hover:bg-emerald-700 text-white px-2 py-1 rounded disabled:opacity-50"
              >
                추가
              </button>
              <button onClick={() => setAddingNew(false)} className="text-zinc-400 hover:text-zinc-600">
                <X size={12} />
              </button>
            </div>
          )}
        </div>

        <p className="text-[10px] text-zinc-400">
          매주 일요일 / 매월 1일에 자동 리셋 · 가득 찬 항목 클릭 시 즉시 리셋
        </p>
      </div>
    </div>
  );
}
