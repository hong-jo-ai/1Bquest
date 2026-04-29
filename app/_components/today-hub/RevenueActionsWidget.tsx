"use client";

import { useState } from "react";
import { TrendingUp, Check } from "lucide-react";
import { MOCK_REVENUE_ACTIONS, MOCK_REVENUE_GOAL } from "./mockData";
import type { RevenueAction } from "./types";

function fmtKRW(n: number) {
  if (n >= 100_000_000) return (n / 100_000_000).toFixed(1) + "억원";
  if (n >= 10_000)      return (n / 10_000).toFixed(0) + "만원";
  return n.toLocaleString("ko-KR") + "원";
}

export default function RevenueActionsWidget() {
  const [actions, setActions] = useState<RevenueAction[]>(MOCK_REVENUE_ACTIONS);

  const pct = Math.min(100, Math.round((MOCK_REVENUE_GOAL.current / MOCK_REVENUE_GOAL.target) * 100));

  const tick = (id: string) =>
    setActions((prev) =>
      prev.map((a) => {
        if (a.id !== id) return a;
        const next = a.done < a.target ? a.done + 1 : 0;
        return { ...a, done: next };
      })
    );

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 overflow-hidden h-full">
      <div className="px-5 py-3 border-b border-zinc-100 dark:border-zinc-800 flex items-center gap-2.5">
        <div className="w-7 h-7 bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-lg flex items-center justify-center text-white shrink-0">
          <TrendingUp size={13} />
        </div>
        <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">오늘 매출 액션</h3>
      </div>

      <div className="p-4 space-y-4">
        <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/30 p-3">
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-300">이번 달 목표</span>
            <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300 tabular-nums">{pct}%</span>
          </div>
          <p className="text-sm font-bold text-zinc-800 dark:text-zinc-100 tabular-nums">
            {fmtKRW(MOCK_REVENUE_GOAL.current)}
            <span className="text-zinc-400 font-medium"> / {fmtKRW(MOCK_REVENUE_GOAL.target)}</span>
          </p>
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
            {actions.map((a) => {
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
          </ul>
        </div>

        <p className="text-[10px] text-zinc-400">매주 일요일 자동 리셋 (v2에서 구현)</p>
      </div>
    </div>
  );
}
