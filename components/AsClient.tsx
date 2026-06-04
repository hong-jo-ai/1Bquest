"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Wrench,
  Search,
  Plus,
  X,
  Phone,
  User,
  Watch,
  Home,
  Truck,
  ChevronDown,
  ChevronUp,
  Loader2,
  MessageSquare,
  CheckSquare,
  Square,
  Send,
} from "lucide-react";
import AsIntakeForm from "@/components/AsIntakeForm";
import type { AsRequest, AsStatus } from "@/lib/as/types";
import {
  AS_STATUS_ORDER,
  AS_STATUS_LABEL,
  AS_DESTINATION_LABEL,
} from "@/lib/as/types";
import { BRAND_LABEL } from "@/lib/cs/types";
import type { CsBrandId } from "@/lib/cs/types";

type BrandFilter = CsBrandId | "all";
type StatusFilter = AsStatus | "all";

const STATUS_STYLE: Record<AsStatus, string> = {
  intake: "bg-sky-500 text-white",
  repairing: "bg-amber-500 text-white",
  repaired: "bg-violet-500 text-white",
  notified: "bg-blue-600 text-white",
  shipped: "bg-emerald-500 text-white",
};

const BRAND_DOT: Record<CsBrandId, string> = {
  paulvice: "bg-fuchsia-500",
  harriot: "bg-amber-600",
};

const DEFAULT_NOTIFY_TEMPLATE =
  "안녕하세요 #{이름} 고객님 #{브랜드}입니다!\n\n" +
  "맡겨주신 #{모델} #{수리내역} 수리가 완료되었어요.\n" +
  "발송 전 아래 내용 확인 부탁드릴게요!\n\n" +
  "[수리비 안내]\n" +
  "- 수리비 #{수리비}\n" +
  "- 반송 택배비 #{반송비}\n" +
  "- 합계 #{합계}\n\n" +
  "아래 계좌로 입금 부탁드려요.\n" +
  "우리은행 84917294402001 홍성조\n\n" +
  "입금 확인되면 바로 발송 준비하겠습니다";

const DEFAULT_SHIPPING_FEE = "3000";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
  });
}

function fmtCost(n: number | null): string {
  if (n == null) return "";
  return n.toLocaleString("ko-KR") + "원";
}

export default function AsClient() {
  const [brand, setBrand] = useState<BrandFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [q, setQ] = useState("");
  const [requests, setRequests] = useState<AsRequest[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // 일괄 문자 안내
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showNotify, setShowNotify] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (status !== "all") params.set("status", status);
      if (brand !== "all") params.set("brand", brand);
      if (q.trim()) params.set("q", q.trim());
      const res = await fetch(`/api/as/requests?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "불러오기 실패");
      setRequests(data.requests ?? []);
      setCounts(data.counts ?? {});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [brand, status, q]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(load, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [load]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelected(new Set());
  }

  const selectedRequests = requests.filter((r) => selected.has(r.id));

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      <div className="mx-auto max-w-3xl px-4 py-6 pb-28">
        {/* 헤더 */}
        <div className="flex items-center justify-between mb-4">
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <Wrench size={22} className="text-violet-500" />
            AS 수리 추적
          </h1>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                if (selectMode) exitSelectMode();
                else {
                  setSelectMode(true);
                  setExpandedId(null);
                }
              }}
              className={`flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg active:scale-95 transition ${
                selectMode
                  ? "bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200"
                  : "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 hover:bg-blue-100"
              }`}
            >
              <MessageSquare size={15} />
              {selectMode ? "선택 취소" : "문자 안내"}
            </button>
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold px-3.5 py-2 rounded-lg active:scale-95 transition"
            >
              <Plus size={16} /> 새 접수
            </button>
          </div>
        </div>

        {selectMode && (
          <div className="mb-3 text-xs text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/20 px-3 py-2 rounded-lg">
            문자 보낼 건을 선택하세요. 보통 <b>수리완료</b> 탭에서 고르면 됩니다.
          </div>
        )}

        {/* 검색 */}
        <div className="relative mb-3">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="모델·증상·이름·전화·AS번호 검색  (예: 가양 실버 바늘)"
            className="w-full pl-10 pr-9 py-2.5 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
          />
          {q && (
            <button
              onClick={() => setQ("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* 브랜드 필터 */}
        <div className="flex gap-1.5 mb-2">
          {(["all", "paulvice", "harriot"] as BrandFilter[]).map((b) => (
            <button
              key={b}
              onClick={() => setBrand(b)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition ${
                brand === b
                  ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900"
                  : "bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400"
              }`}
            >
              {b === "all" ? "전체 브랜드" : BRAND_LABEL[b]}
            </button>
          ))}
        </div>

        {/* 상태 탭 */}
        <div className="flex gap-1.5 mb-4 overflow-x-auto pb-1">
          {(["all", ...AS_STATUS_ORDER] as StatusFilter[]).map((s) => {
            const label = s === "all" ? "전체" : AS_STATUS_LABEL[s];
            const count = counts[s] ?? 0;
            return (
              <button
                key={s}
                onClick={() => setStatus(s)}
                className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 ${
                  status === s
                    ? "bg-violet-600 text-white"
                    : "bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400"
                }`}
              >
                {label}
                {count > 0 && (
                  <span
                    className={`px-1.5 rounded-full text-[10px] ${
                      status === s ? "bg-white/25" : "bg-zinc-200 dark:bg-zinc-700"
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {error && (
          <div className="mb-3 text-sm text-red-600 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg">
            {error}
          </div>
        )}

        {/* 목록 */}
        {loading && requests.length === 0 ? (
          <div className="flex justify-center py-12 text-zinc-400">
            <Loader2 className="animate-spin" />
          </div>
        ) : requests.length === 0 ? (
          <div className="text-center py-12 text-sm text-zinc-400">
            {q ? "검색 결과가 없어요." : "접수된 AS가 없어요. ‘새 접수’로 시작하세요."}
          </div>
        ) : (
          <div className="space-y-2">
            {requests.map((r) => (
              <AsCard
                key={r.id}
                req={r}
                selectMode={selectMode}
                selected={selected.has(r.id)}
                onSelect={() => toggleSelect(r.id)}
                expanded={expandedId === r.id}
                onToggle={() => setExpandedId(expandedId === r.id ? null : r.id)}
                onSaved={load}
              />
            ))}
          </div>
        )}
      </div>

      {/* 선택 모드 하단 바 */}
      {selectMode && selected.size > 0 && (
        <div className="fixed bottom-0 inset-x-0 z-40 bg-white dark:bg-zinc-900 border-t border-zinc-200 dark:border-zinc-800 px-4 py-3">
          <div className="mx-auto max-w-3xl flex items-center justify-between">
            <span className="text-sm font-medium">{selected.size}건 선택됨</span>
            <button
              onClick={() => setShowNotify(true)}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg active:scale-95 transition"
            >
              <Send size={15} /> 문자 작성
            </button>
          </div>
        </div>
      )}

      {showForm && (
        <AsIntakeForm
          onClose={() => setShowForm(false)}
          onCreated={() => {
            setShowForm(false);
            load();
          }}
        />
      )}

      {showNotify && (
        <NotifyModal
          targets={selectedRequests}
          onClose={() => setShowNotify(false)}
          onSent={() => {
            setShowNotify(false);
            exitSelectMode();
            load();
          }}
        />
      )}
    </div>
  );
}

// ── 접수 카드 ────────────────────────────────────────────────────────
function AsCard({
  req,
  selectMode,
  selected,
  onSelect,
  expanded,
  onToggle,
  onSaved,
}: {
  req: AsRequest;
  selectMode: boolean;
  selected: boolean;
  onSelect: () => void;
  expanded: boolean;
  onToggle: () => void;
  onSaved: () => void;
}) {
  const hasPhone = !!(req.customer_phone && req.customer_phone.trim());
  return (
    <div
      className={`bg-white dark:bg-zinc-900 border rounded-xl overflow-hidden transition ${
        selected
          ? "border-blue-400 ring-1 ring-blue-300"
          : "border-zinc-200 dark:border-zinc-800"
      }`}
    >
      <button
        onClick={selectMode ? onSelect : onToggle}
        className="w-full text-left px-4 py-3 flex items-start gap-3"
      >
        {selectMode ? (
          selected ? (
            <CheckSquare size={18} className="mt-0.5 shrink-0 text-blue-600" />
          ) : (
            <Square size={18} className="mt-0.5 shrink-0 text-zinc-300 dark:text-zinc-600" />
          )
        ) : (
          <span
            className={`mt-1 w-2 h-2 rounded-full shrink-0 ${BRAND_DOT[req.brand]}`}
            title={BRAND_LABEL[req.brand]}
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-[15px] truncate">
            {req.model || "모델 미입력"}
            {req.symptom && (
              <span className="font-normal text-zinc-500"> · {req.symptom}</span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1 text-xs text-zinc-500">
            <span className="font-mono">{req.as_number}</span>
            {req.customer_name && (
              <span className="flex items-center gap-0.5">
                <User size={11} />
                {req.customer_name}
              </span>
            )}
            <span>· {fmtDate(req.created_at)} 접수</span>
          </div>
          {req.repair_detail && (
            <div className="mt-1 text-xs text-violet-600 dark:text-violet-400">
              수리: {req.repair_detail}
              {req.repair_cost != null && ` (${fmtCost(req.repair_cost)})`}
            </div>
          )}
          {selectMode && !hasPhone && (
            <div className="mt-1 text-[11px] text-red-500">
              연락처 없음 — 문자 발송 불가 (펼쳐서 입력하세요)
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span
            className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${STATUS_STYLE[req.status]}`}
          >
            {AS_STATUS_LABEL[req.status]}
          </span>
          {!selectMode &&
            (expanded ? (
              <ChevronUp size={16} className="text-zinc-400" />
            ) : (
              <ChevronDown size={16} className="text-zinc-400" />
            ))}
        </div>
      </button>

      {!selectMode && expanded && <EditPanel req={req} onSaved={onSaved} />}
    </div>
  );
}

// ── 편집 패널 ────────────────────────────────────────────────────────
function EditPanel({ req, onSaved }: { req: AsRequest; onSaved: () => void }) {
  const [status, setStatus] = useState<AsStatus>(req.status);
  const [model, setModel] = useState(req.model ?? "");
  const [symptom, setSymptom] = useState(req.symptom ?? "");
  const [customerName, setCustomerName] = useState(req.customer_name ?? "");
  const [customerPhone, setCustomerPhone] = useState(req.customer_phone ?? "");
  const [customerAddress, setCustomerAddress] = useState(req.customer_address ?? "");
  const [repairDetail, setRepairDetail] = useState(req.repair_detail ?? "");
  const [repairCost, setRepairCost] = useState(
    req.repair_cost != null ? String(req.repair_cost) : ""
  );
  const [tracking, setTracking] = useState(req.return_tracking_no ?? "");
  const [note, setNote] = useState(req.note ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(`/api/as/requests/${req.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          model: model.trim() || null,
          symptom: symptom.trim() || null,
          customerName: customerName.trim() || null,
          customerPhone: customerPhone.trim() || null,
          customerAddress: customerAddress.trim() || null,
          repairDetail: repairDetail.trim() || null,
          repairCost: repairCost.trim()
            ? Number(repairCost.replace(/[^0-9]/g, ""))
            : null,
          returnTrackingNo: tracking.trim() || null,
          note: note.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "저장 실패");
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="px-4 pb-4 pt-1 border-t border-zinc-100 dark:border-zinc-800 space-y-3">
      <div>
        <Label>진행 상태</Label>
        <div className="flex gap-1 flex-wrap">
          {AS_STATUS_ORDER.map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${
                status === s
                  ? STATUS_STYLE[s]
                  : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500"
              }`}
            >
              {AS_STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label="모델" value={model} onChange={setModel} icon={Watch} />
        <Field label="증상" value={symptom} onChange={setSymptom} />
        <Field label="고객명" value={customerName} onChange={setCustomerName} icon={User} />
        <Field label="연락처" value={customerPhone} onChange={setCustomerPhone} icon={Phone} />
        <div className="col-span-2">
          <Field label="반송 주소" value={customerAddress} onChange={setCustomerAddress} icon={Home} />
        </div>
        <Field label="수리내역" value={repairDetail} onChange={setRepairDetail} />
        <Field label="비용(원)" value={repairCost} onChange={setRepairCost} inputMode="numeric" />
        <Field label="반송 송장번호" value={tracking} onChange={setTracking} icon={Truck} />
        <Field label="비고" value={note} onChange={setNote} />
      </div>

      {req.channel && (
        <div className="text-xs text-zinc-400">접수 채널: {req.channel}</div>
      )}
      {req.destination && (
        <div className="text-xs text-zinc-400">
          보낸 곳: {AS_DESTINATION_LABEL[req.destination]}
        </div>
      )}

      {err && <div className="text-xs text-red-600">{err}</div>}

      <button
        onClick={save}
        disabled={saving}
        className="w-full bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-semibold py-2 rounded-lg active:scale-95 transition flex items-center justify-center gap-1.5"
      >
        {saving && <Loader2 size={14} className="animate-spin" />}
        저장
      </button>
    </div>
  );
}

// ── 일괄 문자 안내 모달 ──────────────────────────────────────────────
function NotifyModal({
  targets,
  onClose,
  onSent,
}: {
  targets: AsRequest[];
  onClose: () => void;
  onSent: () => void;
}) {
  const [template, setTemplate] = useState(DEFAULT_NOTIFY_TEMPLATE);
  const [shippingFeeInput, setShippingFeeInput] = useState(DEFAULT_SHIPPING_FEE);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const shippingFee = shippingFeeInput.trim()
    ? Number(shippingFeeInput.replace(/[^0-9]/g, ""))
    : null;

  const withPhone = targets.filter(
    (t) => t.customer_phone && t.customer_phone.trim()
  );
  const missing = targets.length - withPhone.length;

  // 첫 대상 미리보기
  const preview = withPhone[0]
    ? fillTokens(template, withPhone[0], shippingFee)
    : "(연락처 있는 대상이 없습니다)";

  async function send() {
    setSending(true);
    setErr(null);
    try {
      const res = await fetch("/api/as/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: withPhone.map((t) => t.id),
          template,
          shippingFee,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        throw new Error(data.error ?? "발송 실패");
      }
      setResult(`성공 ${data.successCount} · 실패 ${data.failCount}`);
      setTimeout(onSent, 900);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4">
      <div className="w-full sm:max-w-md bg-white dark:bg-zinc-900 rounded-t-2xl sm:rounded-2xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-white dark:bg-zinc-900 px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
          <h2 className="font-bold flex items-center gap-1.5">
            <MessageSquare size={16} className="text-blue-500" /> 수리 완료 문자 안내
          </h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600">
            <X size={20} />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div className="text-xs text-zinc-500">
            대상 {targets.length}건 중 발송 가능 <b className="text-zinc-700 dark:text-zinc-200">{withPhone.length}명</b>
            {missing > 0 && (
              <span className="text-red-500"> · 연락처 없음 {missing}건 제외</span>
            )}
          </div>

          <label className="block">
            <span className="text-xs font-medium text-zinc-500 mb-1 block">
              반송 택배비 (전 건 공통 적용 · #{"{합계}"} = 수리비 + 반송비)
            </span>
            <input
              value={shippingFeeInput}
              onChange={(e) => setShippingFeeInput(e.target.value)}
              inputMode="numeric"
              placeholder="예: 3000 (없으면 비워두기)"
              className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium text-zinc-500 mb-1 block">메시지 (건별 자동 치환)</span>
            <textarea
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              rows={12}
              className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
            />
          </label>

          <div className="text-[11px] text-zinc-400 leading-relaxed">
            치환 토큰: <code>#{"{브랜드}"}</code> <code>#{"{이름}"}</code>{" "}
            <code>#{"{모델}"}</code> <code>#{"{수리내역}"}</code>{" "}
            <code>#{"{수리비}"}</code> <code>#{"{반송비}"}</code>{" "}
            <code>#{"{합계}"}</code> <code>#{"{증상}"}</code>{" "}
            <code>#{"{AS번호}"}</code>
            <br />
            수리비는 각 건의 입력값, 반송비·합계는 위 입력값으로 건별 계산돼요.
          </div>

          <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 px-3 py-2">
            <div className="text-[11px] font-medium text-zinc-400 mb-1">미리보기 (첫 대상)</div>
            <div className="text-xs whitespace-pre-wrap text-zinc-700 dark:text-zinc-200">
              {preview}
            </div>
          </div>

          {err && <div className="text-xs text-red-600">{err}</div>}
          {result && <div className="text-xs text-emerald-600 font-medium">{result}</div>}

          <button
            onClick={send}
            disabled={sending || withPhone.length === 0}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg active:scale-95 transition flex items-center justify-center gap-1.5"
          >
            {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            {withPhone.length}명에게 발송 + 안내완료 처리
          </button>
          <p className="text-[11px] text-zinc-400 text-center">
            발송 후 해당 건은 자동으로 ‘안내완료’ 상태가 됩니다.
          </p>
        </div>
      </div>
    </div>
  );
}

// 미리보기용 클라이언트 측 토큰 치환 (서버 /api/as/notify 와 동일 규칙)
function fillTokens(template: string, r: AsRequest, shippingFee: number | null): string {
  const won = (n: number) => n.toLocaleString("ko-KR") + "원";
  const repair = r.repair_cost;
  const repairStr = repair != null ? won(repair) : "별도 안내";
  const shipStr = shippingFee != null ? won(shippingFee) : "별도 안내";
  const totalStr =
    repair != null && shippingFee != null ? won(repair + shippingFee) : "별도 안내";
  return template
    .replace(/#\{브랜드\}/g, BRAND_LABEL[r.brand])
    .replace(/#\{이름\}/g, (r.customer_name ?? "").trim())
    .replace(/#\{모델\}/g, r.model ?? "제품")
    .replace(/#\{증상\}/g, r.symptom ?? "")
    .replace(/#\{수리내역\}/g, r.repair_detail ?? "")
    .replace(/#\{수리비\}/g, repairStr)
    .replace(/#\{반송비\}/g, shipStr)
    .replace(/#\{합계\}/g, totalStr)
    .replace(/#\{비용\}/g, repairStr) // 하위호환
    .replace(/#\{AS번호\}/g, r.as_number);
}

// ── 작은 공통 컴포넌트 ───────────────────────────────────────────────
function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-medium text-zinc-500 mb-1">{children}</div>;
}

function Field({
  label,
  value,
  onChange,
  icon: Icon,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  icon?: React.ElementType;
  inputMode?: "numeric" | "tel";
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-zinc-500 mb-1 flex items-center gap-1">
        {Icon && <Icon size={11} />}
        {label}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode={inputMode}
        className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-violet-400"
      />
    </label>
  );
}
