"use client";

import { useState } from "react";
import { X, Trash2 } from "lucide-react";
import type { Campaign, CampaignBrand } from "@/lib/campaigns/types";

interface Props {
  campaign: Campaign | null; // null = 신규
  brand: CampaignBrand;
  onClose: () => void;
  onSaved: () => void;
}

function newId() {
  return `c${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function todayKst(offsetDays = 0): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

export default function CampaignEditModal({ campaign, brand, onClose, onSaved }: Props) {
  const [name,         setName]         = useState(campaign?.name         ?? "");
  const [startDate,    setStartDate]    = useState(campaign?.startDate    ?? todayKst(0));
  const [endDate,      setEndDate]      = useState(campaign?.endDate      ?? "");
  const [couponCode,   setCouponCode]   = useState(campaign?.couponCode   ?? "");
  const [utmSource,    setUtmSource]    = useState(campaign?.utmSource    ?? "");
  const [utmCampaign,  setUtmCampaign]  = useState(campaign?.utmCampaign  ?? "");
  const [landingUrl,   setLandingUrl]   = useState(campaign?.landingUrl   ?? "https://paulvice.kr/");
  const [notes,        setNotes]        = useState(campaign?.notes        ?? "");

  const [saving,   setSaving]   = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  const canSave = name.trim().length > 0 && startDate.length === 10;

  const save = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    setError(null);
    const payload: Campaign = {
      id:           campaign?.id ?? newId(),
      name:         name.trim(),
      brand,
      startDate,
      endDate:      endDate.length === 10 ? endDate : null,
      couponCode:   couponCode.trim() || null,
      utmSource:    utmSource.trim(),
      utmCampaign:  utmCampaign.trim(),
      landingUrl:   landingUrl.trim() || "https://paulvice.kr/",
      notes:        notes.trim() || undefined,
    };
    try {
      const res = await fetch("/api/campaigns", {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ brand, campaign: payload }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error ?? "저장 실패");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!campaign || deleting) return;
    if (!confirm(`'${campaign.name}' 캠페인을 삭제할까요?`)) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch("/api/campaigns", {
        method:  "DELETE",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ brand, id: campaign.id }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error ?? "삭제 실패");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
          <h3 className="text-base font-semibold text-zinc-800 dark:text-zinc-100">
            {campaign ? "캠페인 편집" : "새 캠페인"}
          </h3>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600" aria-label="닫기">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4 text-sm">
          <Field label="캠페인 이름">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 5월 19일 인플루언서 컬랩"
              className="w-full px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="시작일">
              <input
                type="date"
                value={startDate}
                max={endDate || undefined}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200"
              />
            </Field>
            <Field label="종료일 (비우면 미정)">
              <input
                type="date"
                value={endDate}
                min={startDate || undefined}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200"
              />
            </Field>
          </div>

          <Field
            label="Cafe24 쿠폰 코드"
            hint="Cafe24 어드민에서 발행한 쿠폰의 '쿠폰 코드'. 이 코드가 적용된 주문만 캠페인 매출로 집계됩니다."
          >
            <input
              value={couponCode}
              onChange={(e) => setCouponCode(e.target.value)}
              placeholder="예: INFLU0519"
              className="w-full px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 tabular-nums"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="UTM Source">
              <input
                value={utmSource}
                onChange={(e) => setUtmSource(e.target.value)}
                placeholder="influencer_xxx"
                className="w-full px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200"
              />
            </Field>
            <Field label="UTM Campaign">
              <input
                value={utmCampaign}
                onChange={(e) => setUtmCampaign(e.target.value)}
                placeholder="0519_collab"
                className="w-full px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200"
              />
            </Field>
          </div>

          <Field label="랜딩 URL">
            <input
              value={landingUrl}
              onChange={(e) => setLandingUrl(e.target.value)}
              placeholder="https://paulvice.kr/"
              className="w-full px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200"
            />
          </Field>

          <Field label="메모 (선택)">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 resize-none"
            />
          </Field>

          {error && (
            <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
          )}
        </div>

        <div className="px-5 py-4 border-t border-zinc-100 dark:border-zinc-800 flex items-center gap-2">
          {campaign && (
            <button
              onClick={remove}
              disabled={deleting || saving}
              className="text-xs font-semibold text-rose-600 dark:text-rose-400 px-3 py-2 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/30 flex items-center gap-1.5 disabled:opacity-50"
            >
              <Trash2 size={12} /> 삭제
            </button>
          )}
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="text-xs font-semibold text-zinc-600 dark:text-zinc-300 px-3 py-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            취소
          </button>
          <button
            onClick={save}
            disabled={!canSave || saving}
            className="text-xs font-semibold bg-violet-600 hover:bg-violet-700 text-white px-3 py-2 rounded-lg disabled:opacity-50 transition"
          >
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[11px] font-semibold text-zinc-500 mb-1.5 block">{label}</label>
      {children}
      {hint && <p className="text-[10px] text-zinc-400 mt-1">{hint}</p>}
    </div>
  );
}
