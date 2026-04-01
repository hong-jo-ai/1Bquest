"use client";

import { useState } from "react";
import { Pencil, AlertTriangle, Clock, Package, Trash2 } from "lucide-react";
import type { InventoryProduct } from "@/lib/inventoryStorage";
import { AGING_CONFIG } from "@/lib/inventoryStorage";

interface Props {
  product: InventoryProduct;
  onEdit: (product: InventoryProduct) => void;
  onDelete: (sku: string) => void;
}

const STOCK_STATUS = (stock: number, pct: number) => {
  if (stock === 0)   return { label: "품절",     barColor: "bg-zinc-300", textColor: "text-zinc-400" };
  if (pct <= 20)     return { label: "품절임박", barColor: "bg-red-400",  textColor: "text-red-500"  };
  if (pct <= 40)     return { label: "재고부족", barColor: "bg-orange-400", textColor: "text-orange-500" };
  return             { label: "정상",     barColor: "bg-emerald-400", textColor: "text-emerald-600" };
};

export default function ProductCard({ product, onEdit, onDelete }: Props) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const aging = AGING_CONFIG[product.agingStatus];
  const stockSt = STOCK_STATUS(product.currentStock, product.stockPct);
  const isNotSetup = product.entry.initialStock === 0;

  const handleDeleteClick = () => setConfirmDelete(true);
  const handleConfirm = () => { setConfirmDelete(false); onDelete(product.sku); };
  const handleCancel = () => setConfirmDelete(false);

  return (
    <div className={`group relative bg-white dark:bg-zinc-900 rounded-2xl border overflow-hidden transition-all hover:shadow-lg ${
      product.agingStatus === "critical" ? "border-red-300 dark:border-red-800" :
      product.agingStatus === "urgent"   ? "border-orange-300 dark:border-orange-800" :
      "border-zinc-100 dark:border-zinc-800"
    }`}>
      {/* 에이징 긴급 배너 */}
      {(product.agingStatus === "critical" || product.agingStatus === "urgent") && product.currentStock > 0 && (
        <div className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium ${
          product.agingStatus === "critical" ? "bg-red-50 text-red-600" : "bg-orange-50 text-orange-600"
        }`}>
          <AlertTriangle size={12} />
          {aging.description}
        </div>
      )}

      {/* 상품 이미지 영역 */}
      <div className="relative bg-zinc-50 dark:bg-zinc-800 h-40 flex items-center justify-center overflow-hidden">
        {product.image ? (
          <img src={product.image} alt={product.name} className="w-full h-full object-cover" />
        ) : (
          <Package size={40} className="text-zinc-300 dark:text-zinc-600" />
        )}

        {/* 카테고리 배지 */}
        {product.category && (
          <div className="absolute top-2 left-2 bg-black/50 text-white text-[10px] font-medium px-2 py-0.5 rounded-full backdrop-blur-sm">
            {product.category}
          </div>
        )}

        {/* 수동 추가 배지 */}
        {product.isManual && (
          <div className="absolute top-2 right-2 bg-violet-600/80 text-white text-[10px] font-medium px-2 py-0.5 rounded-full backdrop-blur-sm">
            수동
          </div>
        )}

        {/* 편집 버튼 (호버) */}
        <div className="absolute inset-0 flex items-end justify-end p-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => onEdit(product)}
            className="flex items-center gap-1 text-[10px] font-medium bg-black/40 hover:bg-black/60 backdrop-blur-sm text-white px-2 py-1 rounded-lg transition-colors"
          >
            <Pencil size={11} />
            재고 수정
          </button>
        </div>

        {/* 삭제 확인 오버레이 */}
        {confirmDelete && (
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm flex flex-col items-center justify-center gap-3 z-10 rounded-t-2xl p-4">
            <Trash2 size={20} className="text-red-400" />
            <p className="text-white text-xs font-semibold text-center leading-snug">
              {product.isManual ? "이 상품을 목록에서 삭제할까요?" : "이 상품을 목록에서 숨길까요?"}
            </p>
            <p className="text-zinc-400 text-[10px] text-center">
              {product.isManual ? "삭제 후 되돌릴 수 없습니다" : "상단 '숨김 해제' 버튼으로 복원 가능합니다"}
            </p>
            <div className="flex gap-2 w-full">
              <button onClick={handleCancel}
                className="flex-1 text-xs font-medium bg-white/10 hover:bg-white/20 text-white py-1.5 rounded-lg transition-colors">
                취소
              </button>
              <button onClick={handleConfirm}
                className="flex-1 text-xs font-medium bg-red-500 hover:bg-red-600 text-white py-1.5 rounded-lg transition-colors">
                {product.isManual ? "삭제" : "숨기기"}
              </button>
            </div>
          </div>
        )}

        {/* 재고 미입력 배지 */}
        {isNotSetup && !product.isManual && (
          <div className="absolute bottom-2 left-2 bg-black/50 text-white text-[10px] font-medium px-2 py-0.5 rounded-full">
            재고 미입력
          </div>
        )}
      </div>

      {/* 상품 정보 */}
      <div className="p-4">
        <div className="mb-3">
          <p className="text-[10px] text-zinc-400 mb-0.5 font-mono">{product.sku}</p>
          <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 leading-tight line-clamp-2">
            {product.name}
          </h3>
        </div>

        {/* 재고 수량 + 바 */}
        <div className="mb-3">
          <div className="flex items-end justify-between mb-1.5">
            <span className={`text-2xl font-bold ${stockSt.textColor}`}>
              {product.currentStock}
              <span className="text-sm font-normal text-zinc-400 ml-1">개</span>
            </span>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${aging.bg} ${aging.color}`}>
              {aging.label}
            </span>
          </div>
          <div className="h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
            <div
              className={`h-full ${stockSt.barColor} rounded-full transition-all duration-500`}
              style={{ width: `${Math.min(product.stockPct, 100)}%` }}
            />
          </div>
          <div className="flex justify-between mt-1 text-[10px] text-zinc-400">
            <span>총 판매 {product.totalSold}개</span>
            <span>초기 {product.entry.initialStock}개</span>
          </div>
        </div>

        {/* 채널별 판매 */}
        <div className="flex gap-1.5 mb-3">
          {[
            { label: "카페24", value: product.soldCafe24,   color: "bg-sky-100 text-sky-600 dark:bg-sky-950/50 dark:text-sky-400" },
            { label: "W컨셉",  value: product.soldWconcept, color: "bg-rose-100 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400" },
            { label: "무신사", value: product.soldMusinsa,  color: "bg-blue-100 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400" },
          ].map((ch) => (
            <div key={ch.label} className={`flex-1 text-center rounded-lg py-1 ${ch.color}`}>
              <p className="text-xs font-bold">{ch.value}</p>
              <p className="text-[10px]">{ch.label}</p>
            </div>
          ))}
        </div>

        {/* 입고일 / 경과일 */}
        {product.entry.stockInDate && (
          <div className="flex items-center gap-1 text-xs text-zinc-400">
            <Clock size={11} />
            <span>입고 {product.entry.stockInDate}</span>
            <span className="ml-auto font-medium">{product.daysInStock}일 경과</span>
          </div>
        )}

        {/* 메모 */}
        {product.entry.notes && (
          <p className="mt-2 text-xs text-zinc-400 bg-zinc-50 dark:bg-zinc-800 rounded-lg px-2 py-1.5 line-clamp-2">
            {product.entry.notes}
          </p>
        )}

        {/* 하단 버튼 */}
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => onEdit(product)}
            className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-950/30 border border-violet-200 dark:border-violet-800 rounded-xl py-2 transition-colors"
          >
            <Pencil size={12} />
            재고 수정
          </button>
          <button
            onClick={handleDeleteClick}
            className="flex items-center justify-center gap-1 text-xs font-medium text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 border border-zinc-200 dark:border-zinc-700 hover:border-red-200 dark:hover:border-red-800 rounded-xl px-3 py-2 transition-colors"
            title={product.isManual ? "삭제" : "목록에서 숨기기"}
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}
