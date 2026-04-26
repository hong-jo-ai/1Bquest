"use client";

import { useMemo, useState } from "react";
import { Calendar } from "lucide-react";
import type { DailyData } from "@/lib/cafe24Data";

export interface DailySalesChannel {
  id: string;
  name: string;
  color: string; // hex
  daily: DailyData[];
}

interface Props {
  channels: DailySalesChannel[];
}

type Preset = "today" | "7d" | "30d" | "60d" | "custom";

function todayStr() {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function daysAgoStr(n: number) {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function fmtKrw(n: number): string {
  if (n === 0) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toLocaleString();
}

function fmtKrwFull(n: number): string {
  return n.toLocaleString();
}

function fmtDate(date: string): string {
  // "2026-04-26" → "4/26 (토)"
  const d = new Date(date + "T00:00:00+09:00");
  const dow = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
  return `${d.getMonth() + 1}/${d.getDate()} (${dow})`;
}

export default function DailySalesTable({ channels }: Props) {
  const [preset, setPreset] = useState<Preset>("30d");
  const [customStart, setCustomStart] = useState<string>(daysAgoStr(30));
  const [customEnd, setCustomEnd] = useState<string>(todayStr());
  const [activeChannel, setActiveChannel] = useState<string>("all");

  const { startDate, endDate } = useMemo(() => {
    const t = todayStr();
    if (preset === "today") return { startDate: t, endDate: t };
    if (preset === "7d") return { startDate: daysAgoStr(6), endDate: t };
    if (preset === "30d") return { startDate: daysAgoStr(29), endDate: t };
    if (preset === "60d") return { startDate: daysAgoStr(59), endDate: t };
    return { startDate: customStart, endDate: customEnd };
  }, [preset, customStart, customEnd]);

  // 표시할 채널 (전체면 모두, 특정 채널이면 그것만)
  const visibleChannels = useMemo(
    () =>
      activeChannel === "all"
        ? channels
        : channels.filter((c) => c.id === activeChannel),
    [channels, activeChannel]
  );

  // 날짜 → 채널별 매출 맵
  const rows = useMemo(() => {
    const dateSet = new Set<string>();
    for (const ch of visibleChannels) {
      for (const d of ch.daily) {
        if (d.date >= startDate && d.date <= endDate) dateSet.add(d.date);
      }
    }
    const dates = Array.from(dateSet).sort((a, b) => b.localeCompare(a));

    return dates.map((date) => {
      const perChannel: Record<string, { revenue: number; orders: number }> = {};
      let totalRev = 0;
      let totalOrders = 0;
      for (const ch of visibleChannels) {
        const found = ch.daily.find((d) => d.date === date);
        const rev = found?.revenue ?? 0;
        const ord = found?.orders ?? 0;
        perChannel[ch.id] = { revenue: rev, orders: ord };
        totalRev += rev;
        totalOrders += ord;
      }
      return { date, perChannel, totalRev, totalOrders };
    });
  }, [visibleChannels, startDate, endDate]);

  const totals = useMemo(() => {
    const perChannel: Record<string, { revenue: number; orders: number }> = {};
    let totalRev = 0;
    let totalOrders = 0;
    for (const ch of visibleChannels) {
      const sum = { revenue: 0, orders: 0 };
      for (const r of rows) {
        sum.revenue += r.perChannel[ch.id]?.revenue ?? 0;
        sum.orders += r.perChannel[ch.id]?.orders ?? 0;
      }
      perChannel[ch.id] = sum;
      totalRev += sum.revenue;
      totalOrders += sum.orders;
    }
    return { perChannel, totalRev, totalOrders };
  }, [visibleChannels, rows]);

  const showAllChannels = activeChannel === "all" && channels.length > 1;

  return (
    <section className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 overflow-hidden">
      {/* 헤더 */}
      <div className="px-4 sm:px-6 py-4 border-b border-zinc-100 dark:border-zinc-800">
        <div className="flex items-center gap-2 mb-3">
          <Calendar size={16} className="text-violet-600" />
          <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
            일별 매출 상세
          </h2>
          <span className="text-xs text-zinc-500 ml-auto">
            {startDate} ~ {endDate} · {rows.length}일
          </span>
        </div>

        {/* 기간 프리셋 + 채널 필터 */}
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              { k: "today" as const, label: "오늘" },
              { k: "7d" as const, label: "7일" },
              { k: "30d" as const, label: "30일" },
              { k: "60d" as const, label: "60일" },
              { k: "custom" as const, label: "직접" },
            ]
          ).map(({ k, label }) => (
            <button
              key={k}
              onClick={() => setPreset(k)}
              className={`px-3 h-8 rounded-full text-xs font-medium transition ${
                preset === k
                  ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900"
                  : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
              }`}
            >
              {label}
            </button>
          ))}

          {preset === "custom" && (
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="px-2 h-8 rounded-md text-xs border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
              <span className="text-xs text-zinc-400">~</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="px-2 h-8 rounded-md text-xs border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
          )}

          <span className="hidden sm:block w-px h-5 bg-zinc-200 dark:bg-zinc-700 mx-1" />

          <button
            onClick={() => setActiveChannel("all")}
            className={`px-3 h-8 rounded-full text-xs font-medium transition ${
              activeChannel === "all"
                ? "bg-violet-600 text-white"
                : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
            }`}
          >
            전체
          </button>
          {channels.map((ch) => (
            <button
              key={ch.id}
              onClick={() => setActiveChannel(ch.id)}
              className={`px-3 h-8 rounded-full text-xs font-medium transition flex items-center gap-1.5 ${
                activeChannel === ch.id
                  ? "text-white"
                  : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
              }`}
              style={
                activeChannel === ch.id
                  ? { backgroundColor: ch.color }
                  : undefined
              }
            >
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: ch.color }}
              />
              {ch.name}
            </button>
          ))}
        </div>
      </div>

      {/* 표 */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-zinc-50 dark:bg-zinc-950/50 border-b border-zinc-100 dark:border-zinc-800">
              <th className="px-4 py-2.5 text-left font-semibold text-zinc-600 dark:text-zinc-400 text-xs whitespace-nowrap sticky left-0 bg-zinc-50 dark:bg-zinc-950/50 z-10">
                날짜
              </th>
              {showAllChannels &&
                channels.map((ch) => (
                  <th
                    key={ch.id}
                    className="px-4 py-2.5 text-right font-semibold text-zinc-600 dark:text-zinc-400 text-xs whitespace-nowrap"
                    style={{ color: ch.color }}
                  >
                    {ch.name}
                  </th>
                ))}
              <th className="px-4 py-2.5 text-right font-bold text-zinc-700 dark:text-zinc-300 text-xs whitespace-nowrap">
                {showAllChannels ? "합계" : "매출"}
              </th>
              <th className="px-4 py-2.5 text-right font-semibold text-zinc-600 dark:text-zinc-400 text-xs whitespace-nowrap">
                주문
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={showAllChannels ? channels.length + 3 : 3}
                  className="px-4 py-12 text-center text-sm text-zinc-400"
                >
                  해당 기간의 매출 데이터가 없습니다
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.date}
                  className="border-b border-zinc-50 dark:border-zinc-800/50 hover:bg-zinc-50 dark:hover:bg-zinc-800/30"
                >
                  <td className="px-4 py-2.5 text-zinc-700 dark:text-zinc-300 whitespace-nowrap sticky left-0 bg-white dark:bg-zinc-900 z-10">
                    {fmtDate(r.date)}
                  </td>
                  {showAllChannels &&
                    channels.map((ch) => {
                      const v = r.perChannel[ch.id];
                      return (
                        <td
                          key={ch.id}
                          className="px-4 py-2.5 text-right text-zinc-600 dark:text-zinc-400 tabular-nums whitespace-nowrap"
                          title={fmtKrwFull(v?.revenue ?? 0)}
                        >
                          {fmtKrw(v?.revenue ?? 0)}
                        </td>
                      );
                    })}
                  <td
                    className="px-4 py-2.5 text-right font-semibold text-zinc-900 dark:text-zinc-100 tabular-nums whitespace-nowrap"
                    title={fmtKrwFull(r.totalRev)}
                  >
                    {fmtKrw(r.totalRev)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-zinc-500 tabular-nums whitespace-nowrap">
                    {r.totalOrders}건
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="bg-zinc-50 dark:bg-zinc-950/50 border-t-2 border-zinc-200 dark:border-zinc-700 font-bold">
                <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300 sticky left-0 bg-zinc-50 dark:bg-zinc-950/50 z-10">
                  합계
                </td>
                {showAllChannels &&
                  channels.map((ch) => {
                    const v = totals.perChannel[ch.id];
                    return (
                      <td
                        key={ch.id}
                        className="px-4 py-3 text-right tabular-nums"
                        style={{ color: ch.color }}
                        title={fmtKrwFull(v?.revenue ?? 0)}
                      >
                        {fmtKrw(v?.revenue ?? 0)}
                      </td>
                    );
                  })}
                <td
                  className="px-4 py-3 text-right text-zinc-900 dark:text-zinc-100 tabular-nums"
                  title={fmtKrwFull(totals.totalRev)}
                >
                  {fmtKrw(totals.totalRev)}
                </td>
                <td className="px-4 py-3 text-right text-zinc-700 dark:text-zinc-300 tabular-nums">
                  {totals.totalOrders}건
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
  );
}
