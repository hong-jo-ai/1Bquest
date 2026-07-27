"use client";

import { useState, useEffect } from "react";
import { X, Hash, Phone, User, Watch, MapPin, Home, Loader2 } from "lucide-react";
import type { AsDestination, AsRequestType } from "@/lib/as/types";
import { AS_DESTINATION_LABEL, AS_REQUEST_TYPE_LABEL } from "@/lib/as/types";
import { BRAND_LABEL } from "@/lib/cs/types";
import type { CsBrandId } from "@/lib/cs/types";

export interface AsIntakeInitial {
  brand?: CsBrandId;
  requestType?: AsRequestType;
  customerName?: string | null;
  customerPhone?: string | null;
  channel?: string | null;
  model?: string | null;
  symptom?: string | null;
  note?: string | null;
  csThreadId?: string | null;
}

/**
 * AS 접수 폼 (모달). AS 페이지의 "새 접수"와 CS 인박스의 "AS 접수" 버튼이 공유.
 * initial 로 고객명·채널·cs_thread_id 등을 미리 채워 넘길 수 있다.
 */
export default function AsIntakeForm({
  initial,
  onClose,
  onCreated,
}: {
  initial?: AsIntakeInitial;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [brand, setBrand] = useState<CsBrandId>(initial?.brand ?? "paulvice");
  const [requestType, setRequestType] = useState<AsRequestType>(
    initial?.requestType ?? "repair"
  );
  const [customerName, setCustomerName] = useState(initial?.customerName ?? "");
  const [customerPhone, setCustomerPhone] = useState(initial?.customerPhone ?? "");
  const [customerAddress, setCustomerAddress] = useState("");
  const [channel, setChannel] = useState(initial?.channel ?? "");
  const [model, setModel] = useState(initial?.model ?? "");
  const [symptom, setSymptom] = useState(initial?.symptom ?? "");
  const [destination, setDestination] = useState<AsDestination | "">("");
  const [note, setNote] = useState(initial?.note ?? "");
  const [saving, setSaving] = useState(false);
  const [extracting, setExtracting] = useState(false);

  // CS 대화 연결 시: 대화 내용에서 이름·연락처·주소·모델·증상을 AI로 추출해 "빈 칸만" 채운다.
  useEffect(() => {
    const tid = initial?.csThreadId;
    if (!tid) return;
    let alive = true;
    setExtracting(true);
    fetch("/api/as/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId: tid }),
    })
      .then((r) => r.json())
      .then((j) => {
        if (!alive || !j?.ok) return;
        const f = j.fields ?? {};
        if (f.customerName) setCustomerName((v) => v || f.customerName);
        if (f.customerPhone) setCustomerPhone((v) => v || f.customerPhone);
        if (f.customerAddress) setCustomerAddress((v) => v || f.customerAddress);
        if (f.model) setModel((v) => v || f.model);
        if (f.symptom) setSymptom((v) => v || f.symptom);
        if (f.note) setNote((v) => v || f.note);
      })
      .catch(() => {})
      .finally(() => { if (alive) setExtracting(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial?.csThreadId]);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch("/api/as/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brand,
          requestType,
          customerName: customerName.trim() || null,
          customerPhone: customerPhone.trim() || null,
          customerAddress: customerAddress.trim() || null,
          channel: channel.trim() || null,
          model: model.trim() || null,
          symptom: symptom.trim() || null,
          destination: destination || null,
          note: note.trim() || null,
          csThreadId: initial?.csThreadId ?? null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "접수 실패");
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4">
      <div className="w-full sm:max-w-md bg-white dark:bg-zinc-900 rounded-t-2xl sm:rounded-2xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-white dark:bg-zinc-900 px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
          <h2 className="font-bold flex items-center gap-1.5 text-zinc-900 dark:text-zinc-100">
            <Hash size={16} className="text-violet-500" /> AS 새 접수
          </h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600">
            <X size={20} />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {initial?.csThreadId && (
            <div className="text-[11px] text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-900/20 px-2.5 py-1.5 rounded-lg flex items-center gap-1.5">
              {extracting && <Loader2 size={12} className="animate-spin shrink-0" />}
              {extracting
                ? "대화에서 이름·연락처·주소·증상 자동 추출 중…"
                : "이 CS 대화와 연결됩니다 — 대화에 있던 정보는 자동으로 채워졌어요. 확인 후 등록하세요."}
            </div>
          )}

          <div>
            <Label>브랜드 *</Label>
            <div className="flex gap-1.5">
              {(["paulvice", "harriot"] as CsBrandId[]).map((b) => (
                <button
                  key={b}
                  onClick={() => setBrand(b)}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${
                    brand === b
                      ? "bg-violet-600 text-white"
                      : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500"
                  }`}
                >
                  {BRAND_LABEL[b]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label>처리유형 *</Label>
            <div className="flex gap-1.5">
              {(["repair", "exchange", "refund"] as AsRequestType[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setRequestType(t)}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${
                    requestType === t
                      ? t === "refund"
                        ? "bg-rose-600 text-white"
                        : "bg-violet-600 text-white"
                      : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500"
                  }`}
                >
                  {AS_REQUEST_TYPE_LABEL[t]}
                </button>
              ))}
            </div>
            {requestType === "refund" && (
              <div className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">
                환불 건 — 접수 후 카드에서 환불액·배송비공제·환불계좌·환불완료를 처리합니다.
              </div>
            )}
          </div>

          <Field label="모델  ★" value={model} onChange={setModel} icon={Watch} placeholder="예: 가양 실버" />
          <Field
            label={requestType === "refund" ? "사유  ★" : "증상  ★"}
            value={symptom}
            onChange={setSymptom}
            placeholder={requestType === "refund" ? "환불 사유 (예: 단순변심)" : "고객 표현 그대로 (예: 초침이 안 움직임)"}
          />
          <Field label="고객명" value={customerName} onChange={setCustomerName} icon={User} />
          <Field label="연락처" value={customerPhone} onChange={setCustomerPhone} icon={Phone} inputMode="tel" />
          <Field label="반송 주소" value={customerAddress} onChange={setCustomerAddress} icon={Home} placeholder="송장 블라인드 처리 → 접수 때 받아두기 (도로명+상세주소)" />
          <Field label="접수 채널" value={channel} onChange={setChannel} placeholder="카카오 / 메일 / 게시판 …" />

          <div>
            <Label>보낼 곳</Label>
            <div className="flex gap-1.5">
              {(["office", "center"] as AsDestination[]).map((d) => (
                <button
                  key={d}
                  onClick={() => setDestination(destination === d ? "" : d)}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium transition flex items-center justify-center gap-1 ${
                    destination === d
                      ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900"
                      : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500"
                  }`}
                >
                  <MapPin size={12} />
                  {AS_DESTINATION_LABEL[d]}
                </button>
              ))}
            </div>
          </div>

          <Field label="비고" value={note} onChange={setNote} />

          {err && <div className="text-xs text-red-600">{err}</div>}

          <button
            onClick={submit}
            disabled={saving}
            className="w-full bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg active:scale-95 transition flex items-center justify-center gap-1.5"
          >
            {saving && <Loader2 size={15} className="animate-spin" />}
            접수 등록
          </button>
        </div>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-medium text-zinc-500 mb-1">{children}</div>;
}

function Field({
  label,
  value,
  onChange,
  icon: Icon,
  placeholder,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  icon?: React.ElementType;
  placeholder?: string;
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
        placeholder={placeholder}
        inputMode={inputMode}
        className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-violet-400"
      />
    </label>
  );
}
