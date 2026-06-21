"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { CheckSquare, X, AlertTriangle, Pencil, Check } from "lucide-react";
import {
  CATEGORY_LABEL, CATEGORY_BADGE, CATEGORY_ORDER,
  type Task, type TaskCategory, type InjectedEventItem,
} from "./types";
import { kstDateStr } from "./dateUtils";

interface Props {
  tasks: Task[];
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  injectedItems: InjectedEventItem[];
  onToggleInjected: (eventId: string, checklistId: string) => void;
}

function newId() {
  return `n${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

export default function TodayTasksWidget({
  tasks, setTasks, injectedItems, onToggleInjected,
}: Props) {
  const [draftTitle, setDraftTitle]       = useState("");
  const [draftCategory, setDraftCategory] = useState<TaskCategory>("etc");

  // 인라인 편집 상태 — 한 번에 하나의 task 만 편집 가능
  const [editingId, setEditingId]       = useState<string | null>(null);
  const [editTitle, setEditTitle]       = useState("");
  const [editCategory, setEditCategory] = useState<TaskCategory>("etc");
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  const total = tasks.length + injectedItems.length;
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

  const startEdit = (t: Task) => {
    setEditingId(t.id);
    setEditTitle(t.title);
    setEditCategory(t.category);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditTitle("");
  };

  const saveEdit = () => {
    const title = editTitle.trim();
    if (!editingId || !title) {
      cancelEdit();
      return;
    }
    setTasks((prev) =>
      prev.map((t) =>
        t.id === editingId ? { ...t, title, category: editCategory } : t,
      ),
    );
    cancelEdit();
  };

  const add = () => {
    const title = draftTitle.trim();
    if (!title) return;
    setTasks((prev) => [
      ...prev,
      { id: newId(), title, category: draftCategory, done: false, date: kstDateStr(0) },
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

        {/* 빅 이벤트 마감 자동 주입 — 오늘/내일 마감 + 지난 미완료 */}
        {injectedItems.length > 0 && (
          <div>
            <p className="text-[10px] font-bold text-rose-500 uppercase tracking-wider mb-1.5 flex items-center gap-1">
              <AlertTriangle size={10} /> 빅 이벤트 마감 ({injectedItems.length}) · 체크 시 이벤트와 동기화
            </p>
            <ul className="space-y-0.5">
              {injectedItems.map((it) => {
                const delta = it.daysLeftDelta;
                // delta: <0 지남, 0 오늘, 1 내일
                const isOverdue  = delta < 0;
                const isToday    = delta === 0;
                const isTomorrow = delta === 1;

                const rowBg = isTomorrow
                  ? "bg-amber-50 dark:bg-amber-950/30"
                  : "bg-rose-50 dark:bg-rose-950/30";
                const checkboxColor = isTomorrow
                  ? "border-amber-400 accent-amber-600"
                  : "border-rose-400 accent-rose-600";
                const titleColor = isTomorrow
                  ? "text-amber-800 dark:text-amber-200"
                  : "text-rose-800 dark:text-rose-200";
                const eventColor = isTomorrow
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-rose-500 dark:text-rose-400";

                let badgeLabel: string;
                let badgeStyle: string;
                if (isOverdue) {
                  badgeLabel = `${Math.abs(delta)}일 지남`;
                  badgeStyle = "bg-rose-200 text-rose-800 dark:bg-rose-900/60 dark:text-rose-200";
                } else if (isToday) {
                  badgeLabel = "오늘";
                  badgeStyle = "bg-rose-600 text-white";
                } else {
                  badgeLabel = "내일";
                  badgeStyle = "bg-amber-500 text-white";
                }

                return (
                  <li
                    key={`${it.eventId}-${it.checklistId}`}
                    className={`flex items-center gap-2 py-1.5 px-2 rounded-lg ${rowBg}`}
                  >
                    <input
                      type="checkbox"
                      checked={false}
                      onChange={() => onToggleInjected(it.eventId, it.checklistId)}
                      className={`w-4 h-4 rounded cursor-pointer shrink-0 ${checkboxColor}`}
                    />
                    <span className={`text-sm flex-1 truncate ${titleColor}`}>
                      {it.title}
                    </span>
                    <span className={`text-[10px] shrink-0 truncate max-w-[100px] ${eventColor}`}>
                      {it.eventTitle}
                    </span>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${badgeStyle}`}>
                      {badgeLabel}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* 카테고리별 일반 할일 */}
        {CATEGORY_ORDER.map((cat) => {
          const list = grouped[cat];
          if (list.length === 0) return null;
          return (
            <div key={cat}>
              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1.5">
                {CATEGORY_LABEL[cat]}
              </p>
              <ul className="space-y-0.5">
                {list.map((t) => {
                  const isEditing = editingId === t.id;
                  if (isEditing) {
                    return (
                      <li
                        key={t.id}
                        className="flex items-center gap-2 py-1.5 px-1.5 rounded-lg bg-violet-50 dark:bg-violet-950/30"
                      >
                        <input
                          ref={editInputRef}
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveEdit();
                            else if (e.key === "Escape") cancelEdit();
                          }}
                          className="flex-1 min-w-0 text-sm px-2 py-1 rounded bg-white dark:bg-zinc-900 border border-violet-300 dark:border-violet-700 text-zinc-700 dark:text-zinc-200 focus:outline-none focus:border-violet-500"
                        />
                        <select
                          value={editCategory}
                          onChange={(e) => setEditCategory(e.target.value as TaskCategory)}
                          className="text-[11px] px-1.5 py-1 rounded bg-white dark:bg-zinc-900 border border-violet-300 dark:border-violet-700 text-zinc-700 dark:text-zinc-300 shrink-0"
                        >
                          {CATEGORY_ORDER.map((c) => (
                            <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
                          ))}
                        </select>
                        <button
                          onClick={saveEdit}
                          className="text-violet-600 hover:text-violet-700 shrink-0"
                          aria-label="저장"
                        >
                          <Check size={16} />
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="text-zinc-400 hover:text-zinc-600 shrink-0"
                          aria-label="취소"
                        >
                          <X size={14} />
                        </button>
                      </li>
                    );
                  }
                  return (
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
                        onDoubleClick={() => startEdit(t)}
                        className={`text-sm flex-1 cursor-text ${
                          t.done
                            ? "line-through opacity-50 text-zinc-500"
                            : "text-zinc-700 dark:text-zinc-200"
                        }`}
                        title="더블클릭하여 수정"
                      >
                        {t.title}
                      </span>
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${CATEGORY_BADGE[cat]} shrink-0`}>
                        {CATEGORY_LABEL[cat]}
                      </span>
                      <button
                        onClick={() => startEdit(t)}
                        className="text-zinc-300 hover:text-violet-600 opacity-0 group-hover:opacity-100 transition shrink-0"
                        aria-label="수정"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        onClick={() => remove(t.id)}
                        className="text-zinc-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition shrink-0"
                        aria-label="삭제"
                      >
                        <X size={14} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}

        {tasks.length === 0 && injectedItems.length === 0 && (
          <p className="text-xs text-zinc-400 text-center py-8">할일이 없습니다.</p>
        )}
      </div>

      <div className="px-4 pt-3 pb-3 border-t border-zinc-100 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <input
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            onKeyDown={(e) => {
              // 한글 IME 조합 중 Enter는 글자 확정용이므로 무시 (마지막 글자 중복 등록 방지)
              if (e.nativeEvent.isComposing || e.key !== "Enter") return;
              add();
            }}
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
        <p className="text-[10px] text-zinc-400 mt-2">
          미완료 항목은 다음날 자동 이월 · 빅이벤트 마감일 도달 시 상단에 자동 노출 · 더블클릭으로 수정
        </p>
      </div>
    </div>
  );
}
