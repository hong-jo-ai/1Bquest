"use client";

import {
  Database, Search, Target, PenTool, Palette, Megaphone,
  LayoutGrid, Lightbulb, Sparkles, Play, Loader2, CheckCircle2, XCircle,
} from "lucide-react";
import type { AgentConfig, AgentStatus } from "@/lib/agents/types";

const ICON_MAP: Record<string, React.ElementType> = {
  Database, Search, Target, PenTool, Palette, Megaphone,
  LayoutGrid, Lightbulb, Sparkles,
};

const STATUS_STYLES: Record<AgentStatus, { dot: string; label: string }> = {
  idle:    { dot: "bg-zinc-400", label: "대기" },
  running: { dot: "bg-amber-400 animate-pulse", label: "실행 중" },
  success: { dot: "bg-emerald-400", label: "완료" },
  error:   { dot: "bg-red-400", label: "오류" },
};

const LLM_BADGE: Record<string, { text: string; color: string }> = {
  claude: { text: "Claude", color: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400" },
  gemini: { text: "Gemini", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  none:   { text: "데이터", color: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400" },
};

interface Props {
  config: AgentConfig;
  status: AgentStatus;
  lastRun?: string;
  onRun: () => void;
  isRunning: boolean;
  lastResult?: Record<string, unknown> | null;
}

export default function AgentCard({ config, status, lastRun, onRun, isRunning, lastResult }: Props) {
  const Icon = ICON_MAP[config.icon] ?? Database;
  const st = STATUS_STYLES[status];
  const llm = LLM_BADGE[config.llm];

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-5 flex flex-col gap-3 hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl p-2.5">
            <Icon size={18} className="text-white" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">{config.name}</h3>
            <p className="text-[11px] text-zinc-400">{config.nameEn}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <div className={`w-2 h-2 rounded-full ${st.dot}`} />
          <span className="text-[11px] text-zinc-500">{st.label}</span>
        </div>
      </div>

      {/* Description */}
      <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">{config.description}</p>

      {/* Capabilities */}
      <div className="flex flex-wrap gap-1">
        {config.capabilities.slice(0, 3).map((c) => (
          <span key={c} className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400">
            {c}
          </span>
        ))}
        {config.capabilities.length > 3 && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-400">
            +{config.capabilities.length - 3}
          </span>
        )}
      </div>

      {/* Last Result Preview */}
      {lastResult && (
        <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-lg p-2.5 max-h-24 overflow-y-auto">
          <p className="text-[10px] text-zinc-400 mb-1">최근 결과</p>
          {lastResult.summary ? (
            <p className="text-xs text-zinc-600 dark:text-zinc-300">{String(lastResult.summary).slice(0, 120)}</p>
          ) : null}
          {lastResult.health_score ? (
            <p className="text-xs text-zinc-600 dark:text-zinc-300">건강도: {String(lastResult.health_score)}/10</p>
          ) : null}
          {lastResult.error ? (
            <p className="text-xs text-red-500">{String(lastResult.error).slice(0, 80)}</p>
          ) : null}
          {!lastResult.summary && !lastResult.health_score && !lastResult.error && (
            <p className="text-xs text-zinc-500">
              {lastResult.cafe24 ? "Cafe24" : ""}{lastResult.inventory ? " + 재고" : ""} 데이터 수집 완료
            </p>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between mt-auto pt-2 border-t border-zinc-100 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${llm.color}`}>
            {llm.text}
          </span>
          {lastRun && (
            <span className="text-[10px] text-zinc-400">
              {formatTimeAgo(lastRun)}
            </span>
          )}
        </div>
        <button
          onClick={onRun}
          disabled={isRunning}
          className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 text-white transition-colors"
        >
          {isRunning ? (
            <><Loader2 size={12} className="animate-spin" /> 실행 중</>
          ) : status === "success" ? (
            <><CheckCircle2 size={12} /> 재실행</>
          ) : status === "error" ? (
            <><XCircle size={12} /> 재시도</>
          ) : (
            <><Play size={12} /> 실행</>
          )}
        </button>
      </div>
    </div>
  );
}

function formatTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  return `${Math.floor(hr / 24)}일 전`;
}
