"use client";

import { useState, useMemo } from "react";
import { CheckSquare, X } from "lucide-react";
import { MOCK_TASKS } from "./mockData";
import {
  CATEGORY_LABEL, CATEGORY_BADGE, CATEGORY_ORDER,
  type Task, type TaskCategory,
} from "./types";

export default function TodayTasksWidget() {
  const [tasks, setTasks] = useState<Task[]>(MOCK_TASKS);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftCategory, setDraftCategory] = useState<TaskCategory>("etc");

  const total = tasks.length;
  const done  = tasks.filter((t) => t.done).length;

  const grouped = useMemo(() => {
    const map: Record<TaskCategory, Task[]> = {
      design: [], ads: [], cs: [], content: [], ops: [], etc: [],
    };
    for (const t of tasks) map[t.category].push(t);
    return map;
  }, [tasks]);

  const toggle = (id: string) =>
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));

  const remove = (id: string) =>
    setTasks((prev) => prev.filter((t) => t.id !== id));

  const add = () => {
    const title = draftTitle.trim();
    if (!title) return;
    setTasks((prev) => [
      ...prev,
      { id: `n${Date.now()}`, title, category: draftCategory, done: false },
    ]);
    setDraftTitle("");
  };

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 overflow-hidden h-full flex flex-col">
      <div className="px-5 py-3 border-b border-zinc-100 dark:border-zinc-800 flex items-center gap-2.5">
        <div className="w-7 h-7 bg-gradient-to-br from-violet-500 to-violet-700 rounded-lg flex items-center justify-center text-white shrink-0">
          <CheckSquare size={13} />
        </div>
        <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 flex-1">오늘 할일</h3>
        <span className="text-[11px] font-semibold text-zinc-500 tabular-nums">
          {done}/{total}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-[280px]">
        {CATEGORY_ORDER.map((cat) => {
          const list = grouped[cat];
          if (list.length === 0) return null;
          return (
            <div key={cat}>
              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1.5">
                {CATEGORY_LABEL[cat]}
              </p>
              <ul className="space-y-0.5">
                {list.map((t) => (
                  <li
                    key={t.id}
                    className="group flex items-center gap-2 py-1.5 px-1.5 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition"
                  >
                    <input
                      type="checkbox"
                      checked={t.done}
                      onChange={() => toggle(t.id)}
                      className="w-4 h-4 rounded border-zinc-300 cursor-pointer accent-violet-600 shrink-0"
                    />
                    <span
                      className={`text-sm flex-1 ${
                        t.done
                          ? "line-through opacity-50 text-zinc-500"
                          : "text-zinc-700 dark:text-zinc-200"
                      }`}
                    >
                      {t.title}
                    </span>
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${CATEGORY_BADGE[cat]} shrink-0`}>
                      {CATEGORY_LABEL[cat]}
                    </span>
                    <button
                      onClick={() => remove(t.id)}
                      className="text-zinc-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition shrink-0"
                      aria-label="삭제"
                    >
                      <X size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        {total === 0 && (
          <p className="text-xs text-zinc-400 text-center py-8">할일이 없습니다.</p>
        )}
      </div>

      <div className="px-4 pt-3 pb-3 border-t border-zinc-100 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <input
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="+ 할일 추가"
            className="flex-1 min-w-0 text-xs px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 focus:outline-none focus:border-violet-400"
          />
          <select
            value={draftCategory}
            onChange={(e) => setDraftCategory(e.target.value as TaskCategory)}
            className="text-xs px-2 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 shrink-0"
          >
            {CATEGORY_ORDER.map((c) => (
              <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
            ))}
          </select>
          <button
            onClick={add}
            disabled={!draftTitle.trim()}
            className="text-xs font-semibold bg-violet-600 hover:bg-violet-700 text-white px-3 py-2 rounded-lg disabled:opacity-50 transition shrink-0"
          >
            추가
          </button>
        </div>
        <p className="text-[10px] text-zinc-400 mt-2">미완료 항목은 다음날 자동 이월 (v2에서 구현)</p>
      </div>
    </div>
  );
}
