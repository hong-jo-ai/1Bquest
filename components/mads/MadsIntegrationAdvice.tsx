"use client";

import { useEffect, useState } from "react";
import { Layers, AlertTriangle, ChevronDown, ChevronUp, Loader2 } from "lucide-react";

interface SmallSet {
  metaAdsetId:    string;
  name:           string;
  campaignName:   string | null;
  dailyBudget:    number | null;
  trustLevel:     string;
  conversions7d:  number;
  spend7d:        number;
  roas7d:         number;
}

interface Advice {
  triggered:           boolean;
  reason:              string;
  smallSetCount:       number;
  totalDailyBudget:    number;
  totalConversions7d:  number;
  totalSpend7d:        number;
  estDaysToLearning:   number | null;
  smallSets:           SmallSet[];
  policy: {
    minSetsToTrigger: number;
    minAvgDailyBudget: number;
    targetConversions7d: number;
  };
}

function fmtKRW(n: number) {
  if (n >= 100_000_000) return (n / 100_000_000).toFixed(1) + "억";
  if (n >= 10_000) return (n / 10_000).toFixed(1) + "만";
  return n.toLocaleString("ko-KR");
}

export default function MadsIntegrationAdvice() {
  const [advice, setAdvice]   = useState<Advice | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetch("/api/mads/integration-advice")
      .then((r) => r.json())
      .then((j) => { if (j.ok) setAdvice(j.advice); })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 px-5 py-4 flex items-center gap-2 text-zinc-400">
        <Loader2 size={14} className="animate-spin" />
        <span className="text-xs">통합 어드바이스 분석 중...</span>
      </div>
    );
  }

  if (!advice || !advice.triggered) return null;

  return (
    <div className="bg-amber-50 dark:bg-amber-950/30 rounded-2xl border border-amber-200 dark:border-amber-900/50 overflow-hidden">
      <div className="px-5 py-4">
        <div className="flex items-start gap-3 flex-wrap">
          <div className="w-9 h-9 bg-amber-500 rounded-xl flex items-center justify-center text-white shrink-0">
            <Layers size={18} />
          </div>
          <div className="flex-1 min-w-[280px]">
            <h3 className="text-sm font-bold text-amber-900 dark:text-amber-200">
              통합 권장 — 학습 미완 세트가 너무 잘게 쪼개져 있어요
            </h3>
            <p className="text-xs text-amber-800 dark:text-amber-300 mt-1 leading-relaxed">
              {advice.reason}
            </p>
          </div>
        </div>

        {/* 통합 시 효과 미리보기 */}
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="대상 세트" value={`${advice.smallSetCount}개`} />
          <Stat label="합산 일예산" value={`${fmtKRW(advice.totalDailyBudget)}원`} />
          <Stat label="합산 7일 전환" value={`${advice.totalConversions7d}건`} />
          <Stat
            label="통합 시 학습 도달"
            value={advice.estDaysToLearning ? `약 ${advice.estDaysToLearning}일` : "-"}
            highlight
          />
        </div>

        <div className="mt-4 flex items-start gap-2 bg-amber-100/60 dark:bg-amber-900/30 rounded-lg px-3 py-2">
          <AlertTriangle size={12} className="text-amber-700 dark:text-amber-300 shrink-0 mt-0.5" />
          <p className="text-[11px] text-amber-800 dark:text-amber-300 leading-relaxed">
            <strong>실행 가이드</strong>: Meta 광고 관리자에서 가장 성과가 좋은 1~2개 세트만 남기고 나머지를 일시중지 → 남긴 세트의 일예산을 합산값({fmtKRW(advice.totalDailyBudget)}원) 근처로 올리기. 동일 캠페인 내 통합이 안전합니다.
          </p>
        </div>

        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 text-xs font-medium text-amber-800 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-200 flex items-center gap-1"
        >
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          {expanded ? "대상 세트 닫기" : `대상 세트 ${advice.smallSetCount}개 보기`}
        </button>
      </div>

      {expanded && (
        <div className="border-t border-amber-200 dark:border-amber-900/50 bg-white/60 dark:bg-zinc-900/40 px-5 py-3 max-h-80 overflow-y-auto">
          <ul className="divide-y divide-amber-100 dark:divide-amber-900/30 text-xs">
            {advice.smallSets.map((s) => (
              <li key={s.metaAdsetId} className="py-2 flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-[180px]">
                  <p className="font-medium text-zinc-800 dark:text-zinc-200 truncate">{s.name}</p>
                  <p className="text-[10px] text-zinc-500 truncate">{s.campaignName ?? "-"}</p>
                </div>
                <div className="flex items-center gap-3 text-[11px] tabular-nums">
                  <span className="text-zinc-500">{s.trustLevel}</span>
                  <span className="text-zinc-700 dark:text-zinc-300">{s.dailyBudget ? fmtKRW(s.dailyBudget) + "원/일" : "-"}</span>
                  <span className="text-zinc-700 dark:text-zinc-300">{s.conversions7d}전환</span>
                  <span className="text-zinc-700 dark:text-zinc-300">{s.roas7d > 0 ? s.roas7d.toFixed(2) + "x" : "-"}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg px-3 py-2 ${highlight ? "bg-amber-500/10 border border-amber-300 dark:border-amber-700" : "bg-white/60 dark:bg-zinc-900/40 border border-amber-200/60 dark:border-amber-900/40"}`}>
      <p className="text-[10px] text-amber-700 dark:text-amber-400">{label}</p>
      <p className={`text-sm font-bold tabular-nums mt-0.5 ${highlight ? "text-amber-900 dark:text-amber-200" : "text-zinc-800 dark:text-zinc-200"}`}>
        {value}
      </p>
    </div>
  );
}
