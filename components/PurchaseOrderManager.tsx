"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Package, Plus, RefreshCw, Loader2, Truck, AlertTriangle, Check, X, CalendarClock,
} from "lucide-react";

interface PurchaseOrder {
  id: string;
  sku: string;
  productName: string;
  supplier: string;
  orderDate: string;
  qty: number;
  unitPrice?: number | null;
  amount?: number | null;
  leadMinDays: number;
  leadMaxDays: number;
  status: "ordered" | "received" | "cancelled";
  receivedDate?: string | null;
  receivedQty?: number | null;
  stockApplied?: boolean;
  notes?: string | null;
}

function todayKst(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
function addDays(date: string, n: number): string {
  return new Date(new Date(date + "T00:00:00Z").getTime() + n * 86400000).toISOString().slice(0, 10);
}
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}
function krw(n: number | null | undefined): string {
  return n == null ? "—" : n.toLocaleString("ko-KR") + "원";
}

function etaInfo(po: PurchaseOrder) {
  const start = addDays(po.orderDate, po.leadMinDays);
  const end = addDays(po.orderDate, po.leadMaxDays);
  const today = todayKst();
  let label: string, tone: "violet" | "amber" | "red" | "emerald" | "zinc";
  if (today < start) {
    label = `D-${daysBetween(today, start)} 입고예정`;
    tone = "violet";
  } else if (today <= end) {
    label = "입고 기간 중";
    tone = "amber";
  } else {
    label = `${daysBetween(end, today)}일 지연`;
    tone = "red";
  }
  return { start, end, label, tone };
}

const TONE: Record<string, string> = {
  violet: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  red: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  zinc: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

export default function PurchaseOrderManager() {
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [stockBySku, setStockBySku] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3500); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/purchase-orders", { cache: "no-store" });
      const j = await res.json();
      if (j.ok) { setOrders(j.orders ?? []); setStockBySku(j.stockBySku ?? {}); }
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const receive = async (po: PurchaseOrder) => {
    if (!confirm(`'${po.productName}' ${po.qty}개 입고 처리할까요?\n카페24 + 대시보드 재고에 +${po.qty} 반영됩니다.`)) return;
    setBusy(po.id);
    try {
      const res = await fetch(`/api/purchase-orders/${po.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "receive", receivedQty: po.qty, applyStock: true }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error ?? "처리 실패");
      showToast(j.stock?.ok ? `입고 완료 — 재고 +${po.qty} (카페24 ${j.stock.newQty}개)` : `입고 기록 완료${j.stock?.error ? ` (재고반영 실패: ${j.stock.error})` : ""}`);
      await load();
    } catch (e) { showToast(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  const remove = async (po: PurchaseOrder) => {
    if (!confirm(`'${po.productName}' 발주를 삭제할까요?`)) return;
    setBusy(po.id);
    try {
      await fetch(`/api/purchase-orders/${po.id}`, { method: "DELETE" });
      await load();
    } finally { setBusy(null); }
  };

  const open = orders.filter((o) => o.status === "ordered").sort((a, b) => etaInfo(a).end.localeCompare(etaInfo(b).end));
  const closed = orders.filter((o) => o.status !== "ordered").sort((a, b) => (b.receivedDate ?? "").localeCompare(a.receivedDate ?? ""));
  const overdue = open.filter((o) => etaInfo(o).tone === "red").length;

  return (
    <div className="max-w-[1100px] mx-auto px-4 sm:px-6 py-6">
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-zinc-900 text-white text-sm px-4 py-2.5 rounded-full shadow-lg">{toast}</div>
      )}

      <div className="flex items-center justify-between gap-3 flex-wrap mb-5">
        <div>
          <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">발주 · 재입고 관리</h1>
          <p className="text-xs text-zinc-500 mt-0.5">생산발주 기록 · 재입고 예상일(발주일 +2~3주) · 입고 시 재고 자동 반영</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} disabled={loading} className="text-sm font-medium bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 text-zinc-700 dark:text-zinc-200 px-3 py-1.5 rounded-full flex items-center gap-1.5 disabled:opacity-50">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> 새로고침
          </button>
          <button onClick={() => setShowForm((v) => !v)} className="text-sm font-semibold bg-violet-600 hover:bg-violet-700 text-white px-3 py-1.5 rounded-full flex items-center gap-1.5">
            <Plus size={14} /> 발주 추가
          </button>
        </div>
      </div>

      {overdue > 0 && (
        <div className="mb-4 flex items-center gap-2 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-xl px-4 py-2.5 text-sm">
          <AlertTriangle size={15} /> 재입고 예정일이 지난 발주 {overdue}건 — 공급사에 확인이 필요해요.
        </div>
      )}

      {showForm && <AddForm onAdded={() => { setShowForm(false); load(); showToast("발주 추가됨"); }} />}

      {/* 진행 중 발주 */}
      <h2 className="text-sm font-bold text-zinc-700 dark:text-zinc-300 mb-2 flex items-center gap-1.5">
        <Truck size={15} /> 입고 대기 ({open.length})
      </h2>
      {loading && orders.length === 0 ? (
        <div className="flex items-center justify-center py-12 text-zinc-400 gap-2"><Loader2 size={16} className="animate-spin" /> 불러오는 중…</div>
      ) : open.length === 0 ? (
        <p className="text-sm text-zinc-400 py-6">입고 대기 중인 발주가 없습니다.</p>
      ) : (
        <div className="space-y-2 mb-8">
          {open.map((po) => {
            const eta = etaInfo(po);
            const stock = po.sku ? stockBySku[po.sku] : undefined;
            return (
              <div key={po.id} className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-zinc-900 dark:text-zinc-100">{po.productName}</span>
                      {po.sku && <span className="text-[10px] font-mono text-zinc-400">{po.sku}</span>}
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${TONE[eta.tone]}`}>{eta.label}</span>
                    </div>
                    <div className="text-xs text-zinc-500 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                      <span>발주 {po.orderDate}{po.supplier ? ` · ${po.supplier}` : ""}</span>
                      <span>수량 <b className="text-zinc-700 dark:text-zinc-200">{po.qty}개</b></span>
                      {po.amount != null && <span>{krw(po.amount)}</span>}
                      <span className="inline-flex items-center gap-1"><CalendarClock size={11} /> 재입고 {eta.start} ~ {eta.end}</span>
                      {stock != null && <span>현재고 <b className={stock <= 0 ? "text-red-500" : "text-zinc-700 dark:text-zinc-200"}>{stock}개</b></span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button onClick={() => receive(po)} disabled={busy === po.id} className="text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1.5 rounded-lg flex items-center gap-1 disabled:opacity-50">
                      {busy === po.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} 입고완료
                    </button>
                    <button onClick={() => remove(po)} disabled={busy === po.id} className="text-zinc-400 hover:text-red-500 p-1.5" aria-label="삭제"><X size={15} /></button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 입고 완료 / 취소 */}
      {closed.length > 0 && (
        <>
          <h2 className="text-sm font-bold text-zinc-700 dark:text-zinc-300 mb-2 flex items-center gap-1.5"><Package size={15} /> 입고 완료 · 취소 ({closed.length})</h2>
          <div className="space-y-1.5">
            {closed.map((po) => (
              <div key={po.id} className="flex items-center gap-2 bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-100 dark:border-zinc-800 rounded-lg px-3 py-2 text-xs flex-wrap">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${po.status === "received" ? TONE.emerald : TONE.zinc}`}>{po.status === "received" ? "입고완료" : "취소"}</span>
                <span className="font-medium text-zinc-700 dark:text-zinc-200">{po.productName}</span>
                <span className="text-zinc-400">{po.qty}개</span>
                {po.receivedDate && <span className="text-zinc-400">· {po.receivedDate} 입고{po.stockApplied ? " (재고반영됨)" : ""}</span>}
                <div className="flex-1" />
                <button onClick={() => remove(po)} className="text-zinc-300 hover:text-red-500 p-1" aria-label="삭제"><X size={13} /></button>
              </div>
            ))}
          </div>
        </>
      )}

      <p className="text-[11px] text-zinc-400 mt-6 leading-relaxed">
        · 재입고 예상일 = 발주일 + 리드타임(기본 2~3주). · 입고완료 누르면 카페24 변형 재고 + 대시보드 재고에 발주 수량이 가산돼요.
        · 현재고는 카페24 실재고 기준.
      </p>
    </div>
  );
}

function AddForm({ onAdded }: { onAdded: () => void }) {
  const [f, setF] = useState({ productName: "", sku: "", supplier: "나비스트", orderDate: todayKst(), qty: "", unitPrice: "", leadMinDays: "14", leadMaxDays: "21" });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  const submit = async () => {
    if (!f.productName.trim() || !f.orderDate || !f.qty) return;
    setSaving(true);
    try {
      const qty = parseInt(f.qty, 10) || 0;
      const unitPrice = f.unitPrice ? parseInt(f.unitPrice, 10) : null;
      const res = await fetch("/api/purchase-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productName: f.productName, sku: f.sku, supplier: f.supplier, orderDate: f.orderDate,
          qty, unitPrice, amount: unitPrice ? unitPrice * qty : null,
          leadMinDays: parseInt(f.leadMinDays, 10) || 14, leadMaxDays: parseInt(f.leadMaxDays, 10) || 21,
        }),
      });
      const j = await res.json();
      if (j.ok) onAdded();
    } finally { setSaving(false); }
  };

  const I = (k: string, ph: string, type = "text", w = "") => (
    <input value={(f as Record<string, string>)[k]} onChange={(e) => set(k, e.target.value)} placeholder={ph} type={type}
      className={`text-sm px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 ${w}`} />
  );

  return (
    <div className="bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800 rounded-xl p-4 mb-5 space-y-2">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {I("productName", "상품명 *", "text", "col-span-2")}
        {I("sku", "SKU (카페24 코드)")}
        {I("supplier", "공급사")}
        {I("orderDate", "발주일", "date")}
        {I("qty", "수량 *", "number")}
        {I("unitPrice", "단가(원)", "number")}
        <div className="flex items-center gap-1">
          {I("leadMinDays", "최소(일)", "number", "w-full")}
          <span className="text-zinc-400 text-xs">~</span>
          {I("leadMaxDays", "최대(일)", "number", "w-full")}
        </div>
      </div>
      <div className="flex justify-end">
        <button onClick={submit} disabled={saving || !f.productName.trim() || !f.qty} className="text-sm font-semibold bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white px-4 py-1.5 rounded-lg flex items-center gap-1.5">
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} 발주 등록
        </button>
      </div>
    </div>
  );
}
