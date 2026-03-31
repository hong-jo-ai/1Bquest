"use client";

import { topProducts } from "@/lib/dummyData";

function fmt(n: number) {
  return n.toLocaleString("ko-KR") + "원";
}

const medalColors = ["text-yellow-400", "text-gray-400", "text-amber-600"];

export default function TopProducts() {
  const max = topProducts[0].sold;

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-zinc-100 dark:border-zinc-800 p-6">
      <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-100 mb-5">
        상품별 판매 순위 <span className="text-sm font-normal text-zinc-400 ml-1">TOP 10</span>
      </h2>
      <div className="space-y-3">
        {topProducts.map((p) => (
          <div key={p.sku} className="flex items-center gap-3 group">
            {/* Rank */}
            <span
              className={`w-6 text-center text-sm font-bold shrink-0 ${
                p.rank <= 3 ? medalColors[p.rank - 1] : "text-zinc-400"
              }`}
            >
              {p.rank}
            </span>

            {/* Bar + Name */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200 truncate pr-2">
                  {p.name}
                </span>
                <span className="text-xs text-zinc-400 shrink-0">{p.sold}개</span>
              </div>
              <div className="h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-violet-400 to-purple-500 rounded-full transition-all duration-500"
                  style={{ width: `${(p.sold / max) * 100}%` }}
                />
              </div>
            </div>

            {/* Revenue */}
            <span className="text-sm font-semibold text-zinc-600 dark:text-zinc-300 shrink-0 w-28 text-right">
              {fmt(p.revenue)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
