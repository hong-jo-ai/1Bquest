"use client";

import { salesSummary } from "@/lib/dummyData";
import { TrendingUp, ShoppingCart, Clock } from "lucide-react";

function fmt(n: number) {
  return n.toLocaleString("ko-KR") + "원";
}

const cards = [
  {
    label: "오늘 매출",
    period: "today",
    color: "from-violet-500 to-purple-600",
    icon: Clock,
  },
  {
    label: "이번 주 매출",
    period: "week",
    color: "from-blue-500 to-cyan-600",
    icon: TrendingUp,
  },
  {
    label: "이번 달 매출",
    period: "month",
    color: "from-emerald-500 to-teal-600",
    icon: ShoppingCart,
  },
] as const;

export default function SalesSummary() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {cards.map(({ label, period, color, icon: Icon }) => {
        const data = salesSummary[period];
        return (
          <div
            key={period}
            className={`bg-gradient-to-br ${color} rounded-2xl p-6 text-white shadow-lg`}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium opacity-80">{label}</span>
              <div className="bg-white/20 rounded-xl p-2">
                <Icon size={18} />
              </div>
            </div>
            <div className="text-3xl font-bold mb-3 tracking-tight">
              {fmt(data.revenue)}
            </div>
            <div className="flex gap-4 text-sm opacity-80">
              <span>주문 {data.orders}건</span>
              <span>·</span>
              <span>평균 {fmt(data.avgOrder)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
