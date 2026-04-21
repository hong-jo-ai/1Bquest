"use client";

import { useState } from "react";
import { X } from "lucide-react";
import type { GbStatus } from "@/lib/groupBuying/types";

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
    influencer_platform: "instagram",
    influencer_followers: "",
    notes: "",
  });

  const set = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.influencer_handle) return;
    setSaving(true);
    try {
      const title = form.title || `${form.influencer_name || form.influencer_handle} 공동구매`;
      await fetch("/api/group-buying/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          influencer_handle: form.influencer_handle,
          influencer_name: form.influencer_name || null,
          influencer_platform: form.influencer_platform,
          influencer_followers: form.influencer_followers ? Number(form.influencer_followers) : null,
          commission_type: "rate",
          commission_rate: null,
          commission_fixed_amount: null,
          order_mode: "cafe24",
          notes: form.notes || null,
          status: "scouted" as GbStatus,
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
      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 w-full max-w-md shadow-xl">
        <div className="flex items-center justify-between p-5 border-b border-zinc-100 dark:border-zinc-800">
          <h2 className="text-lg font-bold text-zinc-800 dark:text-zinc-100">인플루언서 발굴 등록</h2>
          <button onClick={onClose} className="p-1 text-zinc-400 hover:text-zinc-600 transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <p className="text-xs text-zinc-400">인플루언서 정보만 입력하세요. 상품, 조건 등은 협의 진행 후 추가할 수 있습니다.</p>

          <div>
            <label className={labelCls}>인플루언서 핸들 *</label>
            <input className={inputCls} placeholder="@username" value={form.influencer_handle} onChange={(e) => set("influencer_handle", e.target.value)} required />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>이름</label>
              <input className={inputCls} placeholder="이름" value={form.influencer_name} onChange={(e) => set("influencer_name", e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>플랫폼</label>
              <select className={inputCls} value={form.influencer_platform} onChange={(e) => set("influencer_platform", e.target.value)}>
                <option value="instagram">Instagram</option>
                <option value="youtube">YouTube</option>
                <option value="tiktok">TikTok</option>
              </select>
            </div>
          </div>

          <div>
            <label className={labelCls}>팔로워</label>
            <input className={inputCls} type="number" placeholder="예: 50000" value={form.influencer_followers} onChange={(e) => set("influencer_followers", e.target.value)} />
          </div>

          <div>
            <label className={labelCls}>캠페인 제목</label>
            <input className={inputCls} placeholder="비워두면 자동 생성" value={form.title} onChange={(e) => set("title", e.target.value)} />
          </div>

          <div>
            <label className={labelCls}>메모</label>
            <textarea className={inputCls} rows={2} placeholder="제안 배경, 연락처 등" value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          </div>

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 text-sm font-medium text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700 rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">
              취소
            </button>
            <button type="submit" disabled={saving} className="flex-1 py-2.5 text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 rounded-xl transition-colors disabled:opacity-50">
              {saving ? "저장 중..." : "발굴 등록"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
