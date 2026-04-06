"use client";

import { Clock, Zap, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";

interface LogEntry {
  id: string;
  type: string;
  source: string;
  timestamp: string;
  status?: "success" | "error" | "partial";
  message?: string;
}

interface Props {
  entries: LogEntry[];
}

const TYPE_STYLES: Record<string, { icon: React.ElementType; color: string }> = {
  "data.refreshed":          { icon: CheckCircle2,   color: "text-emerald-500" },
  "data.anomaly.detected":   { icon: AlertTriangle,  color: "text-amber-500" },
  "research.complete":       { icon: CheckCircle2,   color: "text-blue-500" },
  "product.underperforming": { icon: AlertTriangle,  color: "text-red-500" },
  "plan.created":            { icon: Zap,            color: "text-violet-500" },
  "content.text.generated":  { icon: CheckCircle2,   color: "text-emerald-500" },
  "content.image.generated": { icon: CheckCircle2,   color: "text-blue-500" },
};

const AGENT_NAMES: Record<string, string> = {
  "data-collector":    "정보수집",
  "research-analyst":  "리서치",
  "strategy-planner":  "전략기획",
  "copywriter":        "카피라이팅",
  "designer":          "디자인",
  "marketing":         "마케팅",
  "merchandiser":      "머천다이징",
  "product-dev":       "상품개발",
  "prompt-engineer":   "프롬프팅",
};

export default function EventLog({ entries }: Props) {
  if (entries.length === 0) {
    return (
      <div className="text-center py-8 text-zinc-400 text-sm">
        아직 이벤트가 없습니다. 에이전트를 실행해보세요.
      </div>
    );
  }

  return (
    <div className="space-y-2 max-h-96 overflow-y-auto">
      {entries.map((entry) => {
        const style = TYPE_STYLES[entry.type] ?? { icon: Clock, color: "text-zinc-400" };
        const Icon = style.icon;
        return (
          <div
            key={entry.id}
            className="flex items-start gap-3 px-3 py-2.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800"
          >
            <Icon size={14} className={`mt-0.5 flex-shrink-0 ${style.color}`} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  {AGENT_NAMES[entry.source] ?? entry.source}
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500 font-mono">
                  {entry.type}
                </span>
              </div>
              {entry.message && (
                <p className="text-[11px] text-zinc-500 mt-0.5 truncate">{entry.message}</p>
              )}
            </div>
            <span className="text-[10px] text-zinc-400 flex-shrink-0 whitespace-nowrap">
              {formatTime(entry.timestamp)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return "";
  }
}
