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
    // 가로 스크롤 대신 줄바꿈. 스크롤이면 화면 밖 채널을 못 보고 지나친다(사장님 지적 2026-08-30).
    <div className="min-w-0 flex flex-wrap items-center gap-1.5 rounded-2xl bg-zinc-100/70 p-1.5 dark:bg-zinc-800/70">
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
              flex items-center gap-1.5 px-2.5 sm:px-4 py-2 sm:py-2.5 rounded-xl text-[11px] sm:text-sm font-medium transition-all whitespace-nowrap shrink-0 border
              ${isActive
                ? "border-white bg-white text-zinc-950 shadow-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                : "border-transparent text-zinc-500 hover:bg-white/70 hover:text-zinc-800 dark:hover:bg-zinc-900/70 dark:hover:text-zinc-200"}
            `}
          >
            <span
              className="h-2 w-2 rounded-full shrink-0"
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
