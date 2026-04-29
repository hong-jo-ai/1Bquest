"use client";

import { useState } from "react";
import { PartyPopper, Plus, ChevronDown, ChevronUp, Check, Pencil } from "lucide-react";
import { daysUntil } from "./dateUtils";
import EventEditModal from "./EventEditModal";
import type { BigEvent } from "./types";

interface CardProps {
  event: BigEvent;
  onToggleItem: (cid: string) => void;
  onEdit: () => void;
}

function EventCard({ event, onToggleItem, onEdit }: CardProps) {
  const [open, setOpen] = useState(false);
  const daysLeft = daysUntil(event.targetDate);
  const total    = event.checklist.length;
  const done     = event.checklist.filter((c) => c.done).length;
  const pct      = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/40 overflow-hidden">
      <div className="flex items-stretch">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex-1 p-3 flex items-center gap-3 hover:bg-zinc-100 dark:hover:bg-zinc-800/70 transition text-left min-w-0"
        >
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 truncate">{event.title}</p>
            <div className="flex items-center gap-2 mt-1">
              <span className={`text-[10px] font-bold tabular-nums ${
                daysLeft < 0 ? "text-rose-600" : "text-violet-600 dark:text-violet-400"
              }`}>
                {daysLeft < 0 ? `D+${Math.abs(daysLeft)}` : `D-${daysLeft}`}
              </span>
              <span className="text-[10px] text-zinc-300">·</span>
              <span className="text-[10px] text-zinc-500 tabular-nums">
                {pct}% ({done}/{total})
              </span>
            </div>
            <div className="mt-1.5 h-1 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
          {open
            ? <ChevronUp size={14} className="text-zinc-400 shrink-0" />
            : <ChevronDown size={14} className="text-zinc-400 shrink-0" />}
        </button>
        <button
          onClick={onEdit}
          className="px-3 border-l border-zinc-200 dark:border-zinc-700 text-zinc-400 hover:text-violet-600 hover:bg-zinc-100 dark:hover:bg-zinc-800/70 transition shrink-0"
          aria-label="편집"
          title="편집"
        >
          <Pencil size={12} />
        </button>
      </div>

      {open && (
        <ul className="border-t border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-2 space-y-0.5">
          {event.checklist.map((c) => {
            const delta    = daysLeft - c.dDay; // 0 = 오늘 마감, 음수 = 지남
            const isToday  = delta === 0 && !c.done;
            const overdue  = delta < 0 && !c.done;
            return (
              <li
                key={c.id}
                className={`flex items-center gap-2 px-2 py-1.5 rounded ${
                  isToday  ? "bg-rose-50 dark:bg-rose-950/30"
                  : overdue ? "bg-amber-50 dark:bg-amber-950/20"
                  : ""
                }`}
              >
                <button
                  onClick={() => onToggleItem(c.id)}
                  className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 transition ${
                    c.done
                      ? "bg-emerald-500 border-emerald-500"
                      : isToday
                        ? "border-rose-400"
                        : overdue
                          ? "border-amber-400"
                          : "border-zinc-300 dark:border-zinc-600"
                  }`}
                  aria-label="완료 토글"
                >
                  {c.done && <Check size={9} className="text-white" />}
                </button>
                <span className={`text-[10px] font-bold tabular-nums shrink-0 w-8 ${
                  isToday  ? "text-rose-600"
                  : overdue ? "text-amber-600"
                  : "text-zinc-400"
                }`}>
                  D-{c.dDay}
                </span>
                <span className={`text-xs flex-1 truncate ${
                  c.done
                    ? "line-through opacity-50 text-zinc-500"
                    : isToday
                      ? "text-rose-700 dark:text-rose-300 font-semibold"
                      : overdue
                        ? "text-amber-700 dark:text-amber-300"
                        : "text-zinc-700 dark:text-zinc-200"
                }`}>
                  {c.title}
                </span>
                {isToday && (
                  <span className="text-[9px] font-bold text-rose-700 bg-rose-100 dark:bg-rose-900/40 dark:text-rose-300 px-1.5 py-0.5 rounded shrink-0">
                    오늘 마감
                  </span>
                )}
                {overdue && (
                  <span className="text-[9px] font-bold text-amber-700 bg-amber-100 dark:bg-amber-900/40 dark:text-amber-300 px-1.5 py-0.5 rounded shrink-0">
                    {Math.abs(delta)}일 지남
                  </span>
                )}
              </li>
            );
          })}
          {event.checklist.length === 0 && (
            <p className="text-xs text-zinc-400 text-center py-3">체크리스트가 없습니다. 편집에서 추가하세요.</p>
          )}
        </ul>
      )}
    </div>
  );
}

interface Props {
  events: BigEvent[];
  setEvents: React.Dispatch<React.SetStateAction<BigEvent[]>>;
}

export default function BigEventsWidget({ events, setEvents }: Props) {
  const [editing, setEditing]   = useState<BigEvent | null>(null);
  const [creating, setCreating] = useState(false);

  const toggleItem = (eid: string, cid: string) =>
    setEvents((prev) =>
      prev.map((e) =>
        e.id !== eid
          ? e
          : { ...e, checklist: e.checklist.map((c) => (c.id === cid ? { ...c, done: !c.done } : c)) }
      )
    );

  const handleSave = (event: BigEvent) => {
    if (creating) {
      setEvents((prev) => [...prev, event]);
      setCreating(false);
    } else {
      setEvents((prev) => prev.map((e) => (e.id === event.id ? event : e)));
      setEditing(null);
    }
  };

  const handleDelete = (id: string) => {
    setEvents((prev) => prev.filter((e) => e.id !== id));
    setEditing(null);
  };

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 overflow-hidden h-full">
      <div className="px-5 py-3 border-b border-zinc-100 dark:border-zinc-800 flex items-center gap-2.5">
        <div className="w-7 h-7 bg-gradient-to-br from-fuchsia-500 to-pink-600 rounded-lg flex items-center justify-center text-white shrink-0">
          <PartyPopper size={13} />
        </div>
        <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 flex-1">다가오는 빅 이벤트</h3>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1 text-[11px] font-medium text-violet-600 dark:text-violet-400 px-2 py-1 rounded-lg bg-violet-50 dark:bg-violet-900/30 hover:bg-violet-100 dark:hover:bg-violet-900/50 transition"
        >
          <Plus size={12} /> 새 이벤트
        </button>
      </div>

      <div className="p-4 space-y-2">
        {events.map((e) => (
          <EventCard
            key={e.id}
            event={e}
            onToggleItem={(cid) => toggleItem(e.id, cid)}
            onEdit={() => setEditing(e)}
          />
        ))}
        {events.length === 0 && (
          <p className="text-xs text-zinc-400 text-center py-4">등록된 이벤트가 없습니다.</p>
        )}
      </div>

      {(creating || editing) && (
        <EventEditModal
          event={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSave={handleSave}
          onDelete={editing ? handleDelete : undefined}
        />
      )}
    </div>
  );
}
