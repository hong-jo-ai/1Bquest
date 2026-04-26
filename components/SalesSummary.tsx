"use client";

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
  color: string;
  icon: React.ElementType;
}

export default function SalesSummary({ daily }: { daily: DailyData[] }) {
  const today = kstTodayStr();
  const yesterday = daysAgoStr(1);
  const last7Start = daysAgoStr(6); // 오늘 포함 7일
  const prev7End = daysAgoStr(7);
  const prev7Start = daysAgoStr(13);
  const last30Start = daysAgoStr(29); // 오늘 포함 30일
  const prev30End = daysAgoStr(30);
  const prev30Start = daysAgoStr(59);

  const thisMonthStart = monthStartStr(0);
  const dayOfMonth = todayDayOfMonth();
  const lastMonthStart = monthStartStr(-1);
  const lastMonthSameDay = dateAddDays(lastMonthStart, dayOfMonth - 1);

  const cards: CardData[] = [
    {
      label: "오늘",
      rangeLabel: today.slice(5),
      current: aggregate(daily, today, today),
      previous: aggregate(daily, yesterday, yesterday),
      compareLabel: "어제 대비",
      color: "from-violet-500 to-purple-600",
      icon: Clock,
    },
    {
      label: "최근 7일",
      rangeLabel: `${last7Start.slice(5)} ~ ${today.slice(5)}`,
      current: aggregate(daily, last7Start, today),
      previous: aggregate(daily, prev7Start, prev7End),
      compareLabel: "직전 7일 대비",
      color: "from-blue-500 to-cyan-600",
      icon: Activity,
    },
    {
      label: "최근 30일",
      rangeLabel: `${last30Start.slice(5)} ~ ${today.slice(5)}`,
      current: aggregate(daily, last30Start, today),
      previous: aggregate(daily, prev30Start, prev30End),
      compareLabel: "직전 30일 대비",
      color: "from-emerald-500 to-teal-600",
      icon: TrendingUp,
    },
    {
      label: "이번 달",
      rangeLabel: `${thisMonthStart.slice(5)} ~ ${today.slice(5)}`,
      current: aggregate(daily, thisMonthStart, today),
      previous: aggregate(daily, lastMonthStart, lastMonthSameDay),
      compareLabel: "지난 달 동기간 대비",
      color: "from-amber-500 to-orange-600",
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
            className={`bg-gradient-to-br ${card.color} rounded-2xl p-3.5 sm:p-5 text-white shadow-lg`}
          >
            <div className="flex items-center justify-between mb-2 sm:mb-3">
              <div className="min-w-0">
                <div className="text-[11px] sm:text-xs font-semibold opacity-90">
                  {card.label}
                </div>
                <div className="text-[9px] sm:text-[10px] opacity-60 mt-0.5 truncate">
                  {card.rangeLabel}
                </div>
              </div>
              <div className="bg-white/20 rounded-xl p-1 sm:p-1.5 flex-shrink-0">
                <Icon size={14} />
              </div>
            </div>

            <div className="text-lg sm:text-2xl font-bold mb-1.5 sm:mb-2 tracking-tight leading-none tabular-nums">
              {fmtKrw(card.current.revenue)}
            </div>

            <div className="flex items-center gap-1.5 mb-1">
              {delta === null ? (
                <span className="text-[10px] sm:text-xs opacity-70">
                  비교 데이터 없음
                </span>
              ) : (
                <>
                  {isPositive && <TrendingUp size={11} className="opacity-95" />}
                  {isNegative && <TrendingDown size={11} className="opacity-95" />}
                  <span
                    className={`text-[10px] sm:text-xs font-bold ${
                      isPositive
                        ? "opacity-100"
                        : isNegative
                          ? "opacity-100"
                          : "opacity-70"
                    }`}
                  >
                    {isPositive ? "+" : ""}
                    {delta.toFixed(1)}%
                  </span>
                  <span className="text-[10px] sm:text-xs opacity-70">
                    {card.compareLabel}
                  </span>
                </>
              )}
            </div>

            <div className="text-[10px] sm:text-xs opacity-75">
              주문 {card.current.orders.toLocaleString("ko-KR")}건
            </div>
          </div>
        );
      })}
    </div>
  );
}
