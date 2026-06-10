"use client";

import { useState } from "react";
import { TrendingUp, TrendingDown, Clock, Calendar, Activity } from "lucide-react";
import type { DailyData } from "@/lib/cafe24Data";

function fmtKrw(n: number): string {
  return `₩${Math.round(n).toLocaleString("ko-KR")}`;
}

/** KST 기준 오늘 날짜 */
function kstTodayStr(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function daysAgoStr(n: number): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function monthStartStr(offset: number = 0): string {
  // offset: 0 = 이번 달 1일, -1 = 지난 달 1일
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + offset);
  return d.toISOString().slice(0, 10);
}

function todayDayOfMonth(): number {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return d.getUTCDate();
}

function dateAddDays(date: string, n: number): string {
  const d = new Date(date + "T00:00:00+09:00");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

interface PeriodAgg {
  revenue: number;
  orders: number;
}

function aggregate(daily: DailyData[], from: string, to: string): PeriodAgg {
  let revenue = 0;
  let orders = 0;
  for (const d of daily) {
    if (d.date >= from && d.date <= to) {
      revenue += d.revenue;
      orders += d.orders;
    }
  }
  return { revenue, orders };
}

function deltaPct(current: number, previous: number): number | null {
  if (previous === 0) return null; // 비교 불가
  return ((current - previous) / previous) * 100;
}

interface CardData {
  label: string;
  rangeLabel: string;
  current: PeriodAgg;
  previous: PeriodAgg;
  compareLabel: string;
  accent: string;
  iconBg: string;
  icon: React.ElementType;
}

export default function SalesSummary({ daily }: { daily: DailyData[] }) {
  const [range] = useState(() => {
    const today = kstTodayStr();
    const lastMonthStart = monthStartStr(-1);
    const dayOfMonth = todayDayOfMonth();
    return {
      today,
      yesterday: daysAgoStr(1),
      previousSameWeekday: daysAgoStr(8),
      last7Start: daysAgoStr(6),
      prev7End: daysAgoStr(7),
      prev7Start: daysAgoStr(13),
      thisMonthStart: monthStartStr(0),
      lastMonthStart,
      lastMonthSameDay: dateAddDays(lastMonthStart, dayOfMonth - 1),
    };
  });

  const cards: CardData[] = [
    {
      label: "오늘",
      rangeLabel: range.today.slice(5),
      current: aggregate(daily, range.today, range.today),
      previous: aggregate(daily, range.yesterday, range.yesterday),
      compareLabel: "어제 대비",
      accent: "bg-violet-500",
      iconBg: "bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300",
      icon: Clock,
    },
    {
      label: "어제",
      rangeLabel: range.yesterday.slice(5),
      current: aggregate(daily, range.yesterday, range.yesterday),
      previous: aggregate(daily, range.previousSameWeekday, range.previousSameWeekday),
      compareLabel: "지난주 같은 요일 대비",
      accent: "bg-sky-500",
      iconBg: "bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-300",
      icon: Activity,
    },
    {
      label: "최근 7일",
      rangeLabel: `${range.last7Start.slice(5)} ~ ${range.today.slice(5)}`,
      current: aggregate(daily, range.last7Start, range.today),
      previous: aggregate(daily, range.prev7Start, range.prev7End),
      compareLabel: "직전 7일 대비",
      accent: "bg-emerald-500",
      iconBg: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300",
      icon: TrendingUp,
    },
    {
      label: "이번 달",
      rangeLabel: `${range.thisMonthStart.slice(5)} ~ ${range.today.slice(5)}`,
      current: aggregate(daily, range.thisMonthStart, range.today),
      previous: aggregate(daily, range.lastMonthStart, range.lastMonthSameDay),
      compareLabel: "지난 달 동기간 대비",
      accent: "bg-amber-500",
      iconBg: "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300",
      icon: Calendar,
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
      {cards.map((card) => {
        const Icon = card.icon;
        const delta = deltaPct(card.current.revenue, card.previous.revenue);
        const isPositive = delta !== null && delta > 0;
        const isNegative = delta !== null && delta < 0;
        return (
          <div
            key={card.label}
            className="relative min-w-0 overflow-hidden rounded-2xl border border-zinc-200/70 bg-white p-3 shadow-sm shadow-zinc-200/40 dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/20 sm:p-5"
          >
            <span className={`absolute inset-x-0 top-0 h-1 ${card.accent}`} />
            <div className="flex items-center justify-between mb-2 sm:mb-3">
              <div className="min-w-0">
                <div className="text-[11px] sm:text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                  {card.label}
                </div>
                <div className="text-[9px] sm:text-[10px] text-zinc-400 mt-0.5 truncate">
                  {card.rangeLabel}
                </div>
              </div>
              <div className={`rounded-xl p-1.5 flex-shrink-0 ${card.iconBg}`}>
                <Icon size={14} />
              </div>
            </div>

            <div className="text-base sm:text-2xl font-bold mb-1.5 sm:mb-2 tracking-tight leading-none tabular-nums truncate text-zinc-950 dark:text-zinc-50">
              {fmtKrw(card.current.revenue)}
            </div>

            <div className="flex items-center gap-1.5 mb-1">
              {delta === null ? (
                <span className="text-[10px] sm:text-xs opacity-70">
                  비교 데이터 없음
                </span>
              ) : (
                <>
                  {isPositive && <TrendingUp size={11} className="text-emerald-500" />}
                  {isNegative && <TrendingDown size={11} className="text-red-500" />}
                  <span
                    className={`text-[10px] sm:text-xs font-bold ${
                      isPositive
                        ? "text-emerald-600 dark:text-emerald-300"
                        : isNegative
                          ? "text-red-600 dark:text-red-300"
                          : "text-zinc-400"
                    }`}
                  >
                    {isPositive ? "+" : ""}
                    {delta.toFixed(1)}%
                  </span>
                  <span className="text-[10px] sm:text-xs text-zinc-400">
                    {card.compareLabel}
                  </span>
                </>
              )}
            </div>

            <div className="text-[10px] sm:text-xs text-zinc-500 dark:text-zinc-400">
              주문 {card.current.orders.toLocaleString("ko-KR")}건
            </div>
          </div>
        );
      })}
    </div>
  );
}
