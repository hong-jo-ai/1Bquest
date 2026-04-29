"use client";

import { useState } from "react";
import { PartyPopper, Plus, ChevronDown, ChevronUp, Check } from "lucide-react";
import { MOCK_EVENTS } from "./mockData";
import type { BigEvent } from "./types";

function EventCard({
  event,
  onToggle,
}: {
  event: BigEvent;
  onToggle: (eid: string, cid: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const total = event.checklist.length;
  const done  = event.checklist.filter((c) => c.done).length;
  const pct   = Math.round((done / total) * 100);

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/40 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full p-3 flex items-center gap-3 hover:bg-zinc-100 dark:hover:bg-zinc-800/70 transition text-left"
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 truncate">{event.title}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] font-bold text-violet-600 dark:text-violet-400 tabular-nums">
              D-{event.daysLeft}
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

      {open && (
        <ul className="border-t border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-2 space-y-0.5">
          {event.checklist.map((c) => (
            <li
              key={c.id}
              className={`flex items-center gap-2 px-2 py-1.5 rounded ${
                c.isToday && !c.done ? "bg-rose-50 dark:bg-rose-950/30" : ""
              }`}
            >
              <button
                onClick={() => onToggle(event.id, c.id)}
                className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 transition ${
                  c.done
                    ? "bg-emerald-500 border-emerald-500"
                    : c.isToday
                      ? "border-rose-400"
                      : "border-zinc-300 dark:border-zinc-600"
                }`}
                aria-label="완료 토글"
              >
                {c.done && <Check size={9} className="text-white" />}
              </button>
              <span className={`text-[10px] font-bold tabular-nums shrink-0 w-8 ${
                c.isToday && !c.done ? "text-rose-600" : "text-zinc-400"
              }`}>
                D-{c.dDay}
              </span>
              <span className={`text-xs flex-1 truncate ${
                c.done
                  ? "line-through opacity-50 text-zinc-500"
                  : c.isToday
                    ? "text-rose-700 dark:text-rose-300 font-semibold"
                    : "text-zinc-700 dark:text-zinc-200"
              }`}>
                {c.title}
              </span>
              {c.isToday && !c.done && (
                <span className="text-[9px] font-bold text-rose-700 bg-rose-100 dark:bg-rose-900/40 dark:text-rose-300 px-1.5 py-0.5 rounded shrink-0">
                  오늘 마감
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function BigEventsWidget() {
  const [events, setEvents] = useState<BigEvent[]>(MOCK_EVENTS);

  const toggle = (eid: string, cid: string) =>
    setEvents((prev) =>
      prev.map((e) =>
        e.id !== eid
          ? e
          : { ...e, checklist: e.checklist.map((c) => (c.id === cid ? { ...c, done: !c.done } : c)) }
      )
    );

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 overflow-hidden h-full">
      <div className="px-5 py-3 border-b border-zinc-100 dark:border-zinc-800 flex items-center gap-2.5">
        <div className="w-7 h-7 bg-gradient-to-br from-fuchsia-500 to-pink-600 rounded-lg flex items-center justify-center text-white shrink-0">
          <PartyPopper size={13} />
        </div>
        <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 flex-1">다가오는 빅 이벤트</h3>
        <button
          disabled
          title="v2에서 활성화"
          className="flex items-center gap-1 text-[11px] font-medium text-zinc-400 px-2 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 cursor-not-allowed"
        >
          <Plus size={12} /> 새 이벤트
        </button>
      </div>

      <div className="p-4 space-y-2">
        {events.map((e) => (
          <EventCard key={e.id} event={e} onToggle={toggle} />
        ))}
        <p className="text-[10px] text-zinc-400 pt-1">
          오늘 마감 항목은 v2에서 [오늘 할일] 위젯에 자동 주입
        </p>
      </div>
    </div>
  );
}
