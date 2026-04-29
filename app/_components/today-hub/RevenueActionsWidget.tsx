"use client";

import { useState } from "react";
import { TrendingUp, Check, Pencil } from "lucide-react";
import type { RevenueAction, RevenueGoal } from "./types";

function fmtKRW(n: number) {
  if (n >= 100_000_000) return (n / 100_000_000).toFixed(1) + "억원";
  if (n >= 10_000)      return (n / 10_000).toFixed(0) + "만원";
  return n.toLocaleString("ko-KR") + "원";
}

interface Props {
  routines:      RevenueAction[];
  setRoutines:   React.Dispatch<React.SetStateAction<RevenueAction[]>>;
  goal:          RevenueGoal;
  setGoal:       React.Dispatch<React.SetStateAction<RevenueGoal>>;
  /** 이번 달 누적 매출 (원). DashboardClient 에서 채널 합산 후 주입. */
  currentRevenue: number;
  /** 헤더에 표시할 브랜드 이름 (폴바이스/해리엇) */
  brandLabel:    string;
}

export default function RevenueActionsWidget({
  routines, setRoutines, goal, setGoal, currentRevenue, brandLabel,
}: Props) {
  const [editing, setEditing] = useState(false);
  // 입력은 만원 단위 — 5000 = 5,000만원
  const [draft, setDraft] = useState<string>(String(Math.round(goal.target / 10_000)));

  const pct = goal.target > 0
    ? Math.min(100, Math.round((currentRevenue / goal.target) * 100))
    : 0;

  const tick = (id: string) =>
    setRoutines((prev) =>
      prev.map((a) => {
        if (a.id !== id) return a;
        const next = a.done < a.target ? a.done + 1 : 0;
        return { ...a, done: next };
      })
    );

  const startEdit = () => {
    setDraft(String(Math.round(goal.target / 10_000)));
    setEditing(true);
  };

  const saveEdit = () => {
    const n = parseInt(draft, 10);
    if (Number.isFinite(n) && n >= 0) {
      setGoal({ target: n * 10_000 });
    }
    setEditing(false);
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
            {editing ? (
              <span className="inline-flex items-center gap-1">
                <input
                  type="number"
                  min={0}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter")  saveEdit();
                    if (e.key === "Escape") setEditing(false);
                  }}
                  onBlur={saveEdit}
                  autoFocus
                  className="w-20 text-sm font-bold px-2 py-0.5 rounded bg-white dark:bg-zinc-800 border border-emerald-300 dark:border-emerald-700 text-zinc-800 dark:text-zinc-100 tabular-nums"
                />
                <span className="text-xs text-zinc-500">만원</span>
              </span>
            ) : (
              <button
                onClick={startEdit}
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

        <div>
          <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-2">
            꾸준히 굴려야 하는 주간 루틴
          </p>
          <ul className="space-y-1">
            {routines.map((a) => {
              const completed = a.done >= a.target;
              return (
                <li key={a.id} className="flex items-center gap-2 py-1">
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
                  <span className={`text-xs flex-1 ${
                    completed ? "opacity-50 line-through" : "text-zinc-700 dark:text-zinc-200"
                  }`}>
                    {a.title}
                  </span>
                  <span className="text-[10px] text-zinc-400 shrink-0 tabular-nums">
                    {a.scope} {a.done}/{a.target}
                  </span>
                </li>
              );
            })}
            {routines.length === 0 && (
              <p className="text-xs text-zinc-400 text-center py-2">루틴이 없습니다.</p>
            )}
          </ul>
        </div>

        <p className="text-[10px] text-zinc-400">
          매주 일요일 / 매월 1일에 자동 리셋 · 누적 매출은 채널별 데이터 합산 (자동)
        </p>
      </div>
    </div>
  );
}
