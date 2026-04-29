"use client";

import { useState } from "react";
import { X, Trash2, Plus } from "lucide-react";
import { kstDateStr } from "./dateUtils";
import type { BigEvent, EventChecklistItem } from "./types";

/** YYYY-MM-DD 차이 (일수) */
function daysBetween(later: string, earlier: string): number {
  const a = Date.UTC(+later.slice(0, 4),   +later.slice(5, 7) - 1,   +later.slice(8, 10));
  const b = Date.UTC(+earlier.slice(0, 4), +earlier.slice(5, 7) - 1, +earlier.slice(8, 10));
  return Math.round((a - b) / 86400000);
}

/** target 으로부터 dDay 만큼 앞 날짜 → YYYY-MM-DD */
function dateForDDay(targetDate: string, dDay: number): string {
  if (!targetDate || targetDate.length !== 10) return "";
  const d = new Date(`${targetDate}T00:00:00+09:00`);
  d.setUTCDate(d.getUTCDate() - dDay);
  return d.toISOString().slice(0, 10);
}

interface Props {
  event: BigEvent | null; // null = 신규
  onClose: () => void;
  onSave: (event: BigEvent) => void;
  onDelete?: (id: string) => void;
}

function newId(prefix: string) {
  return `${prefix}${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

export default function EventEditModal({ event, onClose, onSave, onDelete }: Props) {
  const [title, setTitle]           = useState(event?.title       ?? "");
  const [targetDate, setTargetDate] = useState(event?.targetDate  ?? kstDateStr(7));
  const [checklist, setChecklist]   = useState<EventChecklistItem[]>(event?.checklist ?? []);

  const addItem = () => {
    // 새 항목 기본 dDay: targetDate 와 오늘 사이 거리 (즉 오늘 마감) — 사용자가 바로 인식
    const today = kstDateStr(0);
    const defaultDDay = targetDate && targetDate >= today
      ? Math.max(0, daysBetween(targetDate, today))
      : 7;
    setChecklist((prev) => [
      ...prev,
      { id: newId("c"), dDay: defaultDDay, title: "", done: false },
    ]);
  };

  const updateItem = (id: string, patch: Partial<EventChecklistItem>) =>
    setChecklist((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  const removeItem = (id: string) =>
    setChecklist((prev) => prev.filter((c) => c.id !== id));

  const canSave = title.trim().length > 0 && targetDate.length === 10;

  const handleSave = () => {
    if (!canSave) return;
    const cleaned = checklist
      .filter((c) => c.title.trim().length > 0)
      .sort((a, b) => b.dDay - a.dDay);
    onSave({
      id:         event?.id ?? newId("e"),
      title:      title.trim(),
      targetDate,
      checklist:  cleaned,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="px-5 py-4 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
          <h3 className="text-base font-semibold text-zinc-800 dark:text-zinc-100">
            {event ? "이벤트 편집" : "새 이벤트"}
          </h3>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            aria-label="닫기"
          >
            <X size={18} />
          </button>
        </div>

        {/* 본문 */}
        <div className="p-5 space-y-4">
          <div>
            <label className="text-[11px] font-semibold text-zinc-500 mb-1.5 block">제목</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="예: 5월 가정의달 공동구매"
              className="w-full text-sm px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 focus:outline-none focus:border-violet-400"
            />
          </div>

          <div>
            <label className="text-[11px] font-semibold text-zinc-500 mb-1.5 block">D-day (목표 날짜)</label>
            <input
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              min={kstDateStr(0)}
              className="w-full text-sm px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] font-semibold text-zinc-500">체크리스트</label>
              <button
                onClick={addItem}
                className="text-[11px] font-medium text-violet-600 dark:text-violet-400 hover:text-violet-700 flex items-center gap-1"
              >
                <Plus size={11} /> 항목 추가
              </button>
            </div>
            <ul className="space-y-1.5">
              {checklist.map((c) => {
                const itemDate = dateForDDay(targetDate, c.dDay);
                const dateInvalid = targetDate.length !== 10;
                return (
                  <li key={c.id} className="flex items-center gap-2">
                    <input
                      type="date"
                      value={itemDate}
                      max={targetDate || undefined}
                      disabled={dateInvalid}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (!v || v.length !== 10) return;
                        const newDDay = Math.max(0, daysBetween(targetDate, v));
                        updateItem(c.id, { dDay: newDDay });
                      }}
                      className="w-32 text-xs px-2 py-1.5 rounded bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 disabled:opacity-50"
                      title={dateInvalid ? "먼저 이벤트 목표 날짜를 지정하세요" : ""}
                    />
                    <span className="text-[10px] font-semibold text-violet-600 dark:text-violet-400 tabular-nums shrink-0 w-10 text-center">
                      D-{c.dDay}
                    </span>
                    <input
                      value={c.title}
                      onChange={(e) => updateItem(c.id, { title: e.target.value })}
                      placeholder="할 일"
                      className="flex-1 min-w-0 text-xs px-2 py-1.5 rounded bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200"
                    />
                    <button
                      onClick={() => removeItem(c.id)}
                      className="text-zinc-400 hover:text-rose-500 shrink-0"
                      aria-label="삭제"
                    >
                      <X size={14} />
                    </button>
                  </li>
                );
              })}
              {checklist.length === 0 && (
                <p className="text-xs text-zinc-400 text-center py-4">체크리스트 항목을 추가해 주세요.</p>
              )}
              {checklist.length > 0 && targetDate && (
                <p className="text-[10px] text-zinc-400 mt-1">
                  날짜 입력 시 D-day 자동 계산 · 이벤트 목표 날짜를 옮기면 체크리스트도 같이 따라옴
                </p>
              )}
            </ul>
          </div>
        </div>

        {/* 푸터 */}
        <div className="px-5 py-4 border-t border-zinc-100 dark:border-zinc-800 flex items-center gap-2">
          {onDelete && event && (
            <button
              onClick={() => onDelete(event.id)}
              className="text-xs font-semibold text-rose-600 dark:text-rose-400 px-3 py-2 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/30 flex items-center gap-1.5"
            >
              <Trash2 size={12} /> 삭제
            </button>
          )}
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="text-xs font-semibold text-zinc-600 dark:text-zinc-300 px-3 py-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            취소
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave}
            className="text-xs font-semibold bg-violet-600 hover:bg-violet-700 text-white px-3 py-2 rounded-lg disabled:opacity-50 transition"
          >
            저장
          </button>
        </div>
      </div>
    </div>
  );
}
