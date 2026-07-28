"use client";

import { useState, useMemo } from "react";
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

type Period = "today" | "week" | "month" | "custom";

const PERIOD_LABELS: { id: Period; label: string }[] = [
  { id: "today",  label: "오늘" },
  { id: "week",   label: "이번 주" },
  { id: "month",  label: "이번 달" },
  { id: "custom", label: "직접 지정" },
];

function kstDateStr(offsetDays = 0): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function sumRange(daily: { date: string; revenue: number; orders: number }[] | undefined, since: string, until: string) {
  if (!daily) return { revenue: 0, orders: 0 };
  let revenue = 0;
  let orders = 0;
  for (const row of daily) {
    if (row.date >= since && row.date <= until) {
      revenue += row.revenue ?? 0;
      orders  += row.orders ?? 0;
    }
  }
  return { revenue, orders };
}

/**
 * 현재 KST 기준 today/week/month 범위.
 * salesSummary[period] 의 정적 값은 업로드 시점 기준이라 시간이 흐르면 stale —
 * dailyRevenue + 실제 오늘 날짜로 매번 계산해야 정확.
 */
function currentPeriodRange(period: "today" | "week" | "month"): { since: string; until: string } {
  const today = kstDateStr(0);
  if (period === "today") return { since: today, until: today };
  if (period === "month") return { since: today.slice(0, 7) + "-01", until: today };
  // week: 한국 주간 (월요일 시작)
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const dayOfWeek = d.getUTCDay(); // 0=일 ... 6=토
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  d.setUTCDate(d.getUTCDate() - daysFromMonday);
  return { since: d.toISOString().slice(0, 10), until: today };
}

function fmt(n: number) {
  if (n >= 100_000_000) return (n / 100_000_000).toFixed(1) + "억";
  if (n >= 10_000_000)  return (n / 10_000_000).toFixed(1) + "천만";
  if (n >= 1_000_000)   return (n / 1_000_000).toFixed(1) + "백만";
  return (n / 10_000).toFixed(0) + "만";
}

// 막대차트 X축 라벨 — 길고 여러 개라 가로로 두면 겹침. 짧게 줄이고 기울여 표기.
const SHORT_LABELS: Record<string, string> = {
  "카카오선물하기": "카카오",
  "카페24 글로벌": "글로벌",
  "롯데면세점": "롯데",
  "신세계면세점": "신세계",
};
function shortLabel(name: string) {
  return SHORT_LABELS[name] ?? name;
}

// 기울인 X축 눈금 라벨 (recharts 커스텀 tick)
const AngledTick = ({ x, y, payload }: any) => (
  <text
    x={x}
    y={y + 8}
    textAnchor="end"
    transform={`rotate(-40, ${x}, ${y + 8})`}
    style={{ fontSize: 11, fill: "#a1a1aa" }}
  >
    {payload.value}
  </text>
);

const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-zinc-900 text-white rounded-xl px-4 py-3 shadow-xl text-sm min-w-[140px]">
        <p className="font-semibold mb-2">{payload[0].payload.name}</p>
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
  const [since, setSince]   = useState(() => kstDateStr(-29));
  const [until, setUntil]   = useState(() => kstDateStr(0));

  const chartData = useMemo(() => channels.map((ch) => {
    const range = period === "custom"
      ? { since, until }
      : currentPeriodRange(period);
    const { revenue, orders } = sumRange(ch.data.dailyRevenue, range.since, range.until);
    return {
      name: ch.name,
      shortName: shortLabel(ch.name),
      color: ch.color,
      revenue,
      orders,
    };
  }), [channels, period, since, until]);

  const total = chartData.reduce((s, c) => s + c.revenue, 0);

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-zinc-100 dark:border-zinc-800 p-4 sm:p-6 min-w-0 overflow-hidden">
      <div className="flex items-center justify-between mb-4 sm:mb-5 flex-wrap gap-2">
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

      {period === "custom" && (
        <div className="flex items-center gap-2 flex-wrap mb-4 sm:mb-5">
          <input
            type="date"
            value={since}
            max={until}
            onChange={(e) => setSince(e.target.value)}
            className="text-xs px-3 py-1.5 rounded-lg bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300"
          />
          <span className="text-xs text-zinc-400">~</span>
          <input
            type="date"
            value={until}
            min={since}
            max={kstDateStr(0)}
            onChange={(e) => setUntil(e.target.value)}
            className="text-xs px-3 py-1.5 rounded-lg bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300"
          />
        </div>
      )}

      {/* 채널별 비율 요약 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3 mb-4 sm:mb-5">
        {chartData.map((ch) => {
          const pct = total > 0 ? ((ch.revenue / total) * 100).toFixed(1) : "0";
          return (
            <div key={ch.name} className="min-w-0 rounded-xl p-3 sm:p-3 bg-zinc-50 dark:bg-zinc-800/50 overflow-hidden">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: ch.color }} />
                <span className="text-xs text-zinc-500 truncate">{ch.name}</span>
              </div>
              <p className="text-sm sm:text-base font-bold text-zinc-800 dark:text-zinc-100 tabular-nums truncate">{fmt(ch.revenue)}</p>
              <p className="text-[11px] sm:text-xs text-zinc-400 truncate">{pct}% · {ch.orders}건</p>
            </div>
          );
        })}
      </div>

      {/* 막대 차트 */}
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={chartData} margin={{ top: 16, right: 16, left: -20, bottom: 36 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
          <XAxis dataKey="shortName" interval={0} tick={<AngledTick />} height={44} tickLine={false} axisLine={false} />
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
