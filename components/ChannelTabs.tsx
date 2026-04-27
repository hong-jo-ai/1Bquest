"use client";

import { CHANNELS, UPLOADABLE_CHANNELS, type ChannelId, type UploadableChannel } from "@/lib/multiChannelData";

interface Props {
  activeChannel: ChannelId;
  onChange: (id: ChannelId) => void;
  cafe24IsReal: boolean;
  uploadStatus?: Partial<Record<UploadableChannel, boolean>>;
  visibleChannels?: ChannelId[]; // 표시할 채널 ID 목록 (브랜드 분기용). 없으면 전체.
}

export default function ChannelTabs({
  activeChannel, onChange, cafe24IsReal,
  uploadStatus = {},
  visibleChannels,
}: Props) {
  const channelsToShow = visibleChannels
    ? CHANNELS.filter((c) => visibleChannels.includes(c.id))
        .sort(
          (a, b) => visibleChannels.indexOf(a.id) - visibleChannels.indexOf(b.id)
        )
    : CHANNELS;

  return (
    <div className="min-w-0 flex items-center gap-1.5 sm:gap-2 overflow-x-auto pb-1 -mx-1 px-1">
      {channelsToShow.map((ch) => {
        const isActive = activeChannel === ch.id;
        const isUploadable = UPLOADABLE_CHANNELS.includes(ch.id as UploadableChannel);
        const hasUpload = isUploadable && !!uploadStatus[ch.id as UploadableChannel];
        const isReal   = ch.id === "cafe24" && cafe24IsReal;
        const isEmpty = isUploadable && !hasUpload;

        return (
          <button
            key={ch.id}
            onClick={() => onChange(ch.id)}
            className={`
              flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-medium transition-all whitespace-nowrap flex-shrink-0
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
            {isReal && (
              <span className="text-[10px] font-semibold bg-sky-100 text-sky-600 dark:bg-sky-900/40 dark:text-sky-300 px-1.5 py-0.5 rounded-full">
                실데이터
              </span>
            )}
            {/* 업로드된 실데이터 뱃지 */}
            {hasUpload && (
              <span className="text-[10px] font-semibold bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300 px-1.5 py-0.5 rounded-full">
                업로드됨
              </span>
            )}
            {/* 데이터 없음 뱃지 */}
            {isEmpty && (
              <span className="text-[10px] font-semibold bg-zinc-100 text-zinc-400 dark:bg-zinc-700 dark:text-zinc-400 px-1.5 py-0.5 rounded-full">
                미업로드
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
