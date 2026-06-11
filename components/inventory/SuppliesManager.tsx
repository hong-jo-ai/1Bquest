"use client";

import { useEffect, useMemo, useState } from "react";
import { Package, Mail, BatteryMedium, ExternalLink, Plus, Minus, AlertTriangle, Settings2, Check } from "lucide-react";
import { loadSupplies, saveSupplies, type SupplyItem, type SupplyType } from "@/lib/suppliesStorage";

const TYPE_LABEL: Record<SupplyType, string> = { box: "택배박스", bag: "완충봉투", battery: "배터리" };
const TYPE_ICON: Record<SupplyType, typeof Package> = { box: Package, bag: Mail, battery: BatteryMedium };
const TYPE_ORDER: SupplyType[] = ["box", "bag", "battery"];

function modelText(it: SupplyItem): string {
  if (it.type !== "battery") return it.notes ?? "";
  if (!it.models || it.models.length === 0) return it.notes ?? "";
  return it.models.map((m) => `${m.brand} ${m.model}`).join(" · ");
}

export default function SuppliesManager() {
  const [items, setItems] = useState<SupplyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadSupplies().then((s) => { setItems(s); setLoading(false); });
  }, []);

  function persist(next: SupplyItem[]) {
    setItems(next);
    saveSupplies(next);
    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
  }
  function update(id: string, patch: Partial<SupplyItem>) {
    persist(items.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }
  function adjust(id: string, delta: number) {
    const it = items.find((x) => x.id === id);
    if (!it) return;
    update(id, { currentStock: Math.max(0, it.currentStock + delta) });
  }

  const lowItems = useMemo(() => items.filter((it) => it.currentStock <= it.reorderThreshold), [items]);

  if (loading) {
    return <div className="max-w-7xl mx-auto px-6 py-10 text-sm text-zinc-400">부자재 재고 불러오는 중…</div>;
  }

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-xl font-bold text-zinc-800 dark:text-zinc-100">부자재 재고</h2>
          <p className="text-xs text-zinc-400 mt-0.5">택배박스 · 완충봉투 · 시계 배터리 (출고 연동 자동 차감)</p>
        </div>
        <div className="flex items-center gap-3">
          {saved && (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
              <Check size={13} /> 저장됨
            </span>
          )}
          <div className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${lowItems.length ? "bg-red-50 text-red-600 dark:bg-red-950/40" : "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40"}`}>
            <AlertTriangle size={13} />
            발주 필요 {lowItems.length}
          </div>
        </div>
      </div>

      {TYPE_ORDER.map((type) => {
        const group = items.filter((it) => it.type === type);
        if (!group.length) return null;
        const Icon = TYPE_ICON[type];
        return (
          <div key={type} className="mb-6">
            <div className="flex items-center gap-2 mb-2 text-sm font-semibold text-zinc-500 dark:text-zinc-400">
              <Icon size={15} />
              {TYPE_LABEL[type]}
              <span className="text-zinc-300">·</span>
              <span className="text-zinc-400 font-normal">{group.length}종</span>
            </div>
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {group.map((it) => {
                const low = it.currentStock <= it.reorderThreshold;
                const editing = editId === it.id;
                return (
                  <div
                    key={it.id}
                    className={`rounded-2xl border p-4 bg-white dark:bg-zinc-900 ${low ? "border-red-200 dark:border-red-900/60" : "border-zinc-100 dark:border-zinc-800"}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-zinc-800 dark:text-zinc-100 truncate">{it.name}</span>
                          {it.autoDeduct === false && (
                            <span className="shrink-0 text-[10px] rounded px-1 py-0.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-400">수동</span>
                          )}
                        </div>
                        {modelText(it) && (
                          <p className="text-[11px] text-zinc-400 mt-0.5 line-clamp-2">{modelText(it)}</p>
                        )}
                      </div>
                      <button
                        onClick={() => setEditId(editing ? null : it.id)}
                        className="shrink-0 text-zinc-300 hover:text-zinc-500"
                        title="임계치·주문링크 설정"
                      >
                        <Settings2 size={15} />
                      </button>
                    </div>

                    {/* 수량 조절 */}
                    <div className="flex items-center justify-between mt-3">
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => adjust(it.id, -1)} className="w-7 h-7 grid place-items-center rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800">
                          <Minus size={14} />
                        </button>
                        <input
                          type="number"
                          value={it.currentStock}
                          onChange={(e) => update(it.id, { currentStock: Math.max(0, Number(e.target.value) || 0) })}
                          className={`w-16 text-center text-lg font-bold bg-transparent outline-none ${low ? "text-red-600" : "text-zinc-800 dark:text-zinc-100"}`}
                        />
                        <button onClick={() => adjust(it.id, 1)} className="w-7 h-7 grid place-items-center rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800">
                          <Plus size={14} />
                        </button>
                        <span className="text-xs text-zinc-400 ml-0.5">{it.unit ?? "개"}</span>
                      </div>
                      {low ? (
                        it.orderUrl ? (
                          <a href={it.orderUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 hover:text-red-700">
                            발주 <ExternalLink size={12} />
                          </a>
                        ) : (
                          <span className="text-xs font-semibold text-red-500">발주 필요</span>
                        )
                      ) : (
                        <span className="text-[11px] text-zinc-400">임계 {it.reorderThreshold}</span>
                      )}
                    </div>

                    {/* 설정(임계치·주문링크) */}
                    {editing && (
                      <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-800 space-y-2">
                        <label className="flex items-center justify-between gap-2 text-xs text-zinc-500">
                          재주문 임계치
                          <input
                            type="number"
                            value={it.reorderThreshold}
                            onChange={(e) => update(it.id, { reorderThreshold: Math.max(0, Number(e.target.value) || 0) })}
                            className="w-20 text-right rounded-md border border-zinc-200 dark:border-zinc-700 bg-transparent px-2 py-1"
                          />
                        </label>
                        <label className="block text-xs text-zinc-500">
                          주문 링크
                          <input
                            type="url"
                            value={it.orderUrl ?? ""}
                            placeholder="https://…"
                            onChange={(e) => update(it.id, { orderUrl: e.target.value })}
                            className="mt-1 w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-transparent px-2 py-1"
                          />
                        </label>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
