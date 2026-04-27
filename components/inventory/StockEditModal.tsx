"use client";

import { useState, useEffect } from "react";
import { X, Plus, Minus, Save, Calendar, Package, StickyNote, Tag } from "lucide-react";
import type { InventoryProduct } from "@/lib/inventoryStorage";
import { CHANNELS } from "@/lib/multiChannelData";

const CHANNEL_TEXT: Record<string, string> = {
  cafe24: "text-sky-500",
  wconcept: "text-rose-500",
  musinsa: "text-blue-500",
  "29cm": "text-zinc-700 dark:text-zinc-300",
  groupbuy: "text-amber-500",
  sixshop: "text-emerald-500",
  naver_smartstore: "text-green-500",
  sixshop_global: "text-teal-500",
};

function channelLabel(id: string): string {
  return CHANNELS.find((c) => c.id === id)?.name ?? id;
}

interface Props {
  product: InventoryProduct;
  categories: string[]; // 기존 카테고리 목록 (자동완성용)
  onSave: (sku: string, patch: { initialStock: number; stockInDate: string; manualAdjustment: number; notes: string; categoryOverride: string }) => void;
  onClose: () => void;
}

export default function StockEditModal({ product, categories, onSave, onClose }: Props) {
  const [initialStock, setInitialStock] = useState(product.entry.initialStock);
  const [stockInDate, setStockInDate] = useState(product.entry.stockInDate);
  const [adjustment, setAdjustment] = useState(product.entry.manualAdjustment);
  const [notes, setNotes] = useState(product.entry.notes);
  const [categoryOverride, setCategoryOverride] = useState(product.entry.categoryOverride ?? "");

  const previewStock = Math.max(0, initialStock + adjustment - product.totalSold);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        {/* 헤더 */}
        <div className="bg-zinc-50 dark:bg-zinc-800 p-5 flex items-center gap-4 border-b border-zinc-100 dark:border-zinc-700">
          <div className="w-14 h-14 rounded-xl overflow-hidden bg-zinc-100 dark:bg-zinc-700 flex-shrink-0 flex items-center justify-center">
            {product.image ? (
              <img src={product.image} alt={product.name} className="w-full h-full object-cover" />
            ) : (
              <Package size={24} className="text-zinc-400" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-zinc-400 mb-0.5 font-mono">{product.sku}</p>
            <h3 className="text-base font-bold text-zinc-800 dark:text-zinc-100 leading-tight line-clamp-2">
              {product.name}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400 transition-colors flex-shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        {/* 채널별 판매 현황 — 판매가 있는 채널만 */}
        {(() => {
          const entries = Object.entries(product.soldByChannel).filter(([, n]) => n > 0);
          if (entries.length === 0) return null;
          const cols = Math.min(entries.length, 4);
          return (
            <div
              className="grid gap-px bg-zinc-100 dark:bg-zinc-800 border-b border-zinc-100 dark:border-zinc-700"
              style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
            >
              {entries.map(([id, value]) => (
                <div key={id} className="bg-white dark:bg-zinc-900 px-3 py-3 text-center">
                  <p className={`text-base font-bold ${CHANNEL_TEXT[id] ?? "text-zinc-700 dark:text-zinc-300"}`}>
                    {value}
                  </p>
                  <p className="text-xs text-zinc-400">{channelLabel(id)} 판매</p>
                </div>
              ))}
            </div>
          );
        })()}

        {/* 폼 */}
        <div className="p-6 space-y-5">
          {/* 초기 입고 수량 */}
          <div>
            <label className="flex items-center gap-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
              <Package size={14} />
              초기 입고 수량
            </label>
            <div className="flex items-center gap-3">
              <button onClick={() => setInitialStock(Math.max(0, initialStock - 1))}
                className="w-9 h-9 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">
                <Minus size={16} />
              </button>
              <input
                type="number" min="0" value={initialStock}
                onChange={(e) => setInitialStock(Math.max(0, parseInt(e.target.value) || 0))}
                className="flex-1 text-center text-xl font-bold bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl py-2 focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
              <button onClick={() => setInitialStock(initialStock + 1)}
                className="w-9 h-9 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">
                <Plus size={16} />
              </button>
            </div>
          </div>

          {/* 수동 조정 */}
          <div>
            <label className="flex items-center gap-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
              <Plus size={14} />
              수동 재고 조정 <span className="text-xs text-zinc-400 font-normal">(추가입고 +, 폐기/분실 -)</span>
            </label>
            <div className="flex items-center gap-3">
              <button onClick={() => setAdjustment(adjustment - 1)}
                className="w-9 h-9 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">
                <Minus size={16} />
              </button>
              <input
                type="number" value={adjustment}
                onChange={(e) => setAdjustment(parseInt(e.target.value) || 0)}
                className="flex-1 text-center text-xl font-bold bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl py-2 focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
              <button onClick={() => setAdjustment(adjustment + 1)}
                className="w-9 h-9 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">
                <Plus size={16} />
              </button>
            </div>
          </div>

          {/* 입고일 */}
          <div>
            <label className="flex items-center gap-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
              <Calendar size={14} />
              최초 입고일
            </label>
            <input
              type="date" value={stockInDate}
              onChange={(e) => setStockInDate(e.target.value)}
              className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>

          {/* 카테고리 */}
          <div>
            <label className="flex items-center gap-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
              <Tag size={14} />
              카테고리
              {product.category && !product.entry.categoryOverride && (
                <span className="text-xs text-zinc-400 font-normal">— 현재: {product.category}</span>
              )}
            </label>
            <input
              type="text"
              list="modal-category-suggestions"
              value={categoryOverride}
              onChange={(e) => setCategoryOverride(e.target.value)}
              placeholder={product.category || "예) 오토매틱, 다이버, 드레스..."}
              className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
            {categories.length > 0 && (
              <datalist id="modal-category-suggestions">
                {categories.map((c) => <option key={c} value={c} />)}
              </datalist>
            )}
            {categoryOverride && (
              <button
                onClick={() => setCategoryOverride("")}
                className="mt-1 text-xs text-zinc-400 hover:text-zinc-600"
              >
                초기화 (Cafe24 기본값 사용)
              </button>
            )}
          </div>

          {/* 메모 */}
          <div>
            <label className="flex items-center gap-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
              <StickyNote size={14} />
              메모
            </label>
            <textarea
              value={notes} rows={2}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="프로모션 계획, 특이사항 등..."
              className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>

          {/* 저장 후 예상 재고 */}
          <div className="bg-violet-50 dark:bg-violet-950/30 rounded-xl px-4 py-3 flex items-center justify-between">
            <span className="text-sm text-violet-600 dark:text-violet-400 font-medium">저장 후 현재 재고</span>
            <span className="text-2xl font-bold text-violet-700 dark:text-violet-300">{previewStock}개</span>
          </div>

          <button
            onClick={() => { onSave(product.sku, { initialStock, stockInDate, manualAdjustment: adjustment, notes, categoryOverride }); onClose(); }}
            className="w-full flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 text-white font-semibold rounded-xl py-3 transition-colors"
          >
            <Save size={16} />
            저장하기
          </button>
        </div>
      </div>
    </div>
  );
}
