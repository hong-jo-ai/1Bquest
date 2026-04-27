"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Megaphone, Loader2, AlertCircle, ExternalLink, DollarSign, ShoppingBag, Target, Hash } from "lucide-react";

type Preset = "today" | "last7d" | "month" | "custom";

interface KpiResponse {
  ok:            boolean;
  since?:        string;
  until?:        string;
  spend?:        number;
  purchaseValue?: number;
  purchaseCount?: number;
  roas?:         number;
  accounts?:     number;
  warning?:      string;
  error?:        string;
}

function fmtKRW(n: number) {
  if (n >= 100_000_000) return (n / 100_000_000).toFixed(1) + "억원";
  if (n >= 10_000)      return (n / 10_000).toFixed(1) + "만원";
  return n.toLocaleString("ko-KR") + "원";
}

function fmtCount(n: number) {
  return n.toLocaleString("ko-KR");
}

function kstDateStr(offsetDays = 0): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

const PRESET_LABEL: Record<Preset, string> = {
  today:  "오늘",
  last7d: "최근 7일",
  month:  "이번 달",
  custom: "직접 지정",
};

interface Props {
  brand?: string;
}

export default function DashboardAdsKpi({ brand }: Props) {
  const [preset, setPreset] = useState<Preset>("last7d");
  const [since, setSince] = useState(() => kstDateStr(-6));
  const [until, setUntil] = useState(() => kstDateStr(0));
  const [data, setData] = useState<KpiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchKpi = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (preset === "custom") {
        params.set("since", since);
        params.set("until", until);
      } else {
        params.set("preset", preset);
      }
      if (brand) params.set("brand", brand);

      const res  = await fetch(`/api/meta/dashboard-kpi?${params}`);
      const json = (await res.json()) as KpiResponse;
      if (!json.ok) throw new Error(json.error ?? "조회 실패");
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "조회 실패");
    } finally {
      setLoading(false);
    }
  }, [preset, since, until, brand]);

  useEffect(() => {
    if (preset !== "custom") fetchKpi();
  }, [preset, brand, fetchKpi]);

  // custom 모드: 명시적 적용 버튼으로 트리거
  const applyCustom = () => {
    if (!since || !until) return;
    fetchKpi();
  };

  const spend         = data?.spend         ?? 0;
  const purchaseValue = data?.purchaseValue ?? 0;
  const purchaseCount = data?.purchaseCount ?? 0;
  const roas          = data?.roas          ?? 0;

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 overflow-hidden">

      {/* 헤더 */}
      <div className="px-5 sm:px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-blue-700 rounded-lg flex items-center justify-center text-white shrink-0">
            <Megaphone size={15} />
          </div>
          <div>
            <h2 className="text-base font-semibold text-zinc-800 dark:text-zinc-100">광고 성과</h2>
            <p className="text-[11px] text-zinc-400 leading-none mt-0.5">Meta 기준</p>
          </div>
        </div>

        <Link
          href="/ads"
          className="flex items-center gap-1.5 text-xs font-medium text-violet-600 dark:text-violet-400 hover:text-violet-700 px-3 py-1.5 rounded-full bg-violet-50 dark:bg-violet-900/30 hover:bg-violet-100 dark:hover:bg-violet-900/40 transition-colors"
        >
          MADS
          <ExternalLink size={12} />
        </Link>
      </div>

      {/* 기간 selector */}
      <div className="px-5 sm:px-6 pt-4 pb-2 flex items-center gap-1.5 flex-wrap">
        {(Object.keys(PRESET_LABEL) as Preset[]).map((p) => (
          <button
            key={p}
            onClick={() => setPreset(p)}
            className={`text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
              preset === p
                ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900"
                : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
            }`}
          >
            {PRESET_LABEL[p]}
          </button>
        ))}
        {data?.since && data?.until && preset !== "custom" && (
          <span className="text-[11px] text-zinc-400 ml-2">{data.since} ~ {data.until}</span>
        )}
      </div>

      {/* custom 기간 입력 */}
      {preset === "custom" && (
        <div className="px-5 sm:px-6 pb-3 flex items-center gap-2 flex-wrap">
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
          <button
            onClick={applyCustom}
            disabled={loading || !since || !until}
            className="text-xs font-semibold bg-violet-600 hover:bg-violet-700 text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
          >
            적용
          </button>
        </div>
      )}

      {/* 본문 */}
      <div className="px-5 sm:px-6 pb-5">
        {loading && (
          <div className="flex items-center justify-center py-10 gap-2 text-zinc-400">
            <Loader2 size={16} className="animate-spin" />
            <span className="text-sm">로딩 중...</span>
          </div>
        )}

        {!loading && error && (
          <div className="flex items-center gap-2 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-xl px-4 py-3 text-sm">
            <AlertCircle size={14} className="shrink-0" />
            {error.includes("미연결") ? "Meta 광고 미연결 (사이드바에서 연결)" : error}
          </div>
        )}

        {!loading && !error && data && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Kpi label="광고 지출"  value={fmtKRW(spend)}         icon={DollarSign} color="bg-blue-500" />
            <Kpi label="광고 매출"  value={fmtKRW(purchaseValue)} icon={ShoppingBag} color="bg-emerald-500" />
            <Kpi label="ROAS"      value={roas > 0 ? roas.toFixed(2) + "x" : "-"} icon={Target} color="bg-violet-500" />
            <Kpi label="전환수"    value={fmtCount(purchaseCount) + "건"} icon={Hash} color="bg-amber-500" />
          </div>
        )}

        {!loading && !error && data?.warning && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-2">{data.warning}</p>
        )}
      </div>
    </div>
  );
}

function Kpi({
  label, value, icon: Icon, color,
}: {
  label: string; value: string; icon: React.ElementType; color: string;
}) {
  return (
    <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-xl p-3.5">
      <div className="flex items-start justify-between mb-2">
        <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">{label}</p>
        <div className={`w-6 h-6 rounded-lg flex items-center justify-center ${color}`}>
          <Icon size={12} className="text-white" />
        </div>
      </div>
      <p className="text-base sm:text-lg font-bold text-zinc-800 dark:text-zinc-100 leading-none tabular-nums">{value}</p>
    </div>
  );
}
