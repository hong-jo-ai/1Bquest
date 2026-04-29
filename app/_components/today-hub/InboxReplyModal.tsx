"use client";

import { useEffect, useState } from "react";
import { X, Send, ExternalLink, CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import type { InboxItem, InboxThreadDetail } from "./types";

interface Props {
  item: InboxItem;
  onClose: () => void;
  onResolved: () => void; // 답장 또는 라벨 제거 성공 시 — 부모에 새로고침 트리거
}

export default function InboxReplyModal({ item, onClose, onResolved }: Props) {
  const [detail,  setDetail]  = useState<InboxThreadDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const [reply,    setReply]    = useState("");
  const [sending,  setSending]  = useState(false);
  const [unlabeling, setUnlabeling] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/today-hub/inbox?accountId=${encodeURIComponent(item.accountId)}&threadId=${encodeURIComponent(item.threadId)}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (!j.ok) {
          setError(j.error ?? "스레드 조회 실패");
        } else {
          setDetail(j.thread);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [item.accountId, item.threadId]);

  const sendReply = async () => {
    if (!reply.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/today-hub/inbox", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ accountId: item.accountId, threadId: item.threadId, body: reply }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error ?? "전송 실패");
      onResolved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  const markDone = async () => {
    if (unlabeling) return;
    setUnlabeling(true);
    setError(null);
    try {
      const res = await fetch("/api/today-hub/inbox", {
        method:  "DELETE",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ accountId: item.accountId, threadId: item.threadId }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error ?? "라벨 제거 실패");
      onResolved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUnlabeling(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="px-5 py-4 border-b border-zinc-100 dark:border-zinc-800 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-zinc-500 mb-1">{item.sender}{item.senderEmail && ` · ${item.senderEmail}`}</p>
            <h3 className="text-base font-semibold text-zinc-800 dark:text-zinc-100 truncate">
              {item.subject}
            </h3>
            <p className="text-[10px] text-zinc-400 mt-1 tabular-nums">{item.receivedLabel}</p>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 shrink-0"
            aria-label="닫기"
          >
            <X size={18} />
          </button>
        </div>

        {/* 본문 — 스레드 내용 */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 min-h-[200px]">
          {loading && (
            <div className="flex items-center justify-center py-10 gap-2 text-zinc-400">
              <Loader2 size={16} className="animate-spin" />
              <span className="text-sm">스레드 불러오는 중...</span>
            </div>
          )}
          {!loading && error && !detail && (
            <div className="flex items-center gap-2 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-xl px-4 py-3 text-sm">
              <AlertCircle size={14} className="shrink-0" />
              {error}
            </div>
          )}
          {!loading && detail && (
            <>
              {detail.messages.slice(-3).map((m, i) => (
                <div
                  key={i}
                  className={`rounded-lg px-3 py-2 ${
                    m.isOutgoing
                      ? "bg-violet-50 dark:bg-violet-950/30 ml-6"
                      : "bg-zinc-50 dark:bg-zinc-800/50 mr-6"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-[10px] font-semibold ${
                      m.isOutgoing ? "text-violet-600 dark:text-violet-400" : "text-zinc-500"
                    }`}>
                      {m.isOutgoing ? "내가 보냄" : "받음"} · {m.from.replace(/<[^>]+>/g, "").trim() || m.from}
                    </span>
                    <span className="text-[10px] text-zinc-400">{m.date}</span>
                  </div>
                  <pre className="text-xs text-zinc-700 dark:text-zinc-200 whitespace-pre-wrap font-sans break-words">
                    {m.bodyText.slice(0, 1500) || "(본문 없음)"}
                    {m.bodyText.length > 1500 && "\n…"}
                  </pre>
                </div>
              ))}
              {detail.messages.length > 3 && (
                <p className="text-[10px] text-zinc-400 text-center">
                  최근 3개 메시지만 표시 — 전체는 Gmail에서 열기
                </p>
              )}
            </>
          )}
        </div>

        {/* 답장 입력 */}
        <div className="px-5 py-3 border-t border-zinc-100 dark:border-zinc-800">
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="답장 내용..."
            rows={4}
            className="w-full text-sm px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 focus:outline-none focus:border-violet-400 resize-none"
          />
          {error && (
            <p className="text-[11px] text-red-600 dark:text-red-400 mt-2">{error}</p>
          )}
        </div>

        {/* 푸터 — 액션 */}
        <div className="px-5 py-3 border-t border-zinc-100 dark:border-zinc-800 flex items-center gap-2 flex-wrap">
          <a
            href={item.gmailWebUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-semibold text-zinc-600 dark:text-zinc-300 px-3 py-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center gap-1.5"
          >
            <ExternalLink size={12} /> Gmail에서 열기
          </a>
          <button
            onClick={markDone}
            disabled={unlabeling || sending}
            className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 px-3 py-2 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-950/30 disabled:opacity-50 flex items-center gap-1.5"
            title="답장 작성 없이 '답장필요' 라벨만 제거"
          >
            {unlabeling ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
            답장 완료로 표시
          </button>
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="text-xs font-semibold text-zinc-600 dark:text-zinc-300 px-3 py-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            취소
          </button>
          <button
            onClick={sendReply}
            disabled={!reply.trim() || sending || unlabeling}
            className="text-xs font-semibold bg-violet-600 hover:bg-violet-700 text-white px-3 py-2 rounded-lg disabled:opacity-50 transition flex items-center gap-1.5"
          >
            {sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
            답장 보내기
          </button>
        </div>
      </div>
    </div>
  );
}
