"use client";

/**
 * AI 성장 전략 — 데이터 근거 + 소재 기획(컷·카피) + 실행 스텝까지 나오는 팀장급 플랜.
 * 24h 캐시, "전략 다시 세우기"로 재생성.
 */
import { useCallback, useEffect, useState } from "react";
import { Brain, Loader2, RefreshCw, ChevronDown, ChevronRight } from "lucide-react";

interface Plan {
  priority: number;
  title: string;
  why: string;
  creative: { concept: string; cuts: string[]; headline: string; primaryText: string; format: string } | null;
  execution: string[];
  budget: string;
  expected: string;
  needsFromBoss: string | null;
}
interface Result { generatedAt: string; summary: string; plans: Plan[] }

function PlanCard({ p }: { p: Plan }) {
  const [open, setOpen] = useState(p.priority === 1);
  return (
    <div className="rounded-2xl border border-violet-100 dark:border-violet-900/40 bg-white dark:bg-zinc-900 overflow-hidden">
      <button onClick={() => setOpen((v) => !v)} className="w-full text-left px-5 py-3.5 flex items-center gap-3 hover:bg-violet-50/50 dark:hover:bg-violet-950/20 transition-colors">
        <span className="w-7 h-7 rounded-lg bg-violet-600 text-white text-sm font-bold flex items-center justify-center shrink-0">{p.priority}</span>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-zinc-800 dark:text-zinc-100">{p.title}</h3>
          <p className="text-[11px] text-zinc-400 mt-0.5">{p.budget} · {p.expected}</p>
        </div>
        {open ? <ChevronDown size={15} className="text-zinc-400 shrink-0" /> : <ChevronRight size={15} className="text-zinc-400 shrink-0" />}
      </button>
      {open && (
        <div className="px-5 pb-4 space-y-3 text-[13px] leading-relaxed">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-violet-500 mb-1">왜 지금</div>
            <p className="text-zinc-600 dark:text-zinc-300">{p.why}</p>
          </div>
          {p.creative && (
            <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800/50 px-4 py-3 space-y-2">
              <div className="text-[10px] font-bold uppercase tracking-wider text-violet-500">소재 기획 — {p.creative.format}</div>
              <p className="text-zinc-600 dark:text-zinc-300">{p.creative.concept}</p>
              {p.creative.cuts.length > 0 && (
                <ul className="space-y-1">
                  {p.creative.cuts.map((c, i) => (
                    <li key={i} className="text-zinc-600 dark:text-zinc-300 flex gap-2"><span className="text-zinc-400 shrink-0">컷{i + 1}</span>{c}</li>
                  ))}
                </ul>
              )}
              <div className="border-t border-zinc-200 dark:border-zinc-700 pt-2 space-y-1">
                <p className="font-semibold text-zinc-800 dark:text-zinc-100">&ldquo;{p.creative.headline}&rdquo;</p>
                <p className="text-zinc-500 dark:text-zinc-400 whitespace-pre-line text-xs">{p.creative.primaryText}</p>
              </div>
            </div>
          )}
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-violet-500 mb-1">실행 순서</div>
            <ol className="space-y-1">
              {p.execution.map((s, i) => (
                <li key={i} className="text-zinc-600 dark:text-zinc-300 flex gap-2"><span className="text-violet-400 font-bold shrink-0">{i + 1}.</span>{s}</li>
              ))}
            </ol>
          </div>
          {p.needsFromBoss && (
            <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              <strong>대표 결정 필요</strong> · {p.needsFromBoss}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function MadsGrowthPlan() {
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true);
  const [regen, setRegen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (force: boolean) => {
    force ? setRegen(true) : setLoading(true);
    try {
      const r = await fetch("/api/mads/growth-plan", { method: force ? "POST" : "GET" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error ?? "생성 실패");
      setResult(j);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "생성 실패");
    } finally {
      setLoading(false); setRegen(false);
    }
  }, []);
  useEffect(() => { load(false); }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2 px-1">
        <div className="flex items-center gap-2">
          <Brain size={16} className="text-violet-500" />
          <h2 className="text-base font-semibold text-zinc-800 dark:text-zinc-100">이번 주 성장 전략</h2>
          {result && <span className="text-[11px] text-zinc-400">{result.generatedAt.slice(0, 10)} 수립</span>}
        </div>
        <button onClick={() => load(true)} disabled={regen}
          className="text-xs bg-violet-600 hover:bg-violet-700 text-white px-3 py-1.5 rounded-xl flex items-center gap-1.5 disabled:opacity-50">
          {regen ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          전략 다시 세우기
        </button>
      </div>
      {loading && (
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 px-5 py-4 flex items-center gap-2 text-zinc-400">
          <Loader2 size={14} className="animate-spin" /><span className="text-xs">전략 수립 중... (최초 생성은 ~20초)</span>
        </div>
      )}
      {error && <div className="text-xs text-red-500 px-1">{error}</div>}
      {result && (
        <>
          <p className="text-[13px] text-zinc-600 dark:text-zinc-300 leading-relaxed bg-violet-50/60 dark:bg-violet-950/20 border border-violet-100 dark:border-violet-900/40 rounded-2xl px-4 py-3">{result.summary}</p>
          {result.plans.sort((a, b) => a.priority - b.priority).map((p) => <PlanCard key={p.priority} p={p} />)}
        </>
      )}
    </div>
  );
}
