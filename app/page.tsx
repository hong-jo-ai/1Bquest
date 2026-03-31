import SalesSummary from "@/components/SalesSummary";
import TopProducts from "@/components/TopProducts";
import HourlyChart from "@/components/HourlyChart";
import WeeklyChart from "@/components/WeeklyChart";
import InventoryStatus from "@/components/InventoryStatus";
import { RefreshCw, Watch } from "lucide-react";

export default function Dashboard() {
  const now = new Date().toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      {/* Header */}
      <header className="bg-white dark:bg-zinc-900 border-b border-zinc-100 dark:border-zinc-800 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl p-2">
              <Watch size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 tracking-tight">
                PAULVICE
              </h1>
              <p className="text-xs text-zinc-400">Sales Dashboard · 카페24</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-400 hidden sm:block">
              마지막 업데이트: {now}
            </span>
            <div className="flex items-center gap-1.5 text-xs font-medium bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 px-3 py-1.5 rounded-full">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
              더미 데이터
            </div>
            <button className="p-2 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-zinc-500">
              <RefreshCw size={16} />
            </button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {/* Sales Summary Cards */}
        <SalesSummary />

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <HourlyChart />
          </div>
          <div>
            <WeeklyChart />
          </div>
        </div>

        {/* Bottom Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <TopProducts />
          <InventoryStatus />
        </div>
      </main>

      {/* Footer */}
      <footer className="max-w-7xl mx-auto px-6 py-6 text-center text-xs text-zinc-300 dark:text-zinc-600">
        PAULVICE Dashboard · 카페24 API 연동 준비 완료 · 현재 더미 데이터 표시 중
      </footer>
    </div>
  );
}
