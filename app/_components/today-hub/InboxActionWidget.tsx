// v3+: AI 자동 분류 인박스 — 라벨 기반 필터링 → Claude 분류 + 사용자 피드백 학습
"use client";

import { useState, useEffect, useCallback } from "react";
import { Mail, Loader2, AlertCircle, RefreshCw, Sparkles, X, Check } from "lucide-react";
import InboxReplyModal from "./InboxReplyModal";

interface InboxItem {
  id:            string;
  messageId:     string;
  threadId:      string;
  sender:        string;
  senderEmail:   string;
  subject:       string;
  snippet:       string;
  receivedAt:    string;
  receivedLabel: string;
  overdue:       boolean;
  reason:        string;
  confidence:    number;
  gmailWebUrl:   string;
}

interface SyncStatus {
  lastSyncAt:    string;
  scannedCount:  number;
  newClassified: number;
  errorCount:    number;
  classificationErrors?: Array<{ messageId: string; error: string }>;
  fatalError?:   string;
  pendingCount?: number;
}

interface Breakdown {
  totalCached:     number;
  needsReplyTotal: number;
  dismissedTotal:  number;
  visibleCount:    number;
}

export default function InboxActionWidget() {
  const [items,      setItems]      = useState<InboxItem[]>([]);
  const [status,     setStatus]     = useState<SyncStatus | null>(null);
  const [breakdown,  setBreakdown]  = useState<Breakdown | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [classifying, setClassifying] = useState(false);
  const [selected,   setSelected]   = useState<InboxItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/today-hub/inbox", { cache: "no-store" });
      const j   = await res.json();
      if (!j.ok) throw new Error(j.error ?? "조회 실패");
      setItems(j.items as InboxItem[]);
      setStatus(j.status ?? null);
      setBreakdown(j.breakdown ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const triggerClassify = async () => {
    setClassifying(true);
    setError(null);
    try {
      const res = await fetch("/api/today-hub/inbox/classify", { method: "POST" });
      // Vercel 타임아웃이나 서버 크래시 시 HTML 에러 페이지가 올 수 있어 안전 파싱
      const text = await res.text();
      let j: { ok?: boolean; error?: string; status?: SyncStatus } | null = null;
      try { j = JSON.parse(text); } catch {
        throw new Error(
          `서버 응답 비정상 (HTTP ${res.status}). 함수 타임아웃 가능성 — 다시 시도하면 다음 배치로 진행됩니다. 응답: ${text.slice(0, 200)}`,
        );
      }
      if (!j?.ok) throw new Error(j?.error ?? "분류 실패");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setClassifying(false);
    }
  };

  const handleNotNeeded = async (it: InboxItem) => {
    try {
      const res = await fetch("/api/today-hub/inbox", {
        method:  "DELETE",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ messageId: it.messageId }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error ?? "처리 실패");
      // 옵티미스틱 업데이트
      setItems((prev) => prev.filter((x) => x.messageId !== it.messageId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleMarkReplied = async (it: InboxItem) => {
    // 옵티미스틱 — UI 즉시 제거
    setItems((prev) => prev.filter((x) => x.messageId !== it.messageId));
    try {
      const res = await fetch("/api/today-hub/inbox", {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ messageId: it.messageId, replied: true }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error ?? "처리 실패");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      // 실패 시 다시 불러와서 복원
      load();
    }
  };

  const lastSyncLabel = status?.lastSyncAt
    ? new Date(status.lastSyncAt).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })
    : null;

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
          onClick={triggerClassify}
          disabled={classifying}
          className="text-[10px] font-medium text-violet-600 dark:text-violet-400 hover:text-violet-700 inline-flex items-center gap-0.5 disabled:opacity-50"
          title="새 메일 즉시 분류"
        >
          <Sparkles size={11} className={classifying ? "animate-pulse" : ""} />
          {classifying ? "분류중" : "재분류"}
        </button>
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
            <div className="min-w-0 flex-1">
              <p className="break-words">{error}</p>
              {(error.includes("미연결") ||
                error.includes("스코프") ||
                error.includes("ANTHROPIC") ||
                error.includes("403")) && (
                <a
                  href="/api/auth/google/login?hint=shong@harriotwatches.com"
                  className="underline font-medium mt-1 inline-block"
                >
                  Google 재연결 →
                </a>
              )}
            </div>
          </div>
        )}

        {!loading && !error && items.length === 0 && (
          <div className="text-center py-6 px-3">
            <p className="text-xs text-zinc-400">답장 필요한 메일이 없습니다.</p>
            {breakdown && breakdown.totalCached > 0 ? (
              <p className="text-[10px] text-zinc-400 mt-1.5 leading-relaxed">
                14일치 <span className="font-semibold">{breakdown.totalCached}건</span> 분류 완료 ·
                {" "}답장 필요로 판단 <span className="font-semibold">{breakdown.needsReplyTotal}건</span>
                {breakdown.dismissedTotal > 0 && (
                  <> · 처리 완료 <span className="font-semibold">{breakdown.dismissedTotal}건</span></>
                )}
                {(status?.pendingCount ?? 0) > 0 && (
                  <> · <span className="text-amber-600">대기 {status?.pendingCount}건 (다음 sync)</span></>
                )}
                {lastSyncLabel && <><br />마지막 분류: {lastSyncLabel}</>}
              </p>
            ) : (
              <p className="text-[10px] text-zinc-300 mt-1">
                {lastSyncLabel
                  ? `마지막 분류: ${lastSyncLabel} · 스캔 ${status?.scannedCount ?? 0}건`
                  : "아직 분류 이력 없음 — 위 '재분류' 버튼을 눌러 시작하세요."}
              </p>
            )}
            {status?.fatalError && (
              <div className="mt-2 text-left text-[11px] text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/30 rounded p-2 mx-auto max-w-[320px]">
                <p className="font-semibold">⛔ Anthropic API 호출 차단 (모든 시도 중단됨)</p>
                <p className="opacity-90 mt-1 break-words whitespace-pre-wrap font-mono text-[10px]">
                  {status.fatalError}
                </p>
                <p className="mt-1 opacity-80">
                  → console.anthropic.com 에서 잔액/결제 정보 확인 필요.
                </p>
              </div>
            )}
            {!status?.fatalError && (status?.errorCount ?? 0) > 0 && (
              <div className="mt-2 text-left text-[10px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 rounded p-2 mx-auto max-w-[320px]">
                <p className="font-semibold">⚠ 분류 중 {status?.errorCount}건 실패</p>
                {status?.classificationErrors?.slice(0, 3).map((e, i) => (
                  <p key={i} className="opacity-80 mt-0.5 break-words whitespace-pre-wrap font-mono">{e.error}</p>
                ))}
              </div>
            )}
          </div>
        )}

        <ul className="space-y-0.5">
          {items.map((it) => (
            <li key={it.id} className="group">
              <div className="flex items-start gap-2 px-3 py-2 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                <button
                  onClick={() => setSelected(it)}
                  className="flex items-start gap-2 flex-1 min-w-0 text-left"
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${
                      it.overdue ? "bg-rose-500" : "bg-zinc-300 dark:bg-zinc-600"
                    }`}
                    aria-label={it.overdue ? "24시간 초과" : ""}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-zinc-700 dark:text-zinc-200 truncate">{it.sender}</p>
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">{it.subject}</p>
                    {it.reason && (
                      <p className="text-[10px] text-violet-600 dark:text-violet-400 truncate mt-0.5 italic">
                        ⓘ {it.reason}
                      </p>
                    )}
                  </div>
                </button>
                <span className={`text-[10px] shrink-0 mt-0.5 ${
                  it.overdue ? "text-rose-600 font-semibold" : "text-zinc-400"
                }`}>
                  {it.receivedLabel}
                </span>
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleMarkReplied(it); }}
                    className="text-zinc-300 hover:text-emerald-600 transition p-0.5 sm:opacity-0 sm:group-hover:opacity-100"
                    aria-label="답변 완료로 표시"
                    title="답변 완료 — 위젯에서 숨김"
                  >
                    <Check size={12} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleNotNeeded(it); }}
                    className="text-zinc-300 hover:text-rose-500 transition p-0.5 sm:opacity-0 sm:group-hover:opacity-100"
                    aria-label="답장 불필요로 표시 (다음부터 비슷한 메일 자동 제외)"
                    title="필요없음 — 다음부터 자동 학습"
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>

        {lastSyncLabel && items.length > 0 && (
          <p className="text-[10px] text-zinc-400 text-center mt-2">
            마지막 분류: {lastSyncLabel} · 매시 자동 분류
          </p>
        )}
      </div>

      {selected && (
        <InboxReplyModal
          item={selected}
          onClose={() => setSelected(null)}
          onResolved={() => { setSelected(null); load(); }}
        />
      )}
    </div>
  );
}
