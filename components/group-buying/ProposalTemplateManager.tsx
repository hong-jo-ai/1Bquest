"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Save, Trash2, Copy, Check, FileText } from "lucide-react";
import { TEMPLATE_VARIABLES, type GbProposalTemplate } from "@/lib/groupBuying/types";

type TemplatePlatform = "all" | "instagram" | "youtube" | "tiktok";

const PLATFORM_LABEL: Record<TemplatePlatform, string> = {
  all: "공통",
  instagram: "Instagram",
  youtube: "YouTube",
  tiktok: "TikTok",
};

export default function ProposalTemplateManager() {
  const [templates, setTemplates] = useState<GbProposalTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ name: string; platform: TemplatePlatform; body: string; notes: string }>({
    name: "",
    platform: "all",
    body: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/group-buying/proposal-templates");
      const json = await res.json();
      setTemplates(json.templates ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const selected = templates.find((t) => t.id === selectedId) ?? null;

  useEffect(() => {
    if (selected) {
      setEditForm({
        name: selected.name,
        platform: (selected.platform ?? "all") as TemplatePlatform,
        body: selected.body,
        notes: selected.notes ?? "",
      });
    } else {
      setEditForm({ name: "", platform: "all", body: "", notes: "" });
    }
  }, [selectedId, selected]);

  const handleNew = () => {
    setSelectedId(null);
    setEditForm({
      name: "",
      platform: "all",
      body: "안녕하세요 {{name}}님!\n폴바이스 마케팅팀입니다.\n\n{{product}} 공동구매를 제안드리고 싶어 연락드립니다.\n\n조건:\n- 수수료: {{commission}}\n- 공구가: {{discount_price}} (정가 {{original_price}})\n- 기간: {{start_date}} ~ {{end_date}}\n\n관심 있으시면 답장 부탁드립니다. 감사합니다!",
      notes: "",
    });
  };

  const handleSave = async () => {
    if (!editForm.name.trim() || !editForm.body.trim()) {
      alert("템플릿 이름과 본문을 입력하세요");
      return;
    }
    setSaving(true);
    try {
      const url = selectedId
        ? `/api/group-buying/proposal-templates/${selectedId}`
        : "/api/group-buying/proposal-templates";
      const res = await fetch(url, {
        method: selectedId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const hint = String(json.error ?? "").includes("gb_proposal_templates")
          ? "\n\nSupabase에서 20260421_gb_proposal_templates.sql 마이그레이션을 먼저 실행해야 합니다."
          : "";
        alert(`저장 실패: ${json.error ?? res.statusText}${hint}`);
        return;
      }
      if (!selectedId && json.template) setSelectedId(json.template.id);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("이 템플릿을 삭제하시겠습니까?")) return;
    await fetch(`/api/group-buying/proposal-templates/${id}`, { method: "DELETE" });
    if (selectedId === id) setSelectedId(null);
    await load();
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(editForm.body);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const inputCls = "w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-500";

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 p-6">
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/tools/group-buying" className="p-2 rounded-xl text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
              <ArrowLeft size={18} />
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-zinc-800 dark:text-zinc-100">제안 템플릿</h1>
              <p className="text-sm text-zinc-400 mt-0.5">공구 제안에 재사용할 메시지 템플릿 관리</p>
            </div>
          </div>
          <button
            onClick={handleNew}
            className="flex items-center gap-1.5 text-sm font-semibold bg-violet-600 hover:bg-violet-700 text-white px-4 py-2.5 rounded-xl transition-colors"
          >
            <Plus size={16} /> 새 템플릿
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* 좌측: 목록 */}
          <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-4 space-y-2 h-fit">
            <p className="text-xs font-semibold text-zinc-500 px-2 pb-2 border-b border-zinc-100 dark:border-zinc-800">
              전체 {templates.length}개
            </p>
            {loading && <p className="text-xs text-zinc-400 text-center py-4">불러오는 중...</p>}
            {!loading && templates.length === 0 && (
              <div className="flex flex-col items-center gap-2 text-zinc-400 py-8">
                <FileText size={32} className="opacity-30" />
                <p className="text-xs">아직 템플릿이 없습니다</p>
              </div>
            )}
            {templates.map((t) => (
              <button
                key={t.id}
                onClick={() => setSelectedId(t.id)}
                className={`w-full text-left p-3 rounded-xl border transition-colors ${
                  selectedId === t.id
                    ? "bg-violet-50 dark:bg-violet-950/30 border-violet-300 dark:border-violet-700"
                    : "border-transparent hover:bg-zinc-50 dark:hover:bg-zinc-800"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100 truncate">{t.name}</p>
                  <span className="shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500">
                    {PLATFORM_LABEL[(t.platform ?? "all") as TemplatePlatform]}
                  </span>
                </div>
                <p className="text-xs text-zinc-400 mt-1 line-clamp-2">{t.body}</p>
              </button>
            ))}
          </div>

          {/* 우측: 편집 */}
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-zinc-700 dark:text-zinc-200">
                  {selectedId ? "템플릿 편집" : "새 템플릿"}
                </h2>
                {selectedId && (
                  <button
                    onClick={() => handleDelete(selectedId)}
                    className="flex items-center gap-1 text-xs text-red-500 hover:text-red-600 transition-colors"
                  >
                    <Trash2 size={12} /> 삭제
                  </button>
                )}
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="text-xs font-medium text-zinc-500 mb-1 block">템플릿 이름 *</label>
                  <input className={inputCls} placeholder="예: 뷰티 IG 공구 제안 v1" value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-500 mb-1 block">플랫폼</label>
                  <select className={inputCls} value={editForm.platform} onChange={(e) => setEditForm((f) => ({ ...f, platform: e.target.value as TemplatePlatform }))}>
                    <option value="all">공통</option>
                    <option value="instagram">Instagram</option>
                    <option value="youtube">YouTube</option>
                    <option value="tiktok">TikTok</option>
                  </select>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-zinc-500">본문 *</label>
                  <button
                    onClick={handleCopy}
                    className="flex items-center gap-1 text-xs text-zinc-500 hover:text-violet-600 transition-colors"
                  >
                    {copied ? <><Check size={12} /> 복사됨</> : <><Copy size={12} /> 복사</>}
                  </button>
                </div>
                <textarea
                  className={inputCls + " font-mono"}
                  rows={14}
                  placeholder="제안 메시지 본문. {{handle}} 같은 변수를 사용할 수 있습니다."
                  value={editForm.body}
                  onChange={(e) => setEditForm((f) => ({ ...f, body: e.target.value }))}
                />
              </div>

              <div>
                <label className="text-xs font-medium text-zinc-500 mb-1 block">메모</label>
                <input className={inputCls} placeholder="이 템플릿을 언제 쓰는지 등" value={editForm.notes} onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))} />
              </div>

              <button
                onClick={handleSave}
                disabled={saving}
                className="w-full flex items-center justify-center gap-1.5 text-sm font-semibold bg-violet-600 hover:bg-violet-700 text-white py-2.5 rounded-xl transition-colors disabled:opacity-50"
              >
                <Save size={14} /> {saving ? "저장 중..." : selectedId ? "저장" : "생성"}
              </button>
            </div>

            {/* 변수 안내 */}
            <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-5">
              <p className="text-sm font-bold text-zinc-700 dark:text-zinc-200 mb-3">사용 가능한 변수</p>
              <p className="text-xs text-zinc-400 mb-3">캠페인 상세에서 이 템플릿을 불러올 때 아래 변수들이 캠페인 데이터로 자동 치환됩니다.</p>
              <div className="grid grid-cols-2 gap-2">
                {TEMPLATE_VARIABLES.map((v) => (
                  <div key={v.key} className="flex items-start gap-2 text-xs">
                    <code className="shrink-0 px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded text-violet-600 font-mono">{v.key}</code>
                    <span className="text-zinc-500">{v.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
