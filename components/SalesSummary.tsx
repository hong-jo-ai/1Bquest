"use client";

import { TrendingUp, ShoppingCart, Clock, Calendar } from "lucide-react";
import type { SalesSummaryData } from "@/lib/cafe24Data";

function fmt(n: number) {
  if (n >= 100_000_000) return (n / 100_000_000).toFixed(1) + "억원";
  if (n >= 10_000)      return Math.round(n / 10_000) + "만원";
  return n.toLocaleString("ko-KR") + "원";
}

const now = new Date();
const prevMonthLabel = `${now.getMonth() === 0 ? 12 : now.getMonth()}월 매출`;

const cards = [
  { label: "오늘 매출",   period: "today"     as const, color: "from-violet-500 to-purple-600",  icon: Clock       },
  { label: "이번 주 매출", period: "week"      as const, color: "from-blue-500 to-cyan-600",      icon: TrendingUp  },
  { label: "이번 달 매출", period: "month"     as const, color: "from-emerald-500 to-teal-600",   icon: ShoppingCart },
  { label: prevMonthLabel, period: "prevMonth" as const, color: "from-zinc-500 to-zinc-600",      icon: Calendar    },
];

export default function SalesSummary({ data }: { data: SalesSummaryData }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map(({ label, period, color, icon: Icon }) => {
        const d = data[period];
        if (!d) return null;
        return (
          <div key={period} className={`bg-gradient-to-br ${color} rounded-2xl p-5 text-white shadow-lg`}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium opacity-80">{label}</span>
              <div className="bg-white/20 rounded-xl p-1.5"><Icon size={15} /></div>
            </div>
            <div className="text-2xl font-bold mb-2 tracking-tight leading-none">{fmt(d.revenue)}</div>
            <div className="flex gap-3 text-xs opacity-80">
              <span>주문 {d.orders}건</span>
              <span>·</span>
              <span>평균 {fmt(d.avgOrder)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
