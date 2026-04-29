"use client";

import { useEffect, useState } from "react";
import TodayScheduleWidget    from "./TodayScheduleWidget";
import InboxActionWidget      from "./InboxActionWidget";
import TodayTasksWidget       from "./TodayTasksWidget";
import RevenueActionsWidget   from "./RevenueActionsWidget";
import BigEventsWidget        from "./BigEventsWidget";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function todayLabel(): string {
  const d = new Date();
  const y   = d.getFullYear();
  const m   = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}.${m}.${day} ${WEEKDAYS[d.getDay()]}`;
}

export default function TodayHubSection() {
  // SSR/CSR 시점 차이로 인한 hydration mismatch 방지
  const [label, setLabel] = useState("");
  useEffect(() => { setLabel(todayLabel()); }, []);

  return (
    <section className="space-y-3 sm:space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2 px-1">
        <h2 className="text-base sm:text-lg font-bold text-zinc-800 dark:text-zinc-100">
          오늘
          {label && (
            <span className="font-medium text-zinc-500 ml-2 text-sm sm:text-base">({label})</span>
          )}
        </h2>
        <span className="text-[11px] text-zinc-400">출근 직후 5분 체크</span>
      </div>

      {/* 데스크탑: 12-grid (좌 7 / 우 5) · 모바일: 1열 */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 sm:gap-4">
        <div className="lg:col-span-7">
          <TodayTasksWidget />
        </div>
        <div className="lg:col-span-5 grid grid-cols-1 gap-3 sm:gap-4">
          <TodayScheduleWidget />
          <InboxActionWidget />
          <RevenueActionsWidget />
          <BigEventsWidget />
        </div>
      </div>
    </section>
  );
}
