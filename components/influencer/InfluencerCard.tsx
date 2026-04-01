"use client";

import { Users, TrendingUp, MessageSquare, Package, Trash2, ChevronRight } from "lucide-react";
import {
  STATUS_CONFIG, PRIORITY_CONFIG, PLATFORM_CONFIG,
  formatFollowers, type Influencer,
} from "@/lib/influencerStorage";

interface Props {
  influencer: Influencer;
  onConversation: (inf: Influencer) => void;
  onShipping: (inf: Influencer) => void;
  onDelete: (id: string) => void;
}

// 플랫폼별 아이콘 (SVG)
const PlatformIcon = ({ platform }: { platform: Influencer["platform"] }) => {
  if (platform === "instagram") return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>
    </svg>
  );
  if (platform === "youtube") return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
      <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
    </svg>
  );
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
      <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.27 8.27 0 004.84 1.55V6.78a4.85 4.85 0 01-1.07-.09z"/>
    </svg>
  );
};

export default function InfluencerCard({ influencer: inf, onConversation, onShipping, onDelete }: Props) {
  const status   = STATUS_CONFIG[inf.status];
  const priority = PRIORITY_CONFIG[inf.priority];
  const platform = PLATFORM_CONFIG[inf.platform];

  const lastMessage = inf.messages[inf.messages.length - 1];
  const showShipping = inf.status === "negotiating" || inf.status === "confirmed" || inf.status === "shipped";
  const canDM = inf.status !== "shipped" && inf.status !== "rejected" && inf.status !== "discovered";

  return (
    <div className={`group relative bg-white dark:bg-zinc-900 rounded-2xl border overflow-hidden transition-all hover:shadow-lg ${status.border} border`}>
      {/* 우선순위 라인 */}
      <div className={`h-1 ${inf.priority === "high" ? "bg-red-400" : inf.priority === "medium" ? "bg-amber-300" : "bg-zinc-200"}`} />

      {/* 카드 본문 */}
      <div className="p-4">
        {/* 프로필 영역 */}
        <div className="flex items-start gap-3 mb-3">
          <div className="relative shrink-0">
            {inf.profileImage ? (
              <img src={inf.profileImage} alt={inf.name} className="w-12 h-12 rounded-full object-cover" />
            ) : (
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-pink-400 to-violet-500 flex items-center justify-center text-white font-bold">
                {inf.name.charAt(0)}
              </div>
            )}
            {/* 플랫폼 아이콘 배지 */}
            <div className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 flex items-center justify-center ${platform.color}`}>
              <PlatformIcon platform={inf.platform} />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-1">
              <div className="min-w-0">
                <p className="font-semibold text-zinc-800 dark:text-zinc-100 text-sm truncate">{inf.name}</p>
                <p className="text-xs text-zinc-400 truncate">@{inf.handle}</p>
              </div>
              <span className={`shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full ${status.bg} ${status.color}`}>
                {status.label}
              </span>
            </div>
          </div>
        </div>

        {/* 지표 */}
        <div className="flex gap-3 mb-3 text-xs text-zinc-500">
          <span className="flex items-center gap-1">
            <Users size={11} />
            {formatFollowers(inf.followers)}
          </span>
          {inf.engagementRate > 0 && (
            <span className="flex items-center gap-1">
              <TrendingUp size={11} />
              {inf.engagementRate}%
            </span>
          )}
          {inf.messages.length > 0 && (
            <span className="flex items-center gap-1">
              <MessageSquare size={11} />
              {inf.messages.length}
            </span>
          )}
        </div>

        {/* 카테고리 태그 */}
        {inf.categories.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {inf.categories.slice(0, 3).map((cat) => (
              <span key={cat} className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500">
                {cat}
              </span>
            ))}
            {inf.categories.length > 3 && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500">
                +{inf.categories.length - 3}
              </span>
            )}
          </div>
        )}

        {/* 마지막 메시지 미리보기 */}
        {lastMessage && (
          <div className="mb-3 text-[11px] text-zinc-400 bg-zinc-50 dark:bg-zinc-800 rounded-lg px-3 py-2 line-clamp-2">
            {lastMessage.direction === "outgoing" ? "↑ " : "↓ "}
            {lastMessage.content}
          </div>
        )}

        {/* 협찬 확정 + 배송 완료 */}
        {inf.status === "confirmed" && inf.shippingInfo && (
          <div className="mb-3 bg-teal-50 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-800 rounded-lg px-3 py-2 text-[11px] text-teal-700 dark:text-teal-300">
            📦 {inf.shippingInfo.recipientName} · {inf.shippingInfo.address.slice(0, 20)}...
          </div>
        )}

        {/* 액션 버튼 */}
        <div className="flex gap-1.5 mt-1">
          {canDM && (
            <button
              onClick={() => onConversation(inf)}
              className="flex-1 flex items-center justify-center gap-1 text-xs font-medium bg-violet-50 hover:bg-violet-100 dark:bg-violet-950/30 dark:hover:bg-violet-950/50 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-800 rounded-xl py-2 transition-colors"
            >
              <MessageSquare size={12} />
              DM
            </button>
          )}
          {showShipping && (
            <button
              onClick={() => onShipping(inf)}
              className="flex-1 flex items-center justify-center gap-1 text-xs font-medium bg-teal-50 hover:bg-teal-100 dark:bg-teal-950/30 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800 rounded-xl py-2 transition-colors"
            >
              <Package size={12} />
              배송
            </button>
          )}
          {/* 검토 중 → 승인 빠른 버튼 */}
          {inf.status === "discovered" && (
            <button
              onClick={() => onConversation(inf)}
              className="flex-1 flex items-center justify-center gap-1 text-xs font-medium bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 rounded-xl py-2 transition-colors"
            >
              <ChevronRight size={12} />
              검토
            </button>
          )}
          <button
            onClick={() => onDelete(inf.id)}
            className="p-2 text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-xl transition-colors"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
