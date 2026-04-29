// TODO v3: 구글 캘린더 'C(회사용)' 캘린더만 필터링해서 읽어옴. 입력은 폰의 구글 캘린더 앱에서, 대시보드는 읽기 전용.
"use client";

import { useState } from "react";
import { Calendar } from "lucide-react";
import { MOCK_SCHEDULE } from "./mockData";
import type { ScheduleItem } from "./types";

export default function TodayScheduleWidget() {
  const [items] = useState<ScheduleItem[]>(MOCK_SCHEDULE);

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 overflow-hidden h-full">
      <div className="px-5 py-3 border-b border-zinc-100 dark:border-zinc-800 flex items-center gap-2.5">
        <div className="w-7 h-7 bg-gradient-to-br from-sky-500 to-sky-700 rounded-lg flex items-center justify-center text-white shrink-0">
          <Calendar size={13} />
        </div>
        <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">오늘 외부 약속</h3>
      </div>

      <div className="p-4">
        {items.length === 0 ? (
          <p className="text-xs text-zinc-400 py-4 text-center">오늘은 외부 약속 없음</p>
        ) : (
          <ul className="space-y-3">
            {items.map((it) => (
              <li key={it.id} className="flex items-baseline gap-3">
                <span className="text-sm font-bold text-zinc-800 dark:text-zinc-100 tabular-nums shrink-0 w-12">
                  {it.time}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-zinc-700 dark:text-zinc-200 truncate">{it.title}</p>
                  <p className="text-[11px] text-zinc-400 truncate">{it.location}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
