"use client";

import { Calendar, Package, Users, TrendingUp, ChevronRight, Trash2 } from "lucide-react";
import { GB_STATUS_CONFIG, type GbCampaign } from "@/lib/groupBuying/types";

interface Props {
  campaign: GbCampaign;
  onDetail: (c: GbCampaign) => void;
  onAdvance: (id: string) => void;
  onDelete: (id: string) => void;
}

function formatPrice(n: number | null) {
  if (n == null) return "-";
  return n.toLocaleString("ko-KR") + "원";
}

function formatDate(d: string | null) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
}

export default function CampaignCard({ campaign: c, onDetail, onAdvance, onDelete }: Props) {
  const status = GB_STATUS_CONFIG[c.status];
  const nextStatus = status.next ? GB_STATUS_CONFIG[status.next] : null;
  const products = c.products ?? [];

  return (
    <div
      className={`group relative bg-white dark:bg-zinc-900 rounded-2xl border overflow-hidden transition-all hover:shadow-lg cursor-pointer ${status.border}`}
      onClick={() => onDetail(c)}
    >
      <div className={`h-1 ${status.bg}`} />

      <div className="p-4">
        {/* 헤더 */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-zinc-800 dark:text-zinc-100 text-sm truncate">{c.title}</p>
            <p className="text-xs text-zinc-400 truncate mt-0.5">@{c.influencer_handle}</p>
          </div>
          <span className={`shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full ${status.bg} ${status.color}`}>
            {status.label}
          </span>
        </div>

        {/* 상품 목록 */}
        {products.length > 0 && (
          <div className="space-y-1.5 mb-3">
            {products.slice(0, 3).map((p) => (
              <div key={p.id} className="flex items-center gap-2">
                {p.product_image ? (
                  <img src={p.product_image} alt="" className="w-8 h-8 rounded-lg object-cover border border-zinc-100 dark:border-zinc-800" />
                ) : (
                  <div className="w-8 h-8 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                    <Package size={14} className="text-zinc-400" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] text-zinc-600 dark:text-zinc-300 truncate">{p.product_name}</p>
                  {p.discount_price && (
                    <span className="text-[10px] font-semibold text-violet-600">{formatPrice(p.discount_price)}</span>
                  )}
                </div>
              </div>
            ))}
            {products.length > 3 && (
              <p className="text-[10px] text-zinc-400">+{products.length - 3}개 상품</p>
            )}
          </div>
        )}

        {/* 상품 없으면 안내 */}
        {products.length === 0 && c.status !== "proposal" && (
          <p className="text-[11px] text-zinc-400 mb-3">상품 미등록</p>
        )}

        {/* 지표 */}
        <div className="flex flex-wrap gap-x-3 gap-y-1 mb-3 text-xs text-zinc-500">
          {c.influencer_followers && (
            <span className="flex items-center gap-1">
              <Users size={11} />
              {c.influencer_followers >= 10000
                ? `${(c.influencer_followers / 10000).toFixed(1)}만`
                : c.influencer_followers.toLocaleString()}
            </span>
          )}
          {c.commission_rate != null && (
            <span className="flex items-center gap-1">
              <TrendingUp size={11} />
              수수료 {c.commission_rate}%
            </span>
          )}
          {c.start_date && (
            <span className="flex items-center gap-1">
              <Calendar size={11} />
              {formatDate(c.start_date)} ~ {formatDate(c.end_date)}
            </span>
          )}
        </div>

        {/* 메모 */}
        {c.notes && (
          <p className="text-[11px] text-zinc-400 line-clamp-2 mb-3">{c.notes}</p>
        )}

        {/* 액션 */}
        <div className="flex gap-1.5 mt-1" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => onDetail(c)}
            className="flex-1 flex items-center justify-center gap-1 text-xs font-medium bg-violet-50 hover:bg-violet-100 dark:bg-violet-950/30 dark:hover:bg-violet-950/50 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-800 rounded-xl py-2 transition-colors"
          >
            상세보기
          </button>
          {nextStatus && (
            <button
              onClick={() => onAdvance(c.id)}
              className="flex-1 flex items-center justify-center gap-1 text-xs font-medium bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 rounded-xl py-2 transition-colors"
            >
              <ChevronRight size={12} />
              {nextStatus.label}
            </button>
          )}
          <button
            onClick={() => onDelete(c.id)}
            className="p-2 text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-xl transition-colors"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
