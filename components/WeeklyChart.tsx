"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { weeklyRevenue } from "@/lib/dummyData";

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-zinc-900 text-white rounded-xl px-4 py-3 shadow-xl text-sm">
        <p className="font-semibold mb-1">{label}요일</p>
        <p className="text-blue-300">
          {(payload[0]?.value / 10000).toLocaleString("ko-KR")}만원
        </p>
        <p className="text-zinc-400">주문 {payload[1]?.value}건</p>
      </div>
    );
  }
  return null;
};

export default function WeeklyChart() {
  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-zinc-100 dark:border-zinc-800 p-6">
      <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-100 mb-5">
        이번 주 일별 매출
      </h2>
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={weeklyRevenue} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
          <XAxis
            dataKey="day"
            tick={{ fontSize: 12, fill: "#a1a1aa" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => v + "요일"}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "#a1a1aa" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `${(v / 10000000).toFixed(0)}천만`}
          />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey="revenue"
            stroke="#3b82f6"
            strokeWidth={2.5}
            fill="url(#revenueGrad)"
          />
          <Area
            type="monotone"
            dataKey="orders"
            stroke="transparent"
            fill="transparent"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
