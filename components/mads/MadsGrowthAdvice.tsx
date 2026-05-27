"use client";

import { useEffect, useState } from "react";
import {
  TrendingUp, AlertTriangle, Lightbulb, CheckCircle2, Loader2, ChevronRight,
} from "lucide-react";

type Severity = "warning" | "opportunity" | "info";

interface Advice {
  id:          string;
  severity:    Severity;
  title:       string;
  reason:      string;
  actionGuide: string;
  metrics:     Array<{ label: string; value: string }>;
}

interface Result {
  ok:             boolean;
  activeSetCount: number;
  advices:        Advice[];
}

const STYLES: Record<Severity, {
  wrap: string; icon: string; chip: string; chipText: string; Icon: typeof AlertTriangle; label: string;
}> = {
  warning: {
    wrap: "bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-900/50",
    icon: "bg-rose-500",
    chip: "bg-rose-100 dark:bg-rose-900/40", chipText: "text-rose-700 dark:text-rose-300",
    Icon: AlertTriangle, label: "주의",
  },
  opportunity: {
    wrap: "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900/50",
    icon: "bg-amber-500",
    chip: "bg-amber-100 dark:bg-amber-900/40", chipText: "text-amber-700 dark:text-amber-300",
    Icon: Lightbulb, label: "기회",
  },
  info: {
    wrap: "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900/50",
    icon: "bg-emerald-500",
    chip: "bg-emerald-100 dark:bg-emerald-900/40", chipText: "text-emerald-700 dark:text-emerald-300",
    Icon: CheckCircle2, label: "양호",
  },
};

export default function MadsGrowthAdvice() {
  const [result, setResult]   = useState<Result | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/mads/growth-advice")
      .then((r) => r.json())
      .then((j) => { if (j.ok) setResult(j); })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 px-5 py-4 flex items-center gap-2 text-zinc-400">
        <Loader2 size={14} className="animate-spin" />
        <span className="text-xs">성장 조언 분석 중...</span>
      </div>
    );
  }

  if (!result || result.advices.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 px-1">
        <TrendingUp size={16} className="text-violet-500" />
        <h2 className="text-base font-semibold text-zinc-800 dark:text-zinc-100">성장 조언</h2>
        <span className="text-xs text-zinc-400">매출·전환 개선 진단 · 활성 광고 {result.activeSetCount}개</span>
      </div>

      {result.advices.map((a) => {
        const s = STYLES[a.severity];
        return (
          <div key={a.id} className={`rounded-2xl border overflow-hidden ${s.wrap}`}>
            <div className="px-5 py-4">
              <div className="flex items-start gap-3">
                <div className={`w-9 h-9 ${s.icon} rounded-xl flex items-center justify-center text-white shrink-0`}>
                  <s.Icon size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${s.chip} ${s.chipText}`}>
                      {s.label}
                    </span>
                    <h3 className="text-sm font-bold text-zinc-800 dark:text-zinc-100">{a.title}</h3>
                  </div>
                  <p className="text-xs text-zinc-600 dark:text-zinc-300 mt-1.5 leading-relaxed">{a.reason}</p>
                </div>
              </div>

              {a.metrics.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {a.metrics.map((m) => (
                    <div key={m.label} className="rounded-lg bg-white/70 dark:bg-zinc-900/40 border border-black/5 dark:border-white/5 px-3 py-1.5">
                      <span className="text-[10px] text-zinc-400">{m.label} </span>
                      <span className="text-xs font-bold tabular-nums text-zinc-800 dark:text-zinc-200">{m.value}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-3 flex items-start gap-2 bg-white/60 dark:bg-zinc-900/40 rounded-lg px-3 py-2">
                <ChevronRight size={13} className="text-zinc-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-zinc-600 dark:text-zinc-300 leading-relaxed">
                  <strong className="text-zinc-700 dark:text-zinc-200">실행 가이드</strong> · {a.actionGuide}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
