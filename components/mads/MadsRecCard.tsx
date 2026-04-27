"use client";

import { useState } from "react";
import { Loader2, Check, X, Clock, AlertTriangle, TrendingUp, TrendingDown, PauseCircle, Copy, Sparkles, Pause } from "lucide-react";
import type { ActionType } from "@/lib/mads/types";
import { ACTION_LABEL_KO } from "@/lib/mads/ruleEngine";
import MadsTrustBadge from "./MadsTrustBadge";

interface RecCardProps {
  rec: {
    id: string;
    metaAdsetId: string;
    actionType: ActionType;
    currentBudget: number | null;
    recommendedBudget: number | null;
    deltaPct: number | null;
    reason: string;
    warnings: { code: string; message: string }[];
    expiresAt: string | null;
    adset: {
      name: string;
      campaignName: string | null;
      accountName: string | null;
      funnelStage: string;
    } | null;
    trust: {
      level: "untrusted" | "learning" | "trusted" | "decaying";
      conversions7d: number;
      spend7d: number;
      roas7d: number;
      adjustedRoas7d: number;
    } | null;
  };
  onDecided: () => void;
}

const ACTION_STYLE: Record<ActionType, { bg: string; border: string; icon: React.ElementType; text: string }> = {
  pause:            { bg: "bg-red-50 dark:bg-red-950/30",         border: "border-red-200 dark:border-red-900/50",           icon: PauseCircle, text: "text-red-700 dark:text-red-400"        },
  increase:         { bg: "bg-emerald-50 dark:bg-emerald-950/30", border: "border-emerald-200 dark:border-emerald-900/50",   icon: TrendingUp,  text: "text-emerald-700 dark:text-emerald-400" },
  decrease:         { bg: "bg-amber-50 dark:bg-amber-950/30",     border: "border-amber-200 dark:border-amber-900/50",       icon: TrendingDown,text: "text-amber-700 dark:text-amber-400"     },
  duplicate:        { bg: "bg-blue-50 dark:bg-blue-950/30",       border: "border-blue-200 dark:border-blue-900/50",         icon: Copy,        text: "text-blue-700 dark:text-blue-400"       },
  creative_refresh: { bg: "bg-violet-50 dark:bg-violet-950/30",   border: "border-violet-200 dark:border-violet-900/50",     icon: Sparkles,    text: "text-violet-700 dark:text-violet-400"   },
  hold:             { bg: "bg-zinc-50 dark:bg-zinc-900/40",       border: "border-zinc-200 dark:border-zinc-800",            icon: Pause,       text: "text-zinc-600 dark:text-zinc-400"       },
};

function fmtKRW(n: number) {
  if (n >= 100_000_000) return (n / 100_000_000).toFixed(1) + "억";
  if (n >= 10_000) return (n / 10_000).toFixed(1) + "만";
  return n.toLocaleString("ko-KR");
}

function fmtFunnel(s: string) {
  return s === "prospecting" ? "신규" : s === "retargeting" ? "리타게팅" : "분류미상";
}

export default function MadsRecCard({ rec, onDecided }: RecCardProps) {
  const [busy, setBusy] = useState<"accept" | "reject" | "ignore" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const style = ACTION_STYLE[rec.actionType];
  const Icon = style.icon;

  const decide = async (decision: "accept" | "reject" | "ignore") => {
    if (busy) return;

    if (decision === "accept" && (rec.actionType === "pause" || rec.actionType === "duplicate")) {
      const verb = rec.actionType === "pause" ? "일시중지" : "복제";
      if (!confirm(`광고세트 "${rec.adset?.name ?? rec.metaAdsetId}"를 ${verb}하시겠습니까?\nMeta에 즉시 반영됩니다.`)) return;
    }

    setBusy(decision);
    setError(null);
    try {
      const res = await fetch("/api/mads/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recommendationId: rec.id, decision }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "처리 실패");
      onDecided();
    } catch (e) {
      setError(e instanceof Error ? e.message : "처리 실패");
    } finally {
      setBusy(null);
    }
  };

  const canApply = rec.actionType !== "hold" && rec.actionType !== "creative_refresh";
  const wobbling = rec.warnings.some((w) => w.code === "wobble");

  return (
    <div className={`rounded-2xl border ${style.border} ${style.bg} overflow-hidden`}>
      <div className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Icon size={16} className={style.text} />
          <span className={`text-xs font-bold ${style.text}`}>{ACTION_LABEL_KO[rec.actionType]}</span>
          {rec.deltaPct !== null && rec.deltaPct !== 0 && (
            <span className={`text-xs font-semibold ${style.text}`}>
              {rec.deltaPct > 0 ? "+" : ""}{rec.deltaPct}%
            </span>
          )}
          {rec.trust && <MadsTrustBadge level={rec.trust.level} conv7d={rec.trust.conversions7d} />}
          <span className="text-[10px] text-zinc-400">· {fmtFunnel(rec.adset?.funnelStage ?? "unknown")}</span>
        </div>
        {rec.expiresAt && (
          <span className="text-[10px] text-zinc-400 flex items-center gap-1">
            <Clock size={10} />
            {new Date(rec.expiresAt).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric", hour: "numeric" })} 만료
          </span>
        )}
      </div>

      <div className="px-4 pb-3">
        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
          {rec.adset?.name ?? rec.metaAdsetId}
        </p>
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
          {rec.adset?.campaignName ?? "-"}{rec.adset?.accountName ? ` · ${rec.adset.accountName}` : ""}
        </p>
      </div>

      {/* 메트릭 그리드 */}
      <div className="px-4 pb-3 grid grid-cols-4 gap-2 text-center">
        <Cell label="7d ROAS" value={rec.trust ? rec.trust.roas7d.toFixed(2) + "x" : "-"} />
        <Cell label="보정 ROAS" value={rec.trust ? rec.trust.adjustedRoas7d.toFixed(2) + "x" : "-"} />
        <Cell label="7d 지출" value={rec.trust ? fmtKRW(rec.trust.spend7d) + "원" : "-"} />
        <Cell label="현재 예산" value={rec.currentBudget ? fmtKRW(rec.currentBudget) + "원/일" : "CBO"} />
      </div>

      {rec.recommendedBudget !== null && rec.actionType !== "hold" && rec.actionType !== "pause" && rec.recommendedBudget !== rec.currentBudget && (
        <div className="px-4 pb-3">
          <div className="rounded-lg bg-white/60 dark:bg-zinc-900/40 border border-zinc-200/60 dark:border-zinc-800 px-3 py-2 flex items-center justify-between">
            <span className="text-[11px] text-zinc-500">추천 일예산</span>
            <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100">{fmtKRW(rec.recommendedBudget)}원/일</span>
          </div>
        </div>
      )}

      {/* 추천 사유 */}
      <div className="px-4 pb-3">
        <p className="text-[11px] text-zinc-600 dark:text-zinc-400 leading-relaxed">
          {rec.reason}
        </p>
      </div>

      {/* 경고 */}
      {rec.warnings.length > 0 && (
        <div className="px-4 pb-3 space-y-1">
          {rec.warnings.map((w) => (
            <div key={w.code} className="flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-400 bg-amber-50/80 dark:bg-amber-950/30 rounded-lg px-2 py-1.5">
              <AlertTriangle size={11} className="mt-0.5 shrink-0" />
              <span>{w.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* 의사결정 버튼 */}
      <div className="px-4 py-3 border-t border-zinc-200/60 dark:border-zinc-800/50 bg-white/40 dark:bg-zinc-900/30 flex items-center gap-2 flex-wrap">
        {canApply && (
          <button
            onClick={() => decide("accept")}
            disabled={busy !== null}
            className={`flex-1 min-w-[120px] flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold disabled:opacity-50 transition-colors ${
              wobbling
                ? "bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-300 dark:hover:bg-zinc-700"
                : "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:opacity-90"
            }`}
          >
            {busy === "accept" ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            적용
          </button>
        )}
        <button
          onClick={() => decide("reject")}
          disabled={busy !== null}
          className="flex-1 min-w-[80px] flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-50 transition-colors"
        >
          {busy === "reject" ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
          거절
        </button>
        <button
          onClick={() => decide("ignore")}
          disabled={busy !== null}
          className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 disabled:opacity-50 transition-colors"
          title="나중에 다시 보지 않음"
        >
          {busy === "ignore" ? <Loader2 size={12} className="animate-spin" /> : <Clock size={12} />}
          나중에
        </button>
      </div>

      {error && (
        <div className="px-4 py-2 bg-red-100 dark:bg-red-900/40 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      )}
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] text-zinc-400">{label}</p>
      <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-200 tabular-nums mt-0.5">{value}</p>
    </div>
  );
}
