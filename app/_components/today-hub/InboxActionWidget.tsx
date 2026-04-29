// v3: Gmail '답장필요' 라벨 메일 자동 표시 — 클릭 시 답장 모달
"use client";

import { useState, useEffect, useCallback } from "react";
import { Mail, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import InboxReplyModal from "./InboxReplyModal";
import type { InboxItem } from "./types";

const BRAND_DOT: Record<string, string> = {
  paulvice: "bg-violet-500",
  harriot:  "bg-amber-600",
};

export default function InboxActionWidget() {
  const [items,    setItems]    = useState<InboxItem[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [selected, setSelected] = useState<InboxItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/today-hub/inbox", { cache: "no-store" });
      const j   = await res.json();
      if (!j.ok) throw new Error(j.error ?? "조회 실패");
      setItems(j.items as InboxItem[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleResolved = () => {
    setSelected(null);
    load();
  };

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 overflow-hidden h-full">
      <div className="px-5 py-3 border-b border-zinc-100 dark:border-zinc-800 flex items-center gap-2.5">
        <div className="w-7 h-7 bg-gradient-to-br from-rose-500 to-rose-700 rounded-lg flex items-center justify-center text-white shrink-0">
          <Mail size={13} />
        </div>
        <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 flex-1">답장 필요</h3>
        <span className="text-[11px] font-semibold bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 px-2 py-0.5 rounded-full tabular-nums">
          {items.length}
        </span>
        <button
          onClick={load}
          disabled={loading}
          className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 disabled:opacity-50"
          aria-label="새로고침"
          title="새로고침"
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="p-2">
        {loading && items.length === 0 && (
          <div className="flex items-center justify-center py-6 gap-2 text-zinc-400">
            <Loader2 size={14} className="animate-spin" />
            <span className="text-xs">불러오는 중...</span>
          </div>
        )}

        {!loading && error && (
          <div className="flex items-start gap-2 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-lg px-3 py-2 text-xs m-2">
            <AlertCircle size={12} className="shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p>{error}</p>
              {error.includes("미연결") || error.includes("미등록") ? (
                <a href="/inbox/setup" className="underline font-medium">Gmail 연결하기 →</a>
              ) : null}
            </div>
          </div>
        )}

        {!loading && !error && items.length === 0 && (
          <p className="text-xs text-zinc-400 text-center py-6">
            답장 필요한 메일이 없습니다.
            <br />
            <span className="text-[10px] text-zinc-300">Gmail에서 메일에 &lsquo;답장필요&rsquo; 라벨을 붙이면 여기 표시됩니다.</span>
          </p>
        )}

        <ul className="space-y-0.5">
          {items.map((it) => (
            <li key={it.id}>
              <button
                onClick={() => setSelected(it)}
                className="w-full text-left flex items-start gap-2 px-3 py-2 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${
                    it.overdue ? "bg-rose-500" : (BRAND_DOT[it.accountBrand] ?? "bg-zinc-300")
                  }`}
                  aria-label={it.overdue ? "24시간 초과" : it.accountBrand}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-zinc-700 dark:text-zinc-200 truncate">{it.sender}</p>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">{it.subject}</p>
                </div>
                <span className={`text-[10px] shrink-0 mt-0.5 ${
                  it.overdue ? "text-rose-600 font-semibold" : "text-zinc-400"
                }`}>
                  {it.receivedLabel}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {selected && (
        <InboxReplyModal
          item={selected}
          onClose={() => setSelected(null)}
          onResolved={handleResolved}
        />
      )}
    </div>
  );
}
