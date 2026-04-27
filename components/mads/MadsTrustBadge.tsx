import type { TrustLevel } from "@/lib/mads/types";
import { TRUST_LABEL_KO } from "@/lib/mads/ruleEngine";

const STYLE: Record<TrustLevel, { bg: string; text: string }> = {
  trusted:   { bg: "bg-emerald-50 dark:bg-emerald-900/30", text: "text-emerald-700 dark:text-emerald-400" },
  learning:  { bg: "bg-amber-50    dark:bg-amber-900/30",   text: "text-amber-700   dark:text-amber-400"   },
  decaying:  { bg: "bg-red-50      dark:bg-red-900/30",     text: "text-red-700     dark:text-red-400"     },
  untrusted: { bg: "bg-zinc-100    dark:bg-zinc-800",       text: "text-zinc-600    dark:text-zinc-400"    },
};

export default function MadsTrustBadge({ level, conv7d }: { level: TrustLevel; conv7d: number }) {
  const s = STYLE[level];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${s.bg} ${s.text}`}>
      {TRUST_LABEL_KO[level]}
      <span className="opacity-70 font-normal">· {conv7d}건</span>
    </span>
  );
}
