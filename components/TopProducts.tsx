"use client";

import { useState } from "react";
import { RefreshCw, TrendingUp, Package, ChevronDown } from "lucide-react";
import type { ProductRank } from "@/lib/cafe24Data";

type Period = "today" | "week" | "month" | "quarter";

interface Props {
  today: ProductRank[];
  week: ProductRank[];
  month: ProductRank[];
  isReal?: boolean;
  /** 3개월 조회 대상 몰 — 해리엇 탭에서 폴바이스 순위가 나오던 문제 때문에 명시한다. */
  brand?: "paulvice" | "harriot";
  /** 지금 보고 있는 채널 이름 — 어느 채널 순위인지 화면에 명시한다. */
  channelName?: string;
  /**
   * 이 채널이 실제로 제공하는 기간.
   * 엑셀 업로드 채널은 파일 한 벌뿐이라 일/주 구분이 없다. 예전엔 없는 기간에
   * 월 데이터를 그대로 돌려줘서 오늘·이번주·이번달이 **같은 숫자**로 보였다(2026-08-30 수정).
   */
  availablePeriods?: Period[];
  /** 업로드 채널의 실제 데이터 기간 — "이번 달"이 아니라 파일이 담은 구간이다. */
  uploadPeriod?: { start: string; end: string } | null;
  /** 기간별로 집계 범위가 다를 때의 주석(예: 전체 탭의 오늘/이번주는 카페24만) */
  periodNote?: Partial<Record<Period, string>>;
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

export default function TopProducts({
  today, week, month, isReal, brand = "paulvice",
  channelName, availablePeriods, uploadPeriod, periodNote,
}: Props) {
  const periods = availablePeriods ?? ["today", "week", "month", "quarter"];
  const [activePeriod, setActivePeriod] = useState<Period>(
    periods.includes("month") ? "month" : periods[0] ?? "month",
  );
  const [quarterData, setQuarterData]   = useState<ProductRank[] | null>(null);
  const [quarterLoading, setQuarterLoading] = useState(false);
  const [quarterError, setQuarterError]     = useState("");
  // 상품명이 길어 모바일에서 잘린다. 탭하면 전체 이름·SKU 를 펼친다(사장님 요청 2026-08-30).
  const [expanded, setExpanded] = useState<string | null>(null);

  const handlePeriodChange = async (p: Period) => {
    setActivePeriod(p);
    // ⚠️ 3개월은 카페24 주문 API 로만 만든다. 업로드 채널에서 이걸 호출하면
    //    무신사 탭에 카페24 순위가 뜬다(실제로 그랬다). periods 에 quarter 가 있을 때만 부른다.
    if (p === "quarter" && !quarterData && !quarterLoading && isReal) {
      setQuarterLoading(true);
      setQuarterError("");
      try {
        const res  = await fetch(`/api/cafe24/ranking?brand=${brand}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `서버 오류 (${res.status})`);
        setQuarterData(data.products ?? []);
      } catch (e: unknown) {
        setQuarterError(e instanceof Error ? e.message : "오류가 발생했습니다");
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
          <p className="mt-0.5 text-[11px] text-zinc-400">
            {!isReal ? "실데이터 없음" : (
              <>
                {channelName ?? "전체"}
                {uploadPeriod && ` · 업로드 기간 ${uploadPeriod.start} ~ ${uploadPeriod.end}`}
                {periodNote?.[activePeriod] && ` · ${periodNote[activePeriod]}`}
              </>
            )}
          </p>
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
      <div className={`${periods.length <= 1 ? "hidden" : "flex"} bg-zinc-100 dark:bg-zinc-800 rounded-xl p-1 mb-5 gap-0.5`}>
        {PERIODS.filter((p) => periods.includes(p.key)).map((p) => {
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
            {products.map((p) => {
              const key = p.sku || String(p.rank);
              const open = expanded === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setExpanded(open ? null : key)}
                  aria-expanded={open}
                  className="flex w-full items-start gap-3 rounded-lg text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
                >
                  {/* 순위 */}
                  <span className={`w-5 shrink-0 pt-0.5 text-center text-sm font-bold ${
                    p.rank <= 3 ? medalColors[p.rank - 1] : "text-zinc-400"
                  }`}>
                    {p.rank}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-start gap-1.5">
                      {/* 접힘: 한 줄 말줄임 / 펼침: 전체 줄바꿈.
                          모바일은 이름 칸이 좁아 대부분 잘렸다 — 탭으로 전체를 확인한다. */}
                      <span className={`flex-1 text-sm font-medium text-zinc-700 dark:text-zinc-200 ${
                        open ? "whitespace-normal break-words" : "truncate"
                      }`}>
                        {p.name}
                      </span>
                      <ChevronDown
                        size={13}
                        className={`mt-0.5 shrink-0 text-zinc-300 transition-transform dark:text-zinc-600 ${open ? "rotate-180" : ""}`}
                      />
                    </div>

                    <div className="h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                      <div
                        className={`h-full rounded-full bg-gradient-to-r transition-all duration-500 ${
                          p.rank <= 3 ? barColors[p.rank - 1] : "from-violet-400 to-purple-500"
                        }`}
                        style={{ width: `${Math.max(4, (p.sold / max) * 100)}%` }}
                      />
                    </div>

                    {/* 판매량·매출을 바 아래로 내렸다. 오른쪽 고정 칸을 없애야 이름이 폭을 갖는다. */}
                    <div className="mt-1 flex items-baseline justify-between gap-2 text-xs text-zinc-400">
                      <span className="tabular-nums">{p.sold}개</span>
                      <span className="font-semibold tabular-nums text-zinc-600 dark:text-zinc-300">{fmt(p.revenue)}</span>
                    </div>

                    {open && (
                      <div className="mt-1.5 space-y-0.5 rounded-lg bg-zinc-50 px-2.5 py-2 text-[11px] text-zinc-500 dark:bg-zinc-800/60">
                        {p.sku && <div>SKU · <span className="tabular-nums text-zinc-700 dark:text-zinc-300">{p.sku}</span></div>}
                        <div>판매 {p.sold.toLocaleString("ko-KR")}개 · 매출 {p.revenue.toLocaleString("ko-KR")}원</div>
                        {p.sold > 0 && <div>객단가 {Math.round(p.revenue / p.sold).toLocaleString("ko-KR")}원</div>}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
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
