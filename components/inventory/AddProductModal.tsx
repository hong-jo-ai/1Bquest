"use client";

import { useState, useEffect } from "react";
import { X, Save, Package, Tag, Barcode, Image as ImageIcon } from "lucide-react";
import { addManualProduct } from "@/lib/inventoryStorage";
import type { ProductInfo } from "@/lib/inventoryStorage";

interface Props {
  existingSkus: Set<string>;
  categories: string[];
  onSave: () => void;
  onClose: () => void;
}

export default function AddProductModal({ existingSkus, categories, onSave, onClose }: Props) {
  const [name, setName]         = useState("");
  const [sku, setSku]           = useState("");
  const [image, setImage]       = useState("");
  const [category, setCategory] = useState("");
  const [skuError, setSkuError] = useState("");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleSave = () => {
    if (!name.trim()) return;
    if (!sku.trim()) return;
    if (existingSkus.has(sku.trim())) {
      setSkuError("이미 존재하는 SKU입니다.");
      return;
    }
    const product: ProductInfo = {
      sku: sku.trim(),
      name: name.trim(),
      image: image.trim(),
      category: category.trim(),
      isManual: true,
    };
    addManualProduct(product);
    onSave();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">

        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-100 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-violet-100 dark:bg-violet-950/50 rounded-lg flex items-center justify-center">
              <Package size={16} className="text-violet-600" />
            </div>
            <h3 className="text-base font-bold text-zinc-800 dark:text-zinc-100">상품 수동 추가</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* 폼 */}
        <div className="p-6 space-y-5">

          {/* 상품명 */}
          <div>
            <label className="flex items-center gap-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
              <Package size={14} />
              상품명 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예) PAULVICE 클래식 오토매틱"
              className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>

          {/* SKU */}
          <div>
            <label className="flex items-center gap-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
              <Barcode size={14} />
              SKU / 상품코드 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={sku}
              onChange={(e) => { setSku(e.target.value); setSkuError(""); }}
              placeholder="예) PW-CA-001-BK"
              className={`w-full bg-zinc-50 dark:bg-zinc-800 border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 ${
                skuError ? "border-red-400" : "border-zinc-200 dark:border-zinc-700"
              }`}
            />
            {skuError && <p className="mt-1 text-xs text-red-500">{skuError}</p>}
          </div>

          {/* 카테고리 */}
          <div>
            <label className="flex items-center gap-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
              <Tag size={14} />
              카테고리
            </label>
            <input
              type="text"
              list="category-suggestions"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="예) 오토매틱, 다이버, 드레스..."
              className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
            {categories.length > 0 && (
              <datalist id="category-suggestions">
                {categories.map((c) => <option key={c} value={c} />)}
              </datalist>
            )}
          </div>

          {/* 이미지 URL */}
          <div>
            <label className="flex items-center gap-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
              <ImageIcon size={14} />
              이미지 URL <span className="text-xs text-zinc-400 font-normal">(선택)</span>
            </label>
            <input
              type="url"
              value={image}
              onChange={(e) => setImage(e.target.value)}
              placeholder="https://..."
              className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
            {image && (
              <div className="mt-2 w-16 h-16 rounded-xl overflow-hidden bg-zinc-100 dark:bg-zinc-800">
                <img
                  src={image}
                  alt="미리보기"
                  className="w-full h-full object-cover"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              </div>
            )}
          </div>

          {/* 버튼 */}
          <div className="flex gap-3 pt-1">
            <button
              onClick={onClose}
              className="flex-1 py-3 rounded-xl border border-zinc-200 dark:border-zinc-700 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
            >
              취소
            </button>
            <button
              onClick={handleSave}
              disabled={!name.trim() || !sku.trim()}
              className="flex-1 flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-xl py-3 text-sm transition-colors"
            >
              <Save size={15} />
              추가하기
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
