"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Sparkles, Plus, RefreshCw, Loader2, CalendarClock, Check, X, Trash2, Pencil, PackageCheck,
} from "lucide-react";

interface Milestone {
  label: string;
  date: string;
  note?: string | null;
  done?: boolean;
}
type Status = "tracking" | "arrived" | "cancelled";
interface UpcomingProduct {
  id: string;
  brand: string;
  name: string;
  category?: string | null;
  milestones: Milestone[];
  status: Status;
  notes?: string | null;
  /** 파쇼 발주 파생(읽기전용) — 수정·삭제는 파쇼 원장에서 (lib/upcomingProducts.ts 동일 필드) */
  derived?: boolean;
}

const BRANDS = ["해리엇", "폴바이스", "홍성조"];

function todayKst(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
function daysFromToday(date: string): number {
  return Math.round((Date.parse(date + "T00:00:00Z") - Date.parse(todayKst() + "T00:00:00Z")) / 86400000);
}

const TONE: Record<string, string> = {
  violet: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  red: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  zinc: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

function milestoneBadge(m: Milestone): { label: string; tone: keyof typeof TONE } {
  if (m.done) return { label: "완료", tone: "emerald" };
  const d = daysFromToday(m.date);
  if (d < 0) return { label: `${-d}일 지남`, tone: "red" };
  if (d === 0) return { label: "오늘", tone: "amber" };
  if (d <= 14) return { label: `D-${d}`, tone: "amber" };
  return { label: `D-${d}`, tone: "violet" };
}

/** 다음(미완료) 마일스톤 — 정렬 후 첫 미완료. 없으면 null. */
function nextMilestone(p: UpcomingProduct): Milestone | null {
  return [...p.milestones].sort((a, b) => a.date.localeCompare(b.date)).find((m) => !m.done) ?? null;
}

export default function UpcomingProducts() {
  const [items, setItems] = useState<UpcomingProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<UpcomingProduct | null>(null);

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3000); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/upcoming-products", { cache: "no-store" });
      const j = await res.json();
      if (j.ok) setItems(j.products ?? []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const patch = async (id: string, body: Record<string, unknown>) => {
    setBusy(id);
    try {
      const res = await fetch(`/api/upcoming-products/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error ?? "수정 실패");
      await load();
    } catch (e) { showToast(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  const toggleMilestone = (p: UpcomingProduct, idx: number) => {
    const milestones = p.milestones.map((m, i) => (i === idx ? { ...m, done: !m.done } : m));
    patch(p.id, { milestones });
  };

  const markArrived = (p: UpcomingProduct) => {
    if (!confirm(`'${p.name}' 입고 완료로 표시할까요?`)) return;
    patch(p.id, { status: "arrived" });
  };

  const remove = async (p: UpcomingProduct) => {
    if (!confirm(`'${p.name}'를 로드맵에서 삭제할까요?`)) return;
    setBusy(p.id);
    try {
      await fetch(`/api/upcoming-products/${p.id}`, { method: "DELETE" });
      await load();
    } finally { setBusy(null); }
  };

  const tracking = items
    .filter((p) => p.status === "tracking")
    .sort((a, b) => (nextMilestone(a)?.date ?? "9999").localeCompare(nextMilestone(b)?.date ?? "9999"));
  const done = items.filter((p) => p.status !== "tracking");

  return (
    <div className="max-w-[1100px] mx-auto px-4 sm:px-6 py-6">
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-zinc-900 text-white text-sm px-4 py-2.5 rounded-full shadow-lg">{toast}</div>
      )}

      <div className="flex items-center justify-between gap-3 flex-wrap mb-5">
        <div>
          <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <Sparkles size={18} className="text-violet-500" /> 신제품 입고 로드맵
          </h1>
          <p className="text-xs text-zinc-500 mt-0.5">출시 예정 신상의 샘플·입고 일정 추적 — 마일스톤별 D-day</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} disabled={loading} className="text-sm font-medium bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 text-zinc-700 dark:text-zinc-200 px-3 py-1.5 rounded-full flex items-center gap-1.5 disabled:opacity-50">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> 새로고침
          </button>
          <button onClick={() => { setEditing(null); setShowForm((v) => !v); }} className="text-sm font-semibold bg-violet-600 hover:bg-violet-700 text-white px-3 py-1.5 rounded-full flex items-center gap-1.5">
            <Plus size={14} /> 신상 추가
          </button>
        </div>
      </div>

      {showForm && (
        <ProductForm
          initial={editing}
          onDone={() => { setShowForm(false); setEditing(null); load(); showToast(editing ? "수정됨" : "신상 추가됨"); }}
          onCancel={() => { setShowForm(false); setEditing(null); }}
        />
      )}

      {loading && items.length === 0 ? (
        <div className="flex items-center justify-center py-12 text-zinc-400 gap-2"><Loader2 size={16} className="animate-spin" /> 불러오는 중…</div>
      ) : tracking.length === 0 && !showForm ? (
        <p className="text-sm text-zinc-400 py-6">추적 중인 신상이 없습니다. ‘신상 추가’로 출시 예정 제품을 등록하세요.</p>
      ) : (
        <div className="space-y-2.5">
          {tracking.map((p) => {
            const next = nextMilestone(p);
            const sorted = [...p.milestones].sort((a, b) => a.date.localeCompare(b.date));
            return (
              <div key={p.id} className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">{p.brand}</span>
                      <span className="font-bold text-zinc-900 dark:text-zinc-100">{p.name}</span>
                      {p.category && <span className="text-[11px] text-zinc-400">{p.category}</span>}
                      {next && (() => { const b = milestoneBadge(next); return (
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${TONE[b.tone]}`}>
                          {next.label} {b.label}
                        </span>
                      ); })()}
                    </div>
                    {p.notes && <p className="text-xs text-zinc-500 mt-1">{p.notes}</p>}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {p.derived ? (
                      /* 파쇼 발주 파생(읽기전용) — kv에 없는 항목이라 여기서 수정하면 404. 원본 수정은 파쇼 원장에서. */
                      <a href="/pasho" title="파쇼 발주에서 자동 생성된 항목입니다. 단계·내용 수정은 파쇼 원장에서 하세요." className="text-[10px] font-bold px-2 py-1 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-900/50 hover:bg-amber-100">
                        파쇼 연동 · 원장에서 수정
                      </a>
                    ) : (
                      <>
                        <button onClick={() => markArrived(p)} disabled={busy === p.id} className="text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1.5 rounded-lg flex items-center gap-1 disabled:opacity-50">
                          {busy === p.id ? <Loader2 size={12} className="animate-spin" /> : <PackageCheck size={12} />} 입고완료
                        </button>
                        <button onClick={() => { setEditing(p); setShowForm(true); }} className="text-zinc-400 hover:text-violet-500 p-1.5" aria-label="수정"><Pencil size={14} /></button>
                        <button onClick={() => remove(p)} disabled={busy === p.id} className="text-zinc-400 hover:text-red-500 p-1.5" aria-label="삭제"><X size={15} /></button>
                      </>
                    )}
                  </div>
                </div>

                {/* 마일스톤 타임라인 */}
                <div className="mt-3 flex flex-wrap gap-2">
                  {sorted.map((m, i) => {
                    const realIdx = p.milestones.indexOf(m);
                    const b = milestoneBadge(m);
                    return (
                      <button
                        key={i}
                        onClick={() => { if (!p.derived) toggleMilestone(p, realIdx); }}
                        disabled={busy === p.id || p.derived}
                        title={p.derived ? "파쇼 연동 항목 — 단계 변경은 파쇼 원장에서" : (m.done ? "완료 취소" : "완료로 표시")}
                        className={`group flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition disabled:opacity-50 ${
                          m.done
                            ? "border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/30"
                            : "border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/40 hover:border-violet-300"
                        }`}
                      >
                        <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full border ${m.done ? "border-emerald-500 bg-emerald-500 text-white" : "border-zinc-300 dark:border-zinc-600 text-transparent group-hover:text-zinc-300"}`}>
                          <Check size={10} />
                        </span>
                        <span className={`font-semibold ${m.done ? "text-emerald-700 dark:text-emerald-300 line-through" : "text-zinc-700 dark:text-zinc-200"}`}>{m.label}</span>
                        <span className="inline-flex items-center gap-1 text-zinc-400"><CalendarClock size={11} /> {m.date}</span>
                        {m.note && <span className="text-zinc-400">· {m.note}</span>}
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${TONE[b.tone]}`}>{b.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 입고완료 / 취소 */}
      {done.length > 0 && (
        <>
          <h2 className="text-sm font-bold text-zinc-700 dark:text-zinc-300 mt-8 mb-2 flex items-center gap-1.5"><PackageCheck size={15} /> 입고 완료 · 취소 ({done.length})</h2>
          <div className="space-y-1.5">
            {done.map((p) => (
              <div key={p.id} className="flex items-center gap-2 bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-100 dark:border-zinc-800 rounded-lg px-3 py-2 text-xs flex-wrap">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${p.status === "arrived" ? TONE.emerald : TONE.zinc}`}>{p.status === "arrived" ? "입고완료" : "취소"}</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500">{p.brand}</span>
                <span className="font-medium text-zinc-700 dark:text-zinc-200">{p.name}</span>
                <div className="flex-1" />
                {p.derived ? (
                  <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400" title="파쇼 발주 파생 — 파쇼 원장에서 관리">파쇼 연동</span>
                ) : (
                  <>
                    <button onClick={() => patch(p.id, { status: "tracking" })} className="text-zinc-400 hover:text-violet-500 p-1" title="다시 추적"><RefreshCw size={12} /></button>
                    <button onClick={() => remove(p)} className="text-zinc-300 hover:text-red-500 p-1" aria-label="삭제"><Trash2 size={12} /></button>
                  </>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ProductForm({
  initial, onDone, onCancel,
}: {
  initial: UpcomingProduct | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [brand, setBrand] = useState(initial?.brand ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [milestones, setMilestones] = useState<Milestone[]>(
    initial?.milestones?.length
      ? initial.milestones.map((m) => ({ ...m }))
      : [{ label: "샘플 출고", date: "", note: "" }, { label: "제품 입고", date: "", note: "" }],
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const setM = (i: number, p: Partial<Milestone>) =>
    setMilestones((prev) => prev.map((m, idx) => (idx === i ? { ...m, ...p } : m)));
  const addM = () => setMilestones((prev) => [...prev, { label: "", date: "", note: "" }]);
  const rmM = (i: number) => setMilestones((prev) => prev.filter((_, idx) => idx !== i));

  const submit = async () => {
    if (!brand.trim() || !name.trim()) { setErr("브랜드·상품명은 필수예요."); return; }
    const valid = milestones.filter((m) => m.label.trim() && m.date);
    setSaving(true); setErr(null);
    try {
      const body = { brand, name, category: category || null, notes: notes || null, milestones: valid };
      const res = await fetch(
        initial ? `/api/upcoming-products/${initial.id}` : "/api/upcoming-products",
        { method: initial ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      );
      const j = await res.json();
      if (!j.ok) throw new Error(j.error ?? "저장 실패");
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  };

  return (
    <div className="bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800 rounded-xl p-4 mb-5 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <label className="text-xs text-zinc-500 flex flex-col gap-1">브랜드
          <input list="upcoming-brands" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="해리엇"
            className="text-sm px-2 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700" />
          <datalist id="upcoming-brands">{BRANDS.map((b) => <option key={b} value={b} />)}</datalist>
        </label>
        <label className="text-xs text-zinc-500 flex flex-col gap-1">상품명
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="설월 시계"
            className="text-sm px-2 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700" />
        </label>
        <label className="text-xs text-zinc-500 flex flex-col gap-1">카테고리 (선택)
          <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="시계"
            className="text-sm px-2 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700" />
        </label>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">마일스톤 (샘플·입고 등)</span>
          <button onClick={addM} className="text-xs text-violet-600 dark:text-violet-400 hover:underline">+ 마일스톤 추가</button>
        </div>
        {milestones.map((m, i) => (
          <div key={i} className="flex items-center gap-2 bg-white dark:bg-zinc-900 rounded-lg px-2 py-1.5 flex-wrap">
            <input value={m.label} onChange={(e) => setM(i, { label: e.target.value })} placeholder="단계 (예: 제품 입고)"
              className="flex-1 min-w-[110px] text-sm px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 bg-transparent" />
            <input type="date" value={m.date} onChange={(e) => setM(i, { date: e.target.value })}
              className="text-sm px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 bg-transparent" />
            <input value={m.note ?? ""} onChange={(e) => setM(i, { note: e.target.value })} placeholder="메모 (예: 7월말 목표)"
              className="flex-1 min-w-[110px] text-sm px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 bg-transparent" />
            <button onClick={() => rmM(i)} className="text-zinc-300 hover:text-red-500 p-1"><X size={13} /></button>
          </div>
        ))}
      </div>

      <label className="text-xs text-zinc-500 flex flex-col gap-1">메모 (선택)
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="비고"
          className="text-sm px-2 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700" />
      </label>

      {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}

      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="text-sm text-zinc-500 hover:text-zinc-700 px-3 py-1.5">취소</button>
        <button onClick={submit} disabled={saving} className="text-sm font-semibold bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white px-4 py-1.5 rounded-lg flex items-center gap-1.5">
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} {initial ? "수정 저장" : "추가"}
        </button>
      </div>
    </div>
  );
}
