"use client";

import { useState } from "react";
import {
  ExternalLink,
  MoreVertical,
  MessageSquare,
  Package,
  Trash2,
  Check,
} from "lucide-react";
import {
  STATUS_CONFIG,
  PLATFORM_CONFIG,
  formatFollowers,
  updateInfluencer,
  type Influencer,
  type InfluencerStatus,
} from "@/lib/influencerStorage";

interface Props {
  influencer: Influencer;
  onConversation: (inf: Influencer) => void;
  onShipping: (inf: Influencer) => void;
  onDelete: (id: string) => void;
  onChange?: () => void; // 상태 변경 후 부모 reload
}

const ALL_STATUSES: InfluencerStatus[] = [
  "discovered",
  "reviewing",
  "approved",
  "dm_sent",
  "replied",
  "negotiating",
  "confirmed",
  "shipped",
  "posted",
  "rejected",
];

function getProfileUrl(
  platform: Influencer["platform"],
  handle: string,
): string {
  const h = handle.replace(/^@/, "");
  switch (platform) {
    case "instagram":
      return `https://instagram.com/${h}`;
    case "youtube":
      return `https://youtube.com/@${h}`;
    case "tiktok":
      return `https://tiktok.com/@${h}`;
  }
}

const PlatformIcon = ({ platform }: { platform: Influencer["platform"] }) => {
  if (platform === "instagram")
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3">
        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
      </svg>
    );
  if (platform === "youtube")
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3">
        <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3">
      <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.27 8.27 0 004.84 1.55V6.78a4.85 4.85 0 01-1.07-.09z" />
    </svg>
  );
};

export default function InfluencerCard({
  influencer: inf,
  onConversation,
  onShipping,
  onDelete,
  onChange,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);

  const status = STATUS_CONFIG[inf.status];
  const platform = PLATFORM_CONFIG[inf.platform];
  const profileUrl = getProfileUrl(inf.platform, inf.handle);

  const showShipping =
    inf.status === "negotiating" ||
    inf.status === "confirmed" ||
    inf.status === "shipped" ||
    inf.status === "posted";
  const canDM =
    inf.status !== "rejected" && inf.status !== "discovered";

  const handleStatusChange = (newStatus: InfluencerStatus) => {
    if (newStatus === inf.status) {
      setMenuOpen(false);
      return;
    }
    updateInfluencer(inf.id, { status: newStatus });
    setMenuOpen(false);
    onChange?.();
  };

  const initials = (inf.name || inf.handle).slice(0, 1).toUpperCase();

  // 프로필 사진: inf.profileImage가 있으면 그걸 쓰고,
  // 없으면 서버 프록시(/api/influencer/avatar)로 핸들 기반 자동 fetch.
  // 실패 시 onError로 그라디언트 이니셜 fallback.
  const [imgFailed, setImgFailed] = useState(false);
  const proxiedAvatarUrl = `/api/influencer/avatar?platform=${inf.platform}&handle=${encodeURIComponent(inf.handle)}`;
  const avatarSrc = inf.profileImage || proxiedAvatarUrl;
  const showAvatar = !!avatarSrc && !imgFailed;

  return (
    <div
      className={`relative bg-white dark:bg-zinc-900 rounded-2xl border ${status.border} transition-all hover:shadow-md ${
        menuOpen ? "z-30" : ""
      }`}
    >
      {/* 우선순위 = high → 좌측 강조 라인 (카드 둥근 모서리에 맞춰 rounded-l) */}
      {inf.priority === "high" && (
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-red-400 rounded-l-2xl" />
      )}

      <div className="flex items-center gap-3 p-3 sm:p-4">
        {/* 프로필 아바타 (인스타 그라디언트 링) → 탭하면 대화 모달 */}
        <button
          onClick={() => onConversation(inf)}
          className="shrink-0 relative active:scale-95 transition-transform"
          aria-label={`${inf.name} 상세`}
        >
          <div className="rounded-full p-[2.5px] bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600">
            <div className="rounded-full bg-white dark:bg-zinc-900 p-[2px]">
              {showAvatar ? (
                <img
                  src={avatarSrc}
                  alt={inf.name || inf.handle}
                  loading="lazy"
                  onError={() => setImgFailed(true)}
                  className="w-14 h-14 sm:w-16 sm:h-16 rounded-full object-cover bg-zinc-100 dark:bg-zinc-800"
                />
              ) : (
                <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-gradient-to-br from-pink-400 to-violet-500 flex items-center justify-center text-white font-bold text-lg sm:text-xl">
                  {initials}
                </div>
              )}
            </div>
          </div>
          {/* 플랫폼 배지 */}
          <div
            className={`absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 flex items-center justify-center ${platform.color}`}
          >
            <PlatformIcon platform={inf.platform} />
          </div>
        </button>

        {/* 정보 영역 → 탭하면 대화/검토 모달 */}
        <button
          onClick={() => onConversation(inf)}
          className="flex-1 min-w-0 text-left"
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <p className="font-semibold text-sm sm:text-base text-zinc-900 dark:text-zinc-100 truncate">
              @{inf.handle}
            </p>
            <span
              className={`shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded ${status.bg} ${status.color}`}
            >
              {status.label}
            </span>
          </div>
          {inf.name && inf.name !== inf.handle && (
            <p className="text-xs sm:text-sm text-zinc-600 dark:text-zinc-400 truncate">
              {inf.name}
            </p>
          )}
          <p className="text-[11px] sm:text-xs text-zinc-400 truncate mt-0.5">
            {inf.followers > 0 && (
              <>
                <span className="font-semibold text-zinc-500 dark:text-zinc-500">
                  {formatFollowers(inf.followers)}
                </span>
                <span> followers</span>
              </>
            )}
            {inf.categories.length > 0 && (
              <>
                {inf.followers > 0 && <span className="mx-1">·</span>}
                {inf.categories.slice(0, 2).join(", ")}
                {inf.categories.length > 2 && ` +${inf.categories.length - 2}`}
              </>
            )}
            {inf.messages.length > 0 && (
              <>
                <span className="mx-1">·</span>
                <span className="inline-flex items-center gap-0.5">
                  <MessageSquare size={10} /> {inf.messages.length}
                </span>
              </>
            )}
          </p>
        </button>

        {/* 우측 액션 */}
        <div className="shrink-0 flex items-center gap-0.5">
          <a
            href={profileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 text-zinc-400 hover:text-violet-600 dark:hover:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-950/30 rounded-lg transition-colors"
            title="프로필 열기"
            aria-label="프로필 열기"
          >
            <ExternalLink size={16} />
          </a>

          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
              aria-label="더보기"
            >
              <MoreVertical size={16} />
            </button>

            {menuOpen && (
              <>
                <button
                  onClick={() => setMenuOpen(false)}
                  className="fixed inset-0 z-10 cursor-default bg-transparent"
                  aria-label="메뉴 닫기"
                  tabIndex={-1}
                />
                <div className="absolute right-0 top-full mt-1 z-20 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-lg overflow-hidden w-[200px]">
                  <a
                    href={profileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setMenuOpen(false)}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    <ExternalLink size={14} /> 프로필 열기
                  </a>
                  {canDM && (
                    <button
                      onClick={() => {
                        onConversation(inf);
                        setMenuOpen(false);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      <MessageSquare size={14} /> DM 관리
                    </button>
                  )}
                  {showShipping && (
                    <button
                      onClick={() => {
                        onShipping(inf);
                        setMenuOpen(false);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      <Package size={14} /> 배송
                    </button>
                  )}

                  {/* 상태 변경 섹션 */}
                  <div className="border-t border-zinc-100 dark:border-zinc-800 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-400 bg-zinc-50 dark:bg-zinc-950/50">
                    상태 변경
                  </div>
                  {ALL_STATUSES.map((s) => {
                    const cfg = STATUS_CONFIG[s];
                    const isCurrent = s === inf.status;
                    return (
                      <button
                        key={s}
                        onClick={() => handleStatusChange(s)}
                        className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm transition-colors ${
                          isCurrent
                            ? `${cfg.bg} ${cfg.color} font-semibold`
                            : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <span
                            className={`inline-block w-2 h-2 rounded-full ${cfg.bg.replace("bg-", "bg-").replace("-50", "-400").replace("-100", "-400")}`}
                          />
                          {cfg.label}
                        </span>
                        {isCurrent && <Check size={14} />}
                      </button>
                    );
                  })}

                  <button
                    onClick={() => {
                      onDelete(inf.id);
                      setMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 border-t border-zinc-100 dark:border-zinc-800"
                  >
                    <Trash2 size={14} /> 삭제
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
