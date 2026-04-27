"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Zap, AlertCircle } from "lucide-react";
import type { ActionType } from "@/lib/mads/types";
import MadsRecCard from "./MadsRecCard";

type RecRow = React.ComponentProps<typeof MadsRecCard>["rec"];

const ACTION_PRIORITY: ActionType[] = [
  "pause",
  "creative_refresh",
  "duplicate",
  "increase",
  "decrease",
  "hold",
];

export default function MadsRecommendationsClient() {
  const [rows, setRows]       = useState<RecRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runMsg, setRunMsg]   = useState<string | null>(null);
  const [showHold, setShowHold] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/mads/recommendations?status=pending&limit=300");
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
      const res = await fetch("/api/cron/mads-evaluate");
      const data = await res.json();
      if (!data.ok) throw new Error(data.errors?.[0]?.error ?? "평가 실패");
      const c = data.counts ?? {};
      setRunMsg(
        `평가 완료: 광고세트 ${data.adsetsEvaluated}개 (계정 ${data.accounts}) · 종료 ${c.pause ?? 0} / 증액 ${c.increase ?? 0} / 복제 ${c.duplicate ?? 0} / 크리에이티브 ${c.creative_refresh ?? 0} / 보류 ${c.hold ?? 0}` +
        (data.errors?.length ? ` · 오류 ${data.errors.length}` : ""),
      );
      await load();
    } catch (e) {
      setRunMsg(`오류: ${e instanceof Error ? e.message : "실행 실패"}`);
    } finally {
      setRunning(false);
    }
  }, [running, load]);

  const grouped = useMemo(() => {
    const buckets: Record<ActionType, RecRow[]> = {
      pause: [], creative_refresh: [], duplicate: [], increase: [], decrease: [], hold: [],
    };
    for (const r of rows ?? []) {
      buckets[r.actionType].push(r);
    }
    return buckets;
  }, [rows]);

  const totalNonHold = (rows ?? []).filter((r) => r.actionType !== "hold").length;
  const totalHold = grouped.hold.length;

  return (
    <div className="space-y-5">

      {/* 액션 바 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="text-xs text-zinc-500 dark:text-zinc-400">
          {rows === null ? "로딩 중..." :
            totalNonHold === 0 && totalHold === 0 ? "대기 중인 추천 없음 — 우측 '지금 평가'를 눌러주세요" :
            <>대기 중 추천 <strong className="text-zinc-700 dark:text-zinc-200">{totalNonHold}</strong>건 처리 가능 + 보류 {totalHold}건</>
          }
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
            {running ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
            지금 평가
          </button>
        </div>
      </div>

      {runMsg && (
        <div className="text-xs text-zinc-600 dark:text-zinc-300 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl px-3 py-2">
          {runMsg}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-xl px-4 py-3 text-sm">
          <AlertCircle size={14} />{error}
        </div>
      )}

      {/* 액션 우선순위별 그리드 */}
      {ACTION_PRIORITY.filter((a) => a !== "hold").map((action) => {
        const list = grouped[action];
        if (list.length === 0) return null;
        const labels: Record<ActionType, string> = {
          pause: "🚫 종료 후보",
          creative_refresh: "🎨 크리에이티브 교체",
          duplicate: "📋 복제 확장",
          increase: "📈 증액",
          decrease: "📉 감액",
          hold: "⏸ 보류",
        };
        return (
          <section key={action}>
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-2 px-1">
              {labels[action]} <span className="text-zinc-400">({list.length})</span>
            </h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((r) => (
                <MadsRecCard key={r.id} rec={r} onDecided={load} />
              ))}
            </div>
          </section>
        );
      })}

      {/* hold 토글 */}
      {totalHold > 0 && (
        <section>
          <button
            onClick={() => setShowHold((v) => !v)}
            className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 mb-2 px-1"
          >
            {showHold ? "▾" : "▸"} 보류 항목 {totalHold}건 {showHold ? "숨기기" : "보기"}
          </button>
          {showHold && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {grouped.hold.map((r) => (
                <MadsRecCard key={r.id} rec={r} onDecided={load} />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
