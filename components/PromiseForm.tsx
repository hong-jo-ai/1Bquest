"use client";

import { useState } from "react";
import { CalendarClock, Loader2, X, Package } from "lucide-react";

/**
 * 고객 약속 등록 모달 — 상담 중 한 약속을 실행 시점까지 끌고 가기 위한 입력.
 * 주문번호를 넣으면 우체국 출고 목록·발송 화면에서 그 주문에 경고가 붙는다(포장할 때 보이라고).
 */
export default function PromiseForm({
  initial,
  onClose,
  onCreated,
}: {
  initial?: {
    threadId?: string;
    customerName?: string | null;
    customerHandle?: string | null;
    orderNumber?: string | null;
    seller?: string | null;
  };
  onClose: () => void;
  onCreated: (message: string) => void;
}) {
  const [text, setText] = useState("");
  const [remindOn, setRemindOn] = useState(tomorrowKst());
  const [dueOn, setDueOn] = useState("");
  const [orderNumber, setOrderNumber] = useState(initial?.orderNumber ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!text.trim()) {
      setErr("약속 내용을 입력해 주세요.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch("/api/cs/promises", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: text.trim(),
          remindOn: remindOn || null,
          dueOn: dueOn || null,
          orderNumber: orderNumber.trim() || null,
          seller: initial?.seller ?? null,
          threadId: initial?.threadId ?? null,
          customerName: initial?.customerName ?? null,
          customerHandle: initial?.customerHandle ?? null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "등록 실패");
      onCreated(
        remindOn ? `약속 저장 — ${remindOn} 아침에 알려드릴게요` : "약속을 저장했습니다"
      );
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
            <CalendarClock size={16} className="text-amber-500" /> 약속 남기기
          </h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600">
            <X size={20} />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div className="text-[11px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-2.5 py-1.5 rounded-lg leading-relaxed">
            상담에서 한 약속을 실행할 때까지 붙잡아 둡니다. 지정한 날 아침 텔레그램으로 알리고,
            주문번호를 넣으면 <b>출고 화면에서 그 주문에 경고</b>가 붙습니다.
          </div>

          <label className="block">
            <span className="text-xs font-medium text-zinc-500 mb-1 block">약속 내용 *</span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              placeholder="예) 교환품 보낼 때 쇼핑백 3개 같이 넣기 (무상 약속)"
              className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
            />
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-xs font-medium text-zinc-500 mb-1 block">알림 날짜</span>
              <input
                type="date"
                value={remindOn}
                onChange={(e) => setRemindOn(e.target.value)}
                className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-zinc-500 mb-1 block">마감일(선택)</span>
              <input
                type="date"
                value={dueOn}
                onChange={(e) => setDueOn(e.target.value)}
                className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </label>
          </div>

          <label className="block">
            <span className="text-xs font-medium text-zinc-500 mb-1 flex items-center gap-1">
              <Package size={11} /> 주문번호(선택) — 넣으면 출고 화면에 경고 표시
            </span>
            <input
              value={orderNumber}
              onChange={(e) => setOrderNumber(e.target.value)}
              placeholder="예) 202608261726580002"
              className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          </label>

          {err && <div className="text-xs text-red-600">{err}</div>}

          <button
            onClick={submit}
            disabled={saving}
            className="w-full bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg active:scale-95 transition flex items-center justify-center gap-1.5"
          >
            {saving && <Loader2 size={15} className="animate-spin" />}
            약속 저장
          </button>
        </div>
      </div>
    </div>
  );
}

function tomorrowKst(): string {
  const now = new Date(Date.now() + 24 * 3600_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
