"use client";

import { CHANNELS, type ChannelId } from "@/lib/multiChannelData";

interface Props {
  activeChannel: ChannelId;
  onChange: (id: ChannelId) => void;
  cafe24IsReal: boolean;
}

export default function ChannelTabs({ activeChannel, onChange, cafe24IsReal }: Props) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {CHANNELS.map((ch) => {
        const isActive = activeChannel === ch.id;
        const isSample = ch.id === "wconcept" || ch.id === "musinsa";
        const isReal   = ch.id === "cafe24" && cafe24IsReal;

        return (
          <button
            key={ch.id}
            onClick={() => onChange(ch.id)}
            className={`
              flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all
              ${isActive
                ? "bg-white dark:bg-zinc-800 shadow-sm text-zinc-900 dark:text-zinc-100 ring-2"
                : "text-zinc-500 hover:bg-white/60 dark:hover:bg-zinc-800/60"}
            `}
            style={isActive ? { boxShadow: `0 0 0 2px ${ch.color}` } : {}}
          >
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: ch.color }}
            />
            {ch.name}

            {/* 카페24 실데이터 뱃지 */}
            {ch.id === "cafe24" && isReal && (
              <span className="text-[10px] font-semibold bg-sky-100 text-sky-600 dark:bg-sky-900/40 dark:text-sky-300 px-1.5 py-0.5 rounded-full">
                실데이터
              </span>
            )}
            {/* W컨셉 / 무신사 샘플 뱃지 */}
            {isSample && (
              <span className="text-[10px] font-semibold bg-zinc-100 text-zinc-400 dark:bg-zinc-700 dark:text-zinc-400 px-1.5 py-0.5 rounded-full">
                샘플
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
