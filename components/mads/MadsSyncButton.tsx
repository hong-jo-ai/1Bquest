"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Loader2 } from "lucide-react";

function fmtKST(iso: string | null): string {
  if (!iso) return "동기화 기록 없음";
  return new Date(iso).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

export default function MadsSyncButton() {
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [syncing, setSyncing]           = useState(false);
  const [err, setErr]                   = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/mads/sync");
      const d = await res.json();
      if (d.ok) setLastSyncedAt(d.lastSyncedAt ?? null);
    } catch { /* 무시 — 시각 표시만 못 함 */ }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const sync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    setErr(null);
    try {
      const res = await fetch("/api/mads/sync", { method: "POST" });
      const d = await res.json();
      if (!d.ok) throw new Error(d.error ?? d.errors?.[0]?.error ?? "동기화 실패");
      window.location.reload(); // 성장 조언·추천·지표 카드 전체 갱신
    } catch (e) {
      setErr(e instanceof Error ? e.message : "동기화 실패");
      setSyncing(false);
    }
  }, [syncing]);

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={sync}
        disabled={syncing}
        className="flex items-center gap-1.5 text-sm font-semibold bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 rounded-xl transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {syncing ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
        {syncing ? "동기화 중..." : "지금 동기화"}
      </button>
      <span className="text-[11px] text-zinc-400">
        {syncing ? "Meta에서 최신 데이터 가져오는 중 (최대 1분)" : `마지막 동기화: ${fmtKST(lastSyncedAt)}`}
      </span>
      {err && <span className="text-[11px] text-red-500">{err}</span>}
    </div>
  );
}
