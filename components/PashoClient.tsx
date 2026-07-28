"use client";

import React, { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Package, FileText, AlertTriangle, ArrowUpRight, X, Circle,
  CheckCircle2, Clock, Truck, Paperclip, Printer, Wallet
} from "lucide-react";

// ─────────────────────────────────────────────────────────────
// 파쇼 생산 원장 (대시보드 버전)
// 대표가 통제하는 두 축: 단가 · 자금집행 / + 사급자산 추적
// 단가는 2026-07-04 조성섭 견적 파싱분 반영 (downloads/pasho-archive)
// ─────────────────────────────────────────────────────────────

const BRAND: Record<string, { name: string; accent: string; soft: string }> = {
  PV: { name: "폴바이스", accent: "#A6812F", soft: "#F4EEDD" },
  HR: { name: "해리엇", accent: "#2E5E5B", soft: "#E2ECEB" },
  KW: { name: "기원", accent: "#3E7C6A", soft: "#E1EEE9" },
};

const TYPE: Record<string, { label: string; color: string }> = {
  신규양산: { label: "신규양산", color: "#3A6EA5" },
  리오더:   { label: "리오더",   color: "#4E7C9E" },
  개발:     { label: "개발",     color: "#6B5CA5" },
  리메이크: { label: "리메이크", color: "#A0562B" },
  후가공:   { label: "후가공",   color: "#8A6D1F" },
};

const STAGES = ["디자인", "샘플", "컨펌", "생산중", "검품", "납품", "입고", "정산"];

const STATUS_META: Record<string, { color: string; icon: React.ElementType }> = {
  디자인:  { color: "#6B5CA5", icon: Circle },
  샘플:    { color: "#6B5CA5", icon: Circle },
  컨펌:    { color: "#3A6EA5", icon: Clock },
  생산중:  { color: "#3A6EA5", icon: Clock },
  검품:    { color: "#3A6EA5", icon: Clock },
  납품:    { color: "#3F7A57", icon: Truck },
  입고:    { color: "#3F7A57", icon: CheckCircle2 },
  정산:    { color: "#3F7A57", icon: CheckCircle2 },
};

interface Line { variant: string; qty: number; received?: number; remaining?: number }
interface Receipt { id: string; orderNo: string; at: string; items: { variant: string; qty: number }[]; note?: string }
interface Order {
  no: string; brand: string; model: string; code: string; type: string;
  status: string; consign: boolean; consignDate?: string; deposit: number | null;
  date: string; lines: Line[]; note: string; riskFlag?: string;
  unit?: string | null;      // 확정 단가 (USD, 표시용)
  quoteTotal?: number | null; // 견적 총액 USD
  depositAmt?: number | null; // 집행된 선수금 USD
  quoteRef?: string | null;   // 근거 견적
  orderedQty?: number; receivedQty?: number; remainingQty?: number; // 입고 집계
  receipts?: Receipt[];
}

const usd = (n: number | null | undefined) => (n == null ? "—" : "$" + n.toLocaleString("en-US"));

function TypeBadge({ type }: { type: string }) {
  const t = TYPE[type];
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold tracking-tight border"
      style={{ color: t.color, borderColor: t.color + "55", background: t.color + "10" }}
    >
      {t.label}
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  const m = STATUS_META[status] || STATUS_META["컨펌"];
  const Icon = m.icon;
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] font-medium" style={{ color: m.color }}>
      <Icon size={14} strokeWidth={2.4} />
      {status}
    </span>
  );
}

function StageTrack({ status }: { status: string }) {
  const idx = STAGES.indexOf(status);
  return (
    <div className="flex items-center gap-1 mt-0.5">
      {STAGES.map((s, i) => (
        <div
          key={s}
          title={s}
          className="h-1 rounded-full transition-all"
          style={{
            width: i <= idx ? 14 : 10,
            background: i < idx ? "#B8B4AC" : i === idx ? (STATUS_META[status]?.color || "#3A6EA5") : "#E5E2DC",
          }}
        />
      ))}
    </div>
  );
}

export default function PashoClient({ orders }: { orders: Order[] }) {
  const ORDERS = orders;
  const router = useRouter();
  const [brandF, setBrandF] = useState("ALL");
  const [typeF, setTypeF] = useState("ALL");
  const [sel, setSel] = useState<string | null>(null);
  const [stageSaving, setStageSaving] = useState(false);

  /** 진행 단계 변경 — 저장 후 서버 데이터 새로고침(신제품 로드맵 파생도 함께 갱신). */
  const changeStage = async (o: Order, status: string) => {
    if (o.status === status || stageSaving) return;
    if (!confirm(`'${o.model}' 단계를 [${o.status}] → [${status}] 로 변경할까요?`)) return;
    setStageSaving(true);
    try {
      const res = await fetch(`/api/pasho/orders/${encodeURIComponent(o.no)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error ?? "변경 실패");
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setStageSaving(false);
    }
  };

  const filtered = useMemo(
    () =>
      ORDERS.filter(
        (o) =>
          (brandF === "ALL" || o.brand === brandF) &&
          (typeF === "ALL" || o.type === typeF)
      ),
    [brandF, typeF]
  );

  const kpi = useMemo(() => {
    const active = ORDERS.filter((o) => !["입고", "정산"].includes(o.status)).length;
    const consign = ORDERS.filter((o) => o.consign).length;
    const consignQty = ORDERS.filter((o) => o.consign)
      .reduce((s, o) => s + o.lines.reduce((a, l) => a + l.qty, 0), 0);
    const risk = ORDERS.filter((o) => o.riskFlag).length;
    return { active, consign, consignQty, risk };
  }, []);

  const selOrder = ORDERS.find((o) => o.no === sel);

  const openForm = (o: Order) => {
    const doc = o.type === "개발" ? "dev" : o.consign ? "csg" : "po";
    window.open(`/pasho-forms.html?no=${o.no}&doc=${doc}`, "_blank");
  };

  return (
    <div
      className="min-h-screen w-full"
      style={{ background: "#F7F6F3", color: "#1C1B1A", fontFamily: "'Pretendard', -apple-system, BlinkMacSystemFont, sans-serif" }}
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* header */}
        <div className="flex items-end justify-between border-b border-[#E5E2DC] pb-5 mb-6">
          <div>
            <div className="text-[11px] font-semibold tracking-[0.22em] text-[#9A968E] uppercase mb-1">
              해리엇와치스 · 파쇼 생산 원장
            </div>
            <h1 className="text-[26px] font-bold tracking-tight leading-none">발주 · 사급 · 납품 트래킹</h1>
          </div>
          <div className="text-right text-[12px] text-[#6B6863] leading-relaxed">
            <div>단가·자금집행 단독 통제</div>
            <div className="text-[#9A968E]">6건 · 단가 반영본</div>
          </div>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[
            { label: "진행중 발주", val: String(kpi.active), unit: "건", icon: Package, c: "#1C1B1A" },
            { label: "사급 미회수", val: String(kpi.consign), unit: "건", icon: Truck, c: "#C2711F" },
            { label: "사급 반출 수량", val: kpi.consignQty.toLocaleString("ko-KR"), unit: "ea", icon: ArrowUpRight, c: "#C2711F" },
            { label: "리스크 플래그", val: String(kpi.risk), unit: "건", icon: AlertTriangle, c: "#B4472E" },
          ].map((k) => (
            <div key={k.label} className="bg-white border border-[#E5E2DC] rounded-xl px-4 py-3.5">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#6B6863] mb-1.5">
                <k.icon size={13} style={{ color: k.c }} />
                {k.label}
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-[24px] font-bold tabular-nums leading-none" style={{ color: k.c }}>{k.val}</span>
                <span className="text-[12px] text-[#9A968E]">{k.unit}</span>
              </div>
            </div>
          ))}
        </div>

        {/* filters */}
        <div className="flex items-center gap-6 mb-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            {[["ALL", "전체"], ["PV", "폴바이스"], ["HR", "해리엇"], ["KW", "기원"]].map(([k, v]) => (
              <button
                key={k}
                onClick={() => setBrandF(k)}
                className="px-3 py-1.5 rounded-lg text-[13px] font-medium transition-all"
                style={
                  brandF === k
                    ? { background: k === "ALL" ? "#1C1B1A" : BRAND[k].accent, color: "#fff" }
                    : { background: "#fff", color: "#6B6863", border: "1px solid #E5E2DC" }
                }
              >
                {v}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {["ALL", ...Object.keys(TYPE)].map((k) => (
              <button
                key={k}
                onClick={() => setTypeF(k)}
                className="px-2.5 py-1 rounded-md text-[12px] font-medium transition-all"
                style={
                  typeF === k
                    ? { background: "#EAE7E0", color: "#1C1B1A" }
                    : { background: "transparent", color: "#9A968E" }
                }
              >
                {k === "ALL" ? "모든 유형" : TYPE[k].label}
              </button>
            ))}
          </div>
        </div>

        {/* table */}
        <div className="bg-white border border-[#E5E2DC] rounded-xl overflow-hidden">
          <div className="max-sm:hidden sm:grid grid-cols-[100px_1fr_84px_96px_92px_130px] gap-3 px-4 py-2.5 border-b border-[#E5E2DC] text-[11px] font-semibold text-[#9A968E] uppercase tracking-wider">
            <div>발주번호</div>
            <div>모델</div>
            <div>유형</div>
            <div>수량</div>
            <div>단가/선급</div>
            <div>상태</div>
          </div>
          {filtered.map((o) => {
            const b = BRAND[o.brand];
            const totQty = o.lines.reduce((a, l) => a + l.qty, 0);
            const rcv = o.receivedQty ?? 0;
            const rem = o.remainingQty ?? 0;
            return (
              <button
                key={o.no}
                onClick={() => setSel(o.no)}
                className="w-full text-left border-b border-[#F0EEE9] hover:bg-[#FAF9F6] transition-colors px-4 py-3.5 sm:grid sm:grid-cols-[100px_1fr_84px_96px_92px_130px] sm:gap-3 sm:items-center"
              >
                {/* ── 모바일 카드 ── */}
                <div className="sm:hidden flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-[12px] font-semibold tabular-nums">{o.no}</span>
                      <TypeBadge type={o.type} />
                      {o.consign && <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ color: "#C2711F", background: "#FBF0E2" }}><ArrowUpRight size={10} />사급</span>}
                      {o.riskFlag && <AlertTriangle size={13} style={{ color: "#B4472E" }} />}
                    </div>
                    <StatusPill status={o.status} />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: b.accent }} />
                    <span className="font-semibold text-[15px] truncate">{o.model}</span>
                    <span className="font-mono text-[11px] text-[#9A968E]">{o.code}</span>
                  </div>
                  <div className="flex items-center justify-between text-[12.5px] pl-3.5">
                    <span className="tabular-nums">
                      <b>{totQty.toLocaleString("ko-KR")}</b> ea
                      {rcv > 0 && <span style={{ color: rem > 0 ? "#C2711F" : "#3F7A57" }}> · 입고 {rcv.toLocaleString("ko-KR")}{rem > 0 ? ` / 잔량 ${rem.toLocaleString("ko-KR")}` : " 완료"}</span>}
                    </span>
                    <span className="tabular-nums font-semibold" style={{ color: o.unit ? "#1C1B1A" : "#C9C5BD" }}>
                      {o.unit || "견적전"}{o.deposit != null && <span style={{ color: "#3F7A57" }}> · 선급 {o.deposit}%</span>}
                    </span>
                  </div>
                </div>

                {/* ── 데스크탑 그리드 ── */}
                <div className="max-sm:hidden sm:block font-mono text-[13px] font-semibold tracking-tight tabular-nums">{o.no}</div>
                <div className="max-sm:hidden sm:block min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: b.accent }} />
                    <span className="font-semibold text-[14px] truncate">{o.model}</span>
                    {o.consign && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ color: "#C2711F", background: "#FBF0E2" }}>
                        <ArrowUpRight size={10} /> 사급
                      </span>
                    )}
                    {o.riskFlag && <AlertTriangle size={13} style={{ color: "#B4472E" }} />}
                  </div>
                  <div className="font-mono text-[11px] text-[#9A968E] mt-0.5 ml-3.5">{o.code}</div>
                </div>
                <div className="max-sm:hidden sm:block"><TypeBadge type={o.type} /></div>
                <div className="max-sm:hidden sm:block">
                  <span className="tabular-nums font-semibold text-[14px]">{totQty.toLocaleString("ko-KR")}</span>
                  <span className="text-[11px] text-[#9A968E] ml-1">ea</span>
                  {rcv > 0 && (
                    <div className="text-[11px] mt-0.5 tabular-nums" style={{ color: rem > 0 ? "#C2711F" : "#3F7A57" }}>
                      입고 {rcv.toLocaleString("ko-KR")}{rem > 0 ? ` · 잔량 ${rem.toLocaleString("ko-KR")}` : " · 완료"}
                    </div>
                  )}
                </div>
                <div className="max-sm:hidden sm:block min-w-0">
                  <div className="text-[12.5px] font-semibold tabular-nums truncate" style={{ color: o.unit ? "#1C1B1A" : "#C9C5BD" }}>
                    {o.unit || "견적전"}
                  </div>
                  {o.deposit != null && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold" style={{ color: "#3F7A57" }}>
                      <Wallet size={11} /> 선급 {o.deposit}%
                    </span>
                  )}
                </div>
                <div className="max-sm:hidden sm:block">
                  <StatusPill status={o.status} />
                  <StageTrack status={o.status} />
                </div>
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div className="px-4 py-10 text-center text-[13px] text-[#9A968E]">해당 조건의 발주가 없습니다.</div>
          )}
        </div>

        <p className="text-[11px] text-[#9A968E] mt-3 leading-relaxed">
          행을 누르면 라인아이템·단가·증빙·양식 인쇄가 열립니다. 단가는 파쇼 확정 견적(2026-07-04) 반영분이며, 미수령 건은 &ldquo;견적전&rdquo;.
        </p>
      </div>

      {/* detail drawer */}
      {selOrder && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setSel(null)}>
          <div className="absolute inset-0 bg-black/25" />
          <div
            className="relative w-full max-w-md h-full bg-[#FCFBF9] border-l border-[#E5E2DC] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-[#FCFBF9] border-b border-[#E5E2DC] px-5 sm:px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[15px] font-bold tabular-nums">{selOrder.no}</span>
                <TypeBadge type={selOrder.type} />
              </div>
              <button onClick={() => setSel(null)} className="p-1 rounded-md hover:bg-[#EEEBE4]">
                <X size={18} className="text-[#6B6863]" />
              </button>
            </div>

            <div className="px-6 py-5">
              <div className="flex items-center gap-2 mb-1">
                <span className="w-2 h-2 rounded-full" style={{ background: BRAND[selOrder.brand].accent }} />
                <span className="text-[12px] font-semibold" style={{ color: BRAND[selOrder.brand].accent }}>
                  {BRAND[selOrder.brand].name}
                </span>
              </div>
              <h2 className="text-[20px] font-bold tracking-tight">{selOrder.model}</h2>
              <div className="font-mono text-[12px] text-[#9A968E] mt-0.5">{selOrder.code} · 등록 {selOrder.date}</div>

              {selOrder.riskFlag && (
                <div className="mt-4 flex items-start gap-2 px-3 py-2.5 rounded-lg" style={{ background: "#FBEEEA", border: "1px solid #E9C4B9" }}>
                  <AlertTriangle size={15} style={{ color: "#B4472E" }} className="mt-0.5 shrink-0" />
                  <span className="text-[12.5px] leading-snug" style={{ color: "#8A3320" }}>{selOrder.riskFlag}</span>
                </div>
              )}

              {selOrder.consign && (
                <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: "#FBF0E2", border: "1px solid #EAD4B4" }}>
                  <ArrowUpRight size={15} style={{ color: "#C2711F" }} />
                  <span className="text-[12.5px] font-medium" style={{ color: "#8A5A16" }}>
                    사급 반출 — {selOrder.consignDate}. 사급출고증으로 수량 확정 필요.
                  </span>
                </div>
              )}

              {/* lines */}
              <div className="mt-5">
                <div className="text-[11px] font-semibold text-[#9A968E] uppercase tracking-wider mb-2">라인 아이템</div>
                <div className="bg-white border border-[#E5E2DC] rounded-lg overflow-hidden">
                  {selOrder.lines.map((l, i) => {
                    const rcv = l.received ?? 0;
                    const rem = l.remaining ?? l.qty;
                    return (
                      <div key={i} className="flex items-center justify-between px-3.5 py-2.5 border-b border-[#F0EEE9] last:border-0">
                        <span className="text-[13px]">{l.variant}</span>
                        <span className="text-[13px] tabular-nums text-right">
                          <span className="font-semibold">{l.qty.toLocaleString("ko-KR")}</span>
                          <span className="text-[#9A968E]"> ea</span>
                          {rcv > 0 && (
                            <span className="ml-2" style={{ color: rem > 0 ? "#C2711F" : "#3F7A57" }}>
                              입고 {rcv.toLocaleString("ko-KR")}{rem > 0 ? ` / 잔량 ${rem.toLocaleString("ko-KR")}` : " ✓"}
                            </span>
                          )}
                        </span>
                      </div>
                    );
                  })}
                  <div className="flex items-center justify-between px-3.5 py-2.5 bg-[#FAF9F6]">
                    <span className="text-[12px] font-semibold text-[#6B6863]">합계</span>
                    <span className="tabular-nums font-bold text-[14px]">
                      {(selOrder.orderedQty ?? selOrder.lines.reduce((a, l) => a + l.qty, 0)).toLocaleString("ko-KR")} ea
                      {(selOrder.receivedQty ?? 0) > 0 && (
                        <span className="ml-2 text-[12px]" style={{ color: (selOrder.remainingQty ?? 0) > 0 ? "#C2711F" : "#3F7A57" }}>
                          · 입고 {(selOrder.receivedQty ?? 0).toLocaleString("ko-KR")} / 잔량 {(selOrder.remainingQty ?? 0).toLocaleString("ko-KR")}
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              </div>

              {/* 입고 이력 */}
              {selOrder.receipts && selOrder.receipts.length > 0 && (
                <div className="mt-5">
                  <div className="text-[11px] font-semibold text-[#9A968E] uppercase tracking-wider mb-2">입고 이력</div>
                  <div className="bg-white border border-[#E5E2DC] rounded-lg overflow-hidden">
                    {selOrder.receipts.map((r) => (
                      <div key={r.id} className="px-3.5 py-2.5 border-b border-[#F0EEE9] last:border-0">
                        <div className="flex items-center justify-between">
                          <span className="text-[12px] font-medium text-[#6B6863]">{r.at.slice(0, 10)}</span>
                          <span className="text-[12px] tabular-nums font-semibold" style={{ color: "#3F7A57" }}>
                            +{r.items.reduce((a, it) => a + it.qty, 0).toLocaleString("ko-KR")} ea
                          </span>
                        </div>
                        <div className="text-[11px] text-[#9A968E] mt-0.5">
                          {r.items.map((it) => `${it.variant} ${it.qty}`).join(" · ")}
                          {r.note ? ` — ${r.note}` : ""}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* payment */}
              <div className="mt-5 grid grid-cols-2 gap-3">
                <div className="bg-white border border-[#E5E2DC] rounded-lg px-3.5 py-3">
                  <div className="text-[11px] text-[#9A968E] mb-1">확정단가 (USD)</div>
                  <div className="text-[15px] font-bold" style={{ color: selOrder.unit ? "#1C1B1A" : "#C9C5BD" }}>
                    {selOrder.unit || "미입력"}
                  </div>
                  {selOrder.quoteTotal != null && (
                    <div className="text-[11px] text-[#9A968E] mt-0.5">총액 {usd(selOrder.quoteTotal)}</div>
                  )}
                </div>
                <div className="bg-white border border-[#E5E2DC] rounded-lg px-3.5 py-3">
                  <div className="text-[11px] text-[#9A968E] mb-1">선급 / 잔금</div>
                  <div className="text-[15px] font-bold" style={{ color: selOrder.deposit ? "#3F7A57" : "#C9C5BD" }}>
                    {selOrder.deposit != null ? `${selOrder.deposit}% 집행` : "—"}
                  </div>
                  {selOrder.depositAmt != null && (
                    <div className="text-[11px] text-[#9A968E] mt-0.5">{usd(selOrder.depositAmt)}</div>
                  )}
                </div>
              </div>
              {selOrder.quoteRef && (
                <div className="mt-2 text-[11px] text-[#9A968E]">근거 견적: {selOrder.quoteRef}</div>
              )}

              {/* timeline */}
              <div className="mt-5">
                <div className="text-[11px] font-semibold text-[#9A968E] uppercase tracking-wider mb-2">
                  진행 단계 <span className="normal-case font-normal">· 단계를 클릭하면 변경됩니다</span>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {STAGES.map((s) => {
                    const idx = STAGES.indexOf(selOrder.status);
                    const cur = STAGES.indexOf(s) === idx;
                    const done = STAGES.indexOf(s) < idx;
                    return (
                      <button
                        key={s}
                        onClick={() => changeStage(selOrder, s)}
                        disabled={stageSaving || cur}
                        title={cur ? "현재 단계" : `[${s}] 단계로 변경`}
                        className="text-[11.5px] px-2 py-1 rounded-md font-medium transition disabled:cursor-default"
                        style={
                          cur
                            ? { background: STATUS_META[selOrder.status]?.color, color: "#fff" }
                            : done
                            ? { background: "#EAE7E0", color: "#6B6863", cursor: "pointer" }
                            : { background: "transparent", color: "#C9C5BD", border: "1px solid #EDEAE3", cursor: "pointer" }
                        }
                      >
                        {s}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-5 text-[12.5px] text-[#6B6863] leading-relaxed bg-[#F4F2ED] rounded-lg px-3.5 py-3">
                {selOrder.note}
              </div>

              {/* evidence */}
              <div className="mt-5">
                <div className="text-[11px] font-semibold text-[#9A968E] uppercase tracking-wider mb-2">증빙</div>
                <div className="grid grid-cols-2 gap-2">
                  {["발주서/작업의뢰서", selOrder.consign ? "사급출고증" : "거래명세서", "검수확인서", "세금계산서"].map((d) => (
                    <div key={d} className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-dashed border-[#D8D4CC] text-[12px] text-[#9A968E]">
                      <Paperclip size={13} /> {d}
                      <span className="ml-auto text-[10px] text-[#C9C5BD]">비어있음</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* actions */}
              <div className="mt-6 flex gap-2">
                <button
                  onClick={() => openForm(selOrder)}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-[13px] font-semibold text-white"
                  style={{ background: "#1C1B1A" }}
                >
                  <Printer size={15} /> {selOrder.type === "개발" ? "개발의뢰서 인쇄" : selOrder.consign ? "사급출고증 인쇄" : "발주서 인쇄"}
                </button>
              </div>
              <p className="mt-2 text-[11px] text-[#9A968E]">
                버튼을 누르면 인쇄용 3종 양식이 새 탭에서 열립니다. (탭에서 양식 선택 → 인쇄)
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
