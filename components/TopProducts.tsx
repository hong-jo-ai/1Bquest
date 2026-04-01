"use client";

import { useState } from "react";
import { RefreshCw, TrendingUp, Package } from "lucide-react";
import type { ProductRank } from "@/lib/cafe24Data";

type Period = "today" | "week" | "month" | "quarter";

interface Props {
  today: ProductRank[];
  week: ProductRank[];
  month: ProductRank[];
  isReal?: boolean;
}

const PERIODS: { key: Period; label: string; shortLabel: string }[] = [
  { key: "today",   label: "오늘",       shortLabel: "오늘"   },
  { key: "week",    label: "이번 주",    shortLabel: "이번 주" },
  { key: "month",   label: "이번 달",    shortLabel: "이번 달" },
  { key: "quarter", label: "최근 3개월", shortLabel: "3개월"   },
];

function fmt(n: number) {
  if (n >= 100_000_000) return (n / 100_000_000).toFixed(1) + "억원";
  if (n >= 10_000)      return Math.round(n / 10_000) + "만원";
  return n.toLocaleString("ko-KR") + "원";
}

const medalColors = [
  "text-yellow-400",
  "text-slate-400",
  "text-amber-600",
];
const barColors = [
  "from-yellow-400 to-amber-400",
  "from-slate-300 to-slate-400",
  "from-amber-500 to-amber-600",
];

export default function TopProducts({ today, week, month, isReal }: Props) {
  const [activePeriod, setActivePeriod] = useState<Period>("month");
  const [quarterData, setQuarterData]   = useState<ProductRank[] | null>(null);
  const [quarterLoading, setQuarterLoading] = useState(false);
  const [quarterError, setQuarterError]     = useState("");

  const handlePeriodChange = async (p: Period) => {
    setActivePeriod(p);
    if (p === "quarter" && !quarterData && !quarterLoading && isReal) {
      setQuarterLoading(true);
      setQuarterError("");
      try {
        const res  = await fetch("/api/cafe24/ranking");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `서버 오류 (${res.status})`);
        setQuarterData(data.products ?? []);
      } catch (e: any) {
        setQuarterError(e.message || "오류가 발생했습니다");
      } finally {
        setQuarterLoading(false);
      }
    }
  };

  const products: ProductRank[] = (() => {
    switch (activePeriod) {
      case "today":   return today;
      case "week":    return week;
      case "month":   return month;
      case "quarter": return isReal ? (quarterData ?? []) : month;
      default:        return month;
    }
  })();

  const max          = products[0]?.sold ?? 1;
  const totalSold    = products.reduce((s, p) => s + p.sold, 0);
  const totalRevenue = products.reduce((s, p) => s + p.revenue, 0);

  const isLoading = activePeriod === "quarter" && quarterLoading;
  const isEmpty   = !isLoading && products.length === 0;

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-zinc-100 dark:border-zinc-800 p-6 flex flex-col">

      {/* ── 헤더 ── */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-100">
            상품별 판매 순위
            <span className="text-sm font-normal text-zinc-400 ml-1.5">TOP 10</span>
          </h2>
          {!isReal && (
            <p className="text-[11px] text-zinc-400 mt-0.5">샘플 데이터</p>
          )}
        </div>

        {/* 기간 소계 */}
        {products.length > 0 && !isLoading && (
          <div className="text-right shrink-0 ml-4">
            <div className="flex items-center gap-1.5 justify-end text-zinc-500">
              <Package size={11} />
              <span className="text-xs">{totalSold.toLocaleString()}개</span>
            </div>
            <p className="text-sm font-bold text-zinc-700 dark:text-zinc-200 mt-0.5">
              {fmt(totalRevenue)}
            </p>
          </div>
        )}
      </div>

      {/* ── 기간 탭 ── */}
      <div className="flex bg-zinc-100 dark:bg-zinc-800 rounded-xl p-1 mb-5 gap-0.5">
        {PERIODS.map((p) => {
          const disabled = p.key === "quarter" && !isReal;
          return (
            <button
              key={p.key}
              onClick={() => !disabled && handlePeriodChange(p.key)}
              disabled={disabled}
              className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-all ${
                activePeriod === p.key
                  ? "bg-white dark:bg-zinc-700 text-violet-600 dark:text-violet-400 shadow-sm"
                  : disabled
                  ? "text-zinc-300 dark:text-zinc-600 cursor-not-allowed"
                  : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
              }`}
            >
              {p.shortLabel}
            </button>
          );
        })}
      </div>

      {/* ── 콘텐츠 ── */}
      <div className="flex-1">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-zinc-400">
            <RefreshCw size={20} className="animate-spin" />
            <p className="text-sm">최근 3개월 데이터 불러오는 중...</p>
          </div>

        ) : quarterError && activePeriod === "quarter" ? (
          <div className="flex flex-col items-center justify-center py-10 gap-2 text-red-400">
            <p className="text-sm font-medium">데이터 조회 실패</p>
            <p className="text-xs text-red-300">{quarterError}</p>
            <button
              onClick={() => { setQuarterError(""); handlePeriodChange("quarter"); }}
              className="mt-1 text-xs text-violet-500 hover:text-violet-700 underline"
            >
              다시 시도
            </button>
          </div>

        ) : isEmpty ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2 text-zinc-400">
            <TrendingUp size={28} className="opacity-30" />
            <p className="text-sm">이 기간에 판매 내역이 없습니다</p>
          </div>

        ) : (
          <div className="space-y-3">
            {products.map((p) => (
              <div key={p.sku || p.rank} className="flex items-center gap-3">

                {/* 순위 */}
                <span className={`w-5 text-center text-sm font-bold shrink-0 ${
                  p.rank <= 3 ? medalColors[p.rank - 1] : "text-zinc-400"
                }`}>
                  {p.rank}
                </span>

                {/* 이름 + 바 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200 truncate pr-2">
                      {p.name}
                    </span>
                    <span className="text-xs text-zinc-400 shrink-0 tabular-nums">
                      {p.sold}개
                    </span>
                  </div>
                  <div className="h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 bg-gradient-to-r ${
                        p.rank <= 3
                          ? barColors[p.rank - 1]
                          : "from-violet-400 to-purple-500"
                      }`}
                      style={{ width: `${Math.max(4, (p.sold / max) * 100)}%` }}
                    />
                  </div>
                </div>

                {/* 매출액 */}
                <span className="text-sm font-semibold text-zinc-600 dark:text-zinc-300 shrink-0 w-20 text-right tabular-nums">
                  {fmt(p.revenue)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 3개월 캐시 안내 */}
      {activePeriod === "quarter" && quarterData && (
        <p className="mt-3 text-[11px] text-zinc-400 text-right">
          조회 완료 · 페이지 새로고침 시 재조회
        </p>
      )}
    </div>
  );
}
