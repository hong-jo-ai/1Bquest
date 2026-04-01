"use client";

import { useState } from "react";
import { AlertTriangle, Info, XCircle, ChevronDown, ChevronUp, Zap } from "lucide-react";
import type { FatigueAlert, FatigueSeverity, FatigueType } from "@/lib/metaData";

interface Props {
  alerts: FatigueAlert[];
}

const SEVERITY_CONFIG: Record<FatigueSeverity, {
  bg: string; border: string; iconColor: string; badgeBg: string; badgeText: string; label: string;
}> = {
  critical: {
    bg:        "bg-red-50 dark:bg-red-950/30",
    border:    "border-red-200 dark:border-red-800",
    iconColor: "text-red-500",
    badgeBg:   "bg-red-100 dark:bg-red-900/50",
    badgeText: "text-red-700 dark:text-red-300",
    label:     "즉시 조치",
  },
  warning: {
    bg:        "bg-amber-50 dark:bg-amber-950/30",
    border:    "border-amber-200 dark:border-amber-800",
    iconColor: "text-amber-500",
    badgeBg:   "bg-amber-100 dark:bg-amber-900/50",
    badgeText: "text-amber-700 dark:text-amber-300",
    label:     "주의",
  },
  info: {
    bg:        "bg-blue-50 dark:bg-blue-950/30",
    border:    "border-blue-200 dark:border-blue-800",
    iconColor: "text-blue-500",
    badgeBg:   "bg-blue-100 dark:bg-blue-900/50",
    badgeText: "text-blue-700 dark:text-blue-300",
    label:     "준비",
  },
};

const TYPE_LABEL: Record<FatigueType, string> = {
  frequency: "노출 빈도",
  roas:      "ROAS",
  ctr:       "CTR",
  cpm:       "CPM",
  age:       "운영 기간",
};

function SeverityIcon({ severity, size = 16 }: { severity: FatigueSeverity; size?: number }) {
  if (severity === "critical") return <XCircle size={size} />;
  if (severity === "warning")  return <AlertTriangle size={size} />;
  return <Info size={size} />;
}

function AlertCard({ alert }: { alert: FatigueAlert }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = SEVERITY_CONFIG[alert.severity];

  return (
    <div className={`rounded-xl border ${cfg.bg} ${cfg.border} overflow-hidden`}>
      <button
        className="w-full text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-3 px-4 py-3">
          {/* 심각도 아이콘 */}
          <div className={`shrink-0 ${cfg.iconColor}`}>
            <SeverityIcon severity={alert.severity} size={16} />
          </div>

          {/* 캠페인명 + 제목 */}
          <div className="flex-1 min-w-0">
            <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">{alert.campaignName}</p>
            <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 leading-snug">{alert.title}</p>
          </div>

          {/* 수치 */}
          <div className="shrink-0 text-right hidden sm:block">
            <p className={`text-sm font-bold ${cfg.iconColor}`}>{alert.value}</p>
            <p className="text-[10px] text-zinc-400">{TYPE_LABEL[alert.type]}</p>
          </div>

          {/* 배지 */}
          <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full ${cfg.badgeBg} ${cfg.badgeText} hidden xs:inline-flex`}>
            {cfg.label}
          </span>

          {/* 토글 */}
          <div className="shrink-0 text-zinc-400">
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </div>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-0 space-y-3 border-t border-zinc-100 dark:border-zinc-800/50">
          <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed pt-3">{alert.detail}</p>
          <div className="flex items-start gap-2 bg-white/70 dark:bg-zinc-900/50 rounded-lg px-3 py-2.5">
            <Zap size={13} className="shrink-0 mt-0.5 text-violet-500" />
            <p className="text-xs text-zinc-700 dark:text-zinc-200 leading-relaxed">{alert.recommendation}</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function MetaFatigueAlerts({ alerts }: Props) {
  const [showAll, setShowAll] = useState(false);

  if (alerts.length === 0) {
    return (
      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 px-6 py-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 bg-emerald-100 dark:bg-emerald-900/40 rounded-xl flex items-center justify-center">
            <Zap size={16} className="text-emerald-600 dark:text-emerald-400" />
          </div>
          <h2 className="text-base font-semibold text-zinc-800 dark:text-zinc-100">소재 피로도 감지</h2>
        </div>
        <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-sm">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          현재 진행 중인 캠페인에서 소재 피로도 이슈가 감지되지 않았습니다.
        </div>
      </div>
    );
  }

  const criticalCount = alerts.filter((a) => a.severity === "critical").length;
  const warningCount  = alerts.filter((a) => a.severity === "warning").length;
  const infoCount     = alerts.filter((a) => a.severity === "info").length;

  const PREVIEW_COUNT = 3;
  const visibleAlerts = showAll ? alerts : alerts.slice(0, PREVIEW_COUNT);

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 overflow-hidden">
      {/* 헤더 */}
      <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-amber-100 dark:bg-amber-900/40 rounded-xl flex items-center justify-center">
            <AlertTriangle size={16} className="text-amber-600 dark:text-amber-400" />
          </div>
          <h2 className="text-base font-semibold text-zinc-800 dark:text-zinc-100">소재 피로도 감지</h2>
        </div>
        <div className="flex items-center gap-2">
          {criticalCount > 0 && (
            <span className="flex items-center gap-1 text-[11px] font-semibold text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900/50 px-2 py-1 rounded-full">
              <XCircle size={10} /> 즉시 조치 {criticalCount}건
            </span>
          )}
          {warningCount > 0 && (
            <span className="flex items-center gap-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/50 px-2 py-1 rounded-full">
              <AlertTriangle size={10} /> 주의 {warningCount}건
            </span>
          )}
          {infoCount > 0 && (
            <span className="flex items-center gap-1 text-[11px] font-semibold text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/50 px-2 py-1 rounded-full">
              <Info size={10} /> 준비 {infoCount}건
            </span>
          )}
        </div>
      </div>

      {/* 알림 목록 */}
      <div className="p-4 space-y-2">
        {visibleAlerts.map((alert, i) => (
          <AlertCard key={`${alert.campaignId}-${alert.type}-${i}`} alert={alert} />
        ))}
      </div>

      {/* 더보기 */}
      {alerts.length > PREVIEW_COUNT && (
        <div className="px-4 pb-4">
          <button
            onClick={() => setShowAll((v) => !v)}
            className="w-full py-2 text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 flex items-center justify-center gap-1 bg-zinc-50 dark:bg-zinc-800/50 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl transition-colors"
          >
            {showAll
              ? <><ChevronUp size={13} /> 접기</>
              : <><ChevronDown size={13} /> 나머지 {alerts.length - PREVIEW_COUNT}건 더보기</>
            }
          </button>
        </div>
      )}
    </div>
  );
}
