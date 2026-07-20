"use client";

/**
 * AI 성장 전략 — 데이터 근거 + 소재 기획(컷·카피) + 실행 스텝 + 즉시/수정 실행까지.
 * 24h 캐시, "전략 다시 세우기"로 재생성. 실행은 dryRun 미리보기 → 확인 → Meta 적용.
 */
import { useCallback, useEffect, useState } from "react";
import { Brain, Loader2, RefreshCw, ChevronDown, ChevronRight, Play, Pencil, CheckCircle2, XCircle } from "lucide-react";

interface PlanAction { kind: string; targetId: string; targetName: string; value: string | number; note?: string }
interface Plan {
  priority: number;
  title: string;
  why: string;
  creative: { concept: string; cuts: string[]; headline: string; primaryText: string; format: string } | null;
  execution: string[];
  actions: PlanAction[];
  budget: string;
  expected: string;
  needsFromBoss: string | null;
  executedAt?: string | null;
  executionResults?: Array<{ action: PlanAction; ok: boolean; error?: string }> | null;
}
interface Result { generatedAt: string; summary: string; plans: Plan[] }

const KIND_KO: Record<string, string> = {
  adset_budget: "세트 일예산", adset_status: "세트 상태", ad_status: "광고 상태", campaign_status: "캠페인 상태",
};
const fmtVal = (a: PlanAction) =>
  a.kind === "adset_budget" ? `₩${Number(a.value).toLocaleString()}` : String(a.value) === "ACTIVE" ? "켜기" : "끄기";

function PlanCard({ p, idx, onExecuted }: { p: Plan; idx: number; onExecuted: () => void }) {
  const [open, setOpen] = useState(p.priority === 1);
  const [mode, setMode] = useState<"idle" | "preview" | "editing">("idle");
  const [modText, setModText] = useState("");
  const [preview, setPreview] = useState<{ actions: PlanAction[]; revisionNote?: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [execMsg, setExecMsg] = useState<string | null>(null);

  const call = useCallback(async (payload: Record<string, unknown>) => {
    const r = await fetch("/api/mads/growth-plan/execute", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planIndex: idx, ...payload }),
    });
    return r.json();
  }, [idx]);

  const doPreview = useCallback(async (modification?: string) => {
    setBusy(true); setExecMsg(null);
    try {
      const j = await call(modification ? { modification } : {});
      if (!j.ok) { setExecMsg(j.error); setPreview(null); return; }
      setPreview({ actions: j.actions, revisionNote: j.revisionNote });
      setMode("preview");
    } finally { setBusy(false); }
  }, [call]);

  const doExecute = useCallback(async () => {
    setBusy(true);
    try {
      const j = await call({ confirm: true, ...(modText.trim() ? { modification: modText.trim() } : {}) });
      if (j.ok === false && j.error) { setExecMsg(j.error); return; }
      setExecMsg(null); setMode("idle"); setPreview(null);
      onExecuted();
    } finally { setBusy(false); }
  }, [call, modText, onExecuted]);

  const executed = !!p.executedAt;

  return (
    <div className={`rounded-2xl border overflow-hidden bg-white dark:bg-zinc-900 ${executed ? "border-emerald-200 dark:border-emerald-900/50" : "border-violet-100 dark:border-violet-900/40"}`}>
      <button onClick={() => setOpen((v) => !v)} className="w-full text-left px-5 py-3.5 flex items-center gap-3 hover:bg-violet-50/50 dark:hover:bg-violet-950/20 transition-colors">
        <span className={`w-7 h-7 rounded-lg text-white text-sm font-bold flex items-center justify-center shrink-0 ${executed ? "bg-emerald-500" : "bg-violet-600"}`}>
          {executed ? <CheckCircle2 size={15} /> : p.priority}
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-zinc-800 dark:text-zinc-100">{p.title}</h3>
          <p className="text-[11px] text-zinc-400 mt-0.5">
            {executed ? `✅ ${p.executedAt!.slice(0, 16).replace("T", " ")} 실행됨` : `${p.budget} · ${p.expected}`}
          </p>
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

          {/* 실행 결과 (완료 시) */}
          {executed && p.executionResults && (
            <div className="rounded-xl bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/40 px-4 py-3 space-y-1">
              <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">실행 결과</div>
              {p.executionResults.map((r, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  {r.ok ? <CheckCircle2 size={12} className="text-emerald-500 shrink-0" /> : <XCircle size={12} className="text-red-500 shrink-0" />}
                  <span className="text-zinc-600 dark:text-zinc-300">{KIND_KO[r.action.kind] ?? r.action.kind} · {r.action.targetName || r.action.targetId} → {fmtVal(r.action)}</span>
                  {r.error && <span className="text-red-500">{r.error.slice(0, 60)}</span>}
                </div>
              ))}
            </div>
          )}

          {/* 실행 컨트롤 */}
          {!executed && (
            <div className="border-t border-zinc-100 dark:border-zinc-800 pt-3 space-y-2">
              {mode === "idle" && (
                <div className="flex items-center gap-2 flex-wrap">
                  <button onClick={() => doPreview()} disabled={busy}
                    className="text-xs bg-violet-600 hover:bg-violet-700 text-white px-3.5 py-2 rounded-xl flex items-center gap-1.5 disabled:opacity-50">
                    {busy ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} 바로 실행
                  </button>
                  <button onClick={() => { setMode("editing"); setExecMsg(null); }} disabled={busy}
                    className="text-xs bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 px-3.5 py-2 rounded-xl flex items-center gap-1.5">
                    <Pencil size={12} /> 수정해서 실행
                  </button>
                  {p.actions?.length === 0 && <span className="text-[11px] text-zinc-400">※ 이 플랜은 소재 제작 등 수동 스텝 중심 — 클로드에게 지시</span>}
                </div>
              )}
              {mode === "editing" && (
                <div className="space-y-2">
                  <textarea value={modText} onChange={(e) => setModText(e.target.value)}
                    placeholder="수정 지시 — 예: 예산은 2만원 말고 1.5만원으로 / 브라운밴드 광고는 끄지 말고 유지"
                    className="w-full text-xs rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2.5 min-h-[64px] text-zinc-700 dark:text-zinc-200" />
                  <div className="flex items-center gap-2">
                    <button onClick={() => doPreview(modText.trim())} disabled={busy || !modText.trim()}
                      className="text-xs bg-violet-600 hover:bg-violet-700 text-white px-3.5 py-2 rounded-xl flex items-center gap-1.5 disabled:opacity-50">
                      {busy ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} 반영해서 미리보기
                    </button>
                    <button onClick={() => { setMode("idle"); setModText(""); }} className="text-xs text-zinc-400 px-2">취소</button>
                  </div>
                </div>
              )}
              {mode === "preview" && preview && (
                <div className="rounded-xl bg-violet-50/60 dark:bg-violet-950/20 border border-violet-100 dark:border-violet-900/40 px-4 py-3 space-y-2">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-violet-500">실행될 변경 (Meta 즉시 적용)</div>
                  {preview.revisionNote && <p className="text-xs text-violet-600 dark:text-violet-300">✏️ {preview.revisionNote}</p>}
                  <ul className="space-y-1">
                    {preview.actions.map((a, i) => (
                      <li key={i} className="text-xs text-zinc-700 dark:text-zinc-200 flex gap-2">
                        <span className="text-violet-400">•</span>{KIND_KO[a.kind] ?? a.kind} · {a.targetName || a.targetId} → <strong>{fmtVal(a)}</strong>{a.note ? ` (${a.note})` : ""}
                      </li>
                    ))}
                  </ul>
                  <div className="flex items-center gap-2 pt-1">
                    <button onClick={doExecute} disabled={busy}
                      className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-2 rounded-xl flex items-center gap-1.5 disabled:opacity-50">
                      {busy ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} 확정 실행
                    </button>
                    <button onClick={() => { setMode("idle"); setPreview(null); }} className="text-xs text-zinc-400 px-2">취소</button>
                  </div>
                </div>
              )}
              {execMsg && <p className="text-xs text-red-500">{execMsg}</p>}
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
          {result.plans.map((p, i) => ({ p, i })).sort((a, b) => a.p.priority - b.p.priority).map(({ p, i }) => (
            <PlanCard key={i} p={p} idx={i} onExecuted={() => load(false)} />
          ))}
        </>
      )}
    </div>
  );
}
