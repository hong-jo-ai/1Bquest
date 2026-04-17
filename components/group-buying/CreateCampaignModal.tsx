"use client";

import { useState } from "react";
import { X } from "lucide-react";
import type { GbStatus, OrderMode } from "@/lib/groupBuying/types";

interface Props {
  onSave: () => void;
  onClose: () => void;
}

export default function CreateCampaignModal({ onSave, onClose }: Props) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: "",
    influencer_handle: "",
    influencer_name: "",
    influencer_platform: "instagram" as string,
    influencer_followers: "",
    product_sku: "",
    product_name: "",
    product_image: "",
    original_price: "",
    discount_price: "",
    commission_type: "rate" as "rate" | "fixed_per_unit",
    commission_rate: "",
    commission_fixed_amount: "",
    start_date: "",
    end_date: "",
    allocated_stock: "",
    order_mode: "cafe24" as OrderMode,
    notes: "",
  });

  const set = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title || !form.influencer_handle) return;
    setSaving(true);
    try {
      await fetch("/api/group-buying/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title,
          influencer_handle: form.influencer_handle,
          influencer_name: form.influencer_name || null,
          influencer_platform: form.influencer_platform,
          influencer_followers: form.influencer_followers ? Number(form.influencer_followers) : null,
          product_sku: form.product_sku || null,
          product_name: form.product_name || null,
          product_image: form.product_image || null,
          original_price: form.original_price ? Number(form.original_price) : null,
          discount_price: form.discount_price ? Number(form.discount_price) : null,
          commission_type: form.commission_type,
          commission_rate: form.commission_rate ? Number(form.commission_rate) : null,
          commission_fixed_amount: form.commission_fixed_amount ? Number(form.commission_fixed_amount) : null,
          start_date: form.start_date || null,
          end_date: form.end_date || null,
          allocated_stock: form.allocated_stock ? Number(form.allocated_stock) : 0,
          order_mode: form.order_mode,
          notes: form.notes || null,
          status: "proposal" as GbStatus,
        }),
      });
      onSave();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    "w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-500";
  const labelCls = "block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-xl">
        {/* 헤더 */}
        <div className="flex items-center justify-between p-5 border-b border-zinc-100 dark:border-zinc-800">
          <h2 className="text-lg font-bold text-zinc-800 dark:text-zinc-100">새 공동구매 등록</h2>
          <button onClick={onClose} className="p-1 text-zinc-400 hover:text-zinc-600 transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* 캠페인 제목 */}
          <div>
            <label className={labelCls}>캠페인 제목 *</label>
            <input className={inputCls} placeholder="예: 폴바이스 x 민지 공동구매" value={form.title} onChange={(e) => set("title", e.target.value)} required />
          </div>

          {/* 인플루언서 정보 */}
          <fieldset className="border border-zinc-100 dark:border-zinc-800 rounded-xl p-4 space-y-3">
            <legend className="text-xs font-semibold text-zinc-500 px-1">인플루언서</legend>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>핸들 *</label>
                <input className={inputCls} placeholder="@username" value={form.influencer_handle} onChange={(e) => set("influencer_handle", e.target.value)} required />
              </div>
              <div>
                <label className={labelCls}>이름</label>
                <input className={inputCls} placeholder="이름" value={form.influencer_name} onChange={(e) => set("influencer_name", e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>플랫폼</label>
                <select className={inputCls} value={form.influencer_platform} onChange={(e) => set("influencer_platform", e.target.value)}>
                  <option value="instagram">Instagram</option>
                  <option value="youtube">YouTube</option>
                  <option value="tiktok">TikTok</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>팔로워</label>
                <input className={inputCls} type="number" placeholder="10000" value={form.influencer_followers} onChange={(e) => set("influencer_followers", e.target.value)} />
              </div>
            </div>
          </fieldset>

          {/* 상품 정보 */}
          <fieldset className="border border-zinc-100 dark:border-zinc-800 rounded-xl p-4 space-y-3">
            <legend className="text-xs font-semibold text-zinc-500 px-1">상품</legend>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>상품명</label>
                <input className={inputCls} placeholder="상품명" value={form.product_name} onChange={(e) => set("product_name", e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>SKU</label>
                <input className={inputCls} placeholder="Cafe24 SKU" value={form.product_sku} onChange={(e) => set("product_sku", e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>정가 (원)</label>
                <input className={inputCls} type="number" placeholder="150000" value={form.original_price} onChange={(e) => set("original_price", e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>공구가 (원)</label>
                <input className={inputCls} type="number" placeholder="120000" value={form.discount_price} onChange={(e) => set("discount_price", e.target.value)} />
              </div>
            </div>
          </fieldset>

          {/* 조건 */}
          <fieldset className="border border-zinc-100 dark:border-zinc-800 rounded-xl p-4 space-y-3">
            <legend className="text-xs font-semibold text-zinc-500 px-1">조건</legend>
            <div>
              <label className={labelCls}>수수료 방식</label>
              <select className={inputCls} value={form.commission_type} onChange={(e) => set("commission_type", e.target.value)}>
                <option value="rate">비율 (%)</option>
                <option value="fixed_per_unit">건당 고정금액</option>
              </select>
            </div>
            {form.commission_type === "rate" ? (
              <div>
                <label className={labelCls}>수수료율 (%)</label>
                <input className={inputCls} type="number" step="0.1" placeholder="20" value={form.commission_rate} onChange={(e) => set("commission_rate", e.target.value)} />
              </div>
            ) : (
              <div>
                <label className={labelCls}>건당 금액 (원)</label>
                <input className={inputCls} type="number" placeholder="30000" value={form.commission_fixed_amount} onChange={(e) => set("commission_fixed_amount", e.target.value)} />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>시작일</label>
                <input className={inputCls} type="date" value={form.start_date} onChange={(e) => set("start_date", e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>종료일</label>
                <input className={inputCls} type="date" value={form.end_date} onChange={(e) => set("end_date", e.target.value)} />
              </div>
            </div>
          </fieldset>

          {/* 운영 */}
          <fieldset className="border border-zinc-100 dark:border-zinc-800 rounded-xl p-4 space-y-3">
            <legend className="text-xs font-semibold text-zinc-500 px-1">운영</legend>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>배정 수량</label>
                <input className={inputCls} type="number" placeholder="100" value={form.allocated_stock} onChange={(e) => set("allocated_stock", e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>주문 방식</label>
                <select className={inputCls} value={form.order_mode} onChange={(e) => set("order_mode", e.target.value)}>
                  <option value="cafe24">자사몰 주문 (Cafe24)</option>
                  <option value="purchase_order">발주서 (인플루언서)</option>
                </select>
              </div>
            </div>
          </fieldset>

          {/* 메모 */}
          <div>
            <label className={labelCls}>메모</label>
            <textarea className={inputCls} rows={3} placeholder="특이사항, 협의 내용 등" value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          </div>

          {/* 제출 */}
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 text-sm font-medium text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700 rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">
              취소
            </button>
            <button type="submit" disabled={saving} className="flex-1 py-2.5 text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 rounded-xl transition-colors disabled:opacity-50">
              {saving ? "저장 중..." : "등록"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
