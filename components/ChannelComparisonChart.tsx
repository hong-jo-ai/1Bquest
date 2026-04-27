"use client";

import { useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, LabelList,
} from "recharts";
import { CHANNELS } from "@/lib/multiChannelData";
import type { MultiChannelData } from "@/lib/multiChannelData";

interface ChannelEntry {
  channelId: string;
  name: string;
  color: string;
  data: MultiChannelData;
}

type Period = "today" | "week" | "month";

const PERIOD_LABELS: { id: Period; label: string }[] = [
  { id: "today", label: "오늘" },
  { id: "week",  label: "이번 주" },
  { id: "month", label: "이번 달" },
];

function fmt(n: number) {
  if (n >= 100_000_000) return (n / 100_000_000).toFixed(1) + "억";
  if (n >= 10_000_000)  return (n / 10_000_000).toFixed(1) + "천만";
  if (n >= 1_000_000)   return (n / 1_000_000).toFixed(1) + "백만";
  return (n / 10_000).toFixed(0) + "만";
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-zinc-900 text-white rounded-xl px-4 py-3 shadow-xl text-sm min-w-[140px]">
        <p className="font-semibold mb-2">{label}</p>
        {payload.map((p: any) => (
          <p key={p.dataKey} style={{ color: p.fill }}>
            {(p.value / 10000).toLocaleString("ko-KR")}만원
          </p>
        ))}
      </div>
    );
  }
  return null;
};

export default function ChannelComparisonChart({ channels }: { channels: ChannelEntry[] }) {
  const [period, setPeriod] = useState<Period>("month");

  const chartData = channels.map((ch) => ({
    name: ch.name,
    color: ch.color,
    revenue: ch.data.salesSummary[period].revenue,
    orders:  ch.data.salesSummary[period].orders,
  }));

  const total = chartData.reduce((s, c) => s + c.revenue, 0);

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-zinc-100 dark:border-zinc-800 p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4 sm:mb-5">
        <h2 className="text-base sm:text-lg font-semibold text-zinc-800 dark:text-zinc-100">채널별 매출 비교</h2>
        <div className="flex gap-1 bg-zinc-100 dark:bg-zinc-800 p-1 rounded-xl">
          {PERIOD_LABELS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setPeriod(id)}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                period === id
                  ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm"
                  : "text-zinc-400 hover:text-zinc-600"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* 채널별 비율 요약 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3 mb-4 sm:mb-5">
        {chartData.map((ch) => {
          const pct = total > 0 ? ((ch.revenue / total) * 100).toFixed(1) : "0";
          return (
            <div key={ch.name} className="rounded-xl p-3 sm:p-3 bg-zinc-50 dark:bg-zinc-800/50">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: ch.color }} />
                <span className="text-xs sm:text-xs text-zinc-500 truncate">{ch.name}</span>
              </div>
              <p className="text-base sm:text-base font-bold text-zinc-800 dark:text-zinc-100 tabular-nums">{fmt(ch.revenue)}</p>
              <p className="text-[11px] sm:text-xs text-zinc-400">{pct}% · {ch.orders}건</p>
            </div>
          );
        })}
      </div>

      {/* 막대 차트 */}
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={chartData} margin={{ top: 16, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#a1a1aa" }} tickLine={false} axisLine={false} />
          <YAxis
            tick={{ fontSize: 11, fill: "#a1a1aa" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => fmt(v)}
          />
          <Tooltip content={<CustomTooltip />} />
          <Bar dataKey="revenue" radius={[6, 6, 0, 0]} maxBarSize={60}>
            {chartData.map((entry, i) => (
              <Cell key={i} fill={entry.color} fillOpacity={0.85} />
            ))}
            <LabelList
              dataKey="revenue"
              position="top"
              formatter={(v: unknown) => fmt(Number(v))}
              style={{ fontSize: 11, fill: "#71717a", fontWeight: 600 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
