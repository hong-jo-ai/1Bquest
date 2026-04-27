"use client";

import { useEffect, useState, useCallback } from "react";
import { Loader2, RefreshCw, AlertCircle, TrendingUp, TrendingDown, Minus, Ban, Info } from "lucide-react";
import type { AutoBudgetLogRow } from "@/app/api/meta/auto-budget/log/route";
import { ACTION_LABEL_KO, REASON_LABEL_KO, POLICY } from "@/lib/metaAutoBudget";

function fmtKRW(n: number) {
  if (n >= 100_000_000) return (n / 100_000_000).toFixed(1) + "억";
  if (n >= 10_000)      return Math.round(n / 10_000) + "만";
  return n.toLocaleString("ko-KR");
}

function actionStyle(action: AutoBudgetLogRow["action"]) {
  switch (action) {
    case "increase":
      return { bg: "bg-emerald-50 dark:bg-emerald-900/30", text: "text-emerald-600 dark:text-emerald-400", icon: TrendingUp };
    case "decrease":
      return { bg: "bg-amber-50 dark:bg-amber-900/30",     text: "text-amber-600  dark:text-amber-400",   icon: TrendingDown };
    case "maintain":
      return { bg: "bg-zinc-100 dark:bg-zinc-800",         text: "text-zinc-600   dark:text-zinc-300",    icon: Minus };
    case "skipped":
    default:
      return { bg: "bg-zinc-50 dark:bg-zinc-900",          text: "text-zinc-400   dark:text-zinc-500",    icon: Ban };
  }
}

export default function MetaAutoBudgetTab() {
  const [rows,    setRows]    = useState<AutoBudgetLogRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runMsg,  setRunMsg]  = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch("/api/meta/auto-budget/log?days=14");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "조회 실패");
      setRows(data.rows ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "조회 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const runNow = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setRunMsg(null);
    try {
      const res  = await fetch("/api/meta/auto-budget/recommend");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "실행 실패");
      const c = data.counts ?? {};
      setRunMsg(
        `완료 (${data.runDate}): 총 ${data.recommendations}건 · 증액 ${c.increase ?? 0} / 감액 ${c.decrease ?? 0} / 유지 ${c.maintain ?? 0} / 제외 ${c.skipped ?? 0}`
      );
      await load();
    } catch (e) {
      setRunMsg(`오류: ${e instanceof Error ? e.message : "실행 실패"}`);
    } finally {
      setRunning(false);
    }
  }, [running, load]);

  // 오늘 날짜 group + 이전 날짜
  const today = rows && rows.length > 0 ? rows[0].run_date : null;
  const todayRows = rows?.filter((r) => r.run_date === today) ?? [];
  const counts = todayRows.reduce(
    (acc, r) => { acc[r.action] = (acc[r.action] ?? 0) + 1; return acc; },
    {} as Record<string, number>
  );

  return (
    <div className="px-4 sm:px-6 py-5 space-y-5">

      {/* 정책 배너 */}
      <div className="bg-violet-50 dark:bg-violet-950/30 border border-violet-100 dark:border-violet-900/50 rounded-xl px-4 py-3 flex items-start gap-2">
        <Info size={14} className="text-violet-500 mt-0.5 shrink-0" />
        <div className="text-xs text-violet-700 dark:text-violet-300 leading-relaxed">
          <strong>Dry-run (추천만)</strong> · 실제 광고세트 예산은 변경되지 않습니다.
          7일 ROAS ≥ {POLICY.ROAS_HIGH} → +{POLICY.DELTA_PCT}% / ≤ {POLICY.ROAS_LOW} → -{POLICY.DELTA_PCT}% / 그 외 유지.
          7일 지출 &lt; {(POLICY.MIN_SPEND_KRW / 10_000)}만원 · 일 예산 하한 {(POLICY.MIN_BUDGET_KRW / 1_000)}천원.
          매일 KST 09:00 자동 실행.
        </div>
      </div>

      {/* 액션 카운트 + 수동 실행 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          {today && (
            <span className="text-xs text-zinc-500 dark:text-zinc-400 mr-1">
              최근 실행: <strong>{today}</strong>
            </span>
          )}
          <span className="text-xs font-semibold bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 px-2 py-1 rounded-full">증액 {counts.increase ?? 0}</span>
          <span className="text-xs font-semibold bg-amber-50  dark:bg-amber-900/30  text-amber-600  dark:text-amber-400  px-2 py-1 rounded-full">감액 {counts.decrease ?? 0}</span>
          <span className="text-xs font-semibold bg-zinc-100  dark:bg-zinc-800       text-zinc-600   dark:text-zinc-300   px-2 py-1 rounded-full">유지 {counts.maintain ?? 0}</span>
          <span className="text-xs font-semibold bg-zinc-50   dark:bg-zinc-900       text-zinc-400   dark:text-zinc-500   px-2 py-1 rounded-full">제외 {counts.skipped ?? 0}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="text-xs bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 px-3 py-2 rounded-xl flex items-center gap-1.5 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
            새로고침
          </button>
          <button
            onClick={runNow}
            disabled={running}
            className="text-xs bg-violet-600 hover:bg-violet-700 text-white px-3 py-2 rounded-xl flex items-center gap-1.5 transition-colors disabled:opacity-50"
          >
            {running ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            지금 추천 산출
          </button>
        </div>
      </div>

      {runMsg && (
        <div className="text-xs text-zinc-600 dark:text-zinc-300 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl px-3 py-2">
          {runMsg}
        </div>
      )}

      {/* 본문 */}
      {loading && rows === null && (
        <div className="flex items-center justify-center py-12 gap-2 text-zinc-400">
          <Loader2 size={18} className="animate-spin" />
          <span className="text-sm">추천 로그 로딩 중...</span>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-xl px-4 py-3 text-sm">
          <AlertCircle size={14} />{error}
        </div>
      )}

      {!loading && !error && rows !== null && rows.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-zinc-400 gap-2">
          <p className="text-sm">아직 추천 로그가 없습니다</p>
          <p className="text-xs">우측 상단 &lsquo;지금 추천 산출&rsquo;을 눌러 첫 추천을 생성해보세요.</p>
        </div>
      )}

      {!loading && !error && rows !== null && rows.length > 0 && (
        <>
          {/* 데스크탑: 표 */}
          <div className="hidden md:block overflow-x-auto rounded-xl border border-zinc-100 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 dark:bg-zinc-800/30">
                <tr>
                  <th className="text-left  px-3 py-2.5 text-[11px] font-medium text-zinc-400 uppercase">날짜</th>
                  <th className="text-left  px-3 py-2.5 text-[11px] font-medium text-zinc-400 uppercase">광고세트</th>
                  <th className="text-right px-3 py-2.5 text-[11px] font-medium text-zinc-400 uppercase">7d 지출</th>
                  <th className="text-right px-3 py-2.5 text-[11px] font-medium text-zinc-400 uppercase">7d ROAS</th>
                  <th className="text-right px-3 py-2.5 text-[11px] font-medium text-zinc-400 uppercase">현재 일예산</th>
                  <th className="text-right px-3 py-2.5 text-[11px] font-medium text-zinc-400 uppercase">추천 일예산</th>
                  <th className="text-left  px-3 py-2.5 text-[11px] font-medium text-zinc-400 uppercase">판정</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-50 dark:divide-zinc-800/50">
                {rows.map((r) => {
                  const st = actionStyle(r.action);
                  const Icon = st.icon;
                  return (
                    <tr key={`${r.run_date}-${r.adset_id}`} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30">
                      <td className="px-3 py-2.5 text-xs text-zinc-500 dark:text-zinc-400 whitespace-nowrap">{r.run_date}</td>
                      <td className="px-3 py-2.5">
                        <p className="text-xs font-medium text-zinc-800 dark:text-zinc-100 truncate max-w-[260px]">{r.adset_name ?? r.adset_id}</p>
                        <p className="text-[10px] text-zinc-400 truncate max-w-[260px]">{r.campaign_name ?? "-"}</p>
                      </td>
                      <td className="px-3 py-2.5 text-right text-xs tabular-nums text-zinc-600 dark:text-zinc-300">{fmtKRW(r.spend_7d)}</td>
                      <td className="px-3 py-2.5 text-right text-xs tabular-nums font-semibold text-zinc-700 dark:text-zinc-200">
                        {r.roas_7d > 0 ? r.roas_7d.toFixed(2) + "x" : "-"}
                      </td>
                      <td className="px-3 py-2.5 text-right text-xs tabular-nums text-zinc-600 dark:text-zinc-300">{fmtKRW(r.current_budget / 100)}</td>
                      <td className={`px-3 py-2.5 text-right text-xs tabular-nums font-semibold ${st.text}`}>
                        {fmtKRW(r.recommended_budget / 100)}
                        {r.delta_pct !== 0 && (
                          <span className="ml-1 text-[10px] opacity-70">
                            {r.delta_pct > 0 ? "+" : ""}{r.delta_pct}%
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex items-center gap-1 text-[10px] font-semibold ${st.bg} ${st.text} px-2 py-0.5 rounded-full`}>
                          <Icon size={10} />
                          {ACTION_LABEL_KO[r.action]}
                        </span>
                        {r.reason && (
                          <p className="text-[10px] text-zinc-400 mt-0.5">{REASON_LABEL_KO[r.reason as keyof typeof REASON_LABEL_KO] ?? r.reason}</p>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* 모바일: 카드 뷰 */}
          <div className="md:hidden space-y-2">
            {rows.map((r) => {
              const st = actionStyle(r.action);
              const Icon = st.icon;
              return (
                <div
                  key={`${r.run_date}-${r.adset_id}`}
                  className="bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 rounded-xl px-3 py-3"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-zinc-800 dark:text-zinc-100 truncate">{r.adset_name ?? r.adset_id}</p>
                      <p className="text-[10px] text-zinc-400 truncate">{r.campaign_name ?? "-"} · {r.run_date}</p>
                    </div>
                    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold ${st.bg} ${st.text} px-2 py-0.5 rounded-full shrink-0`}>
                      <Icon size={10} />
                      {ACTION_LABEL_KO[r.action]}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-center">
                    <div>
                      <p className="text-[10px] text-zinc-400">7d 지출</p>
                      <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-200 tabular-nums mt-0.5">{fmtKRW(r.spend_7d)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-zinc-400">7d ROAS</p>
                      <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-200 tabular-nums mt-0.5">{r.roas_7d > 0 ? r.roas_7d.toFixed(2) + "x" : "-"}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-zinc-400">현재</p>
                      <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-200 tabular-nums mt-0.5">{fmtKRW(r.current_budget / 100)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-zinc-400">추천</p>
                      <p className={`text-xs font-semibold tabular-nums mt-0.5 ${st.text}`}>
                        {fmtKRW(r.recommended_budget / 100)}
                      </p>
                    </div>
                  </div>
                  {r.reason && (
                    <p className="text-[10px] text-zinc-400 mt-2 truncate">
                      {REASON_LABEL_KO[r.reason as keyof typeof REASON_LABEL_KO] ?? r.reason}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
