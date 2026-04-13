"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Mail,
  AtSign,
  MessageCircle,
  Camera,
  Store,
  ShoppingBag,
  RefreshCw,
  Sparkles,
  Send,
  Check,
  Settings,
  Ban,
  Filter,
} from "lucide-react";
import type {
  CsThread,
  CsMessage,
  CsStatus,
  CsChannel,
  CsBrandId,
} from "@/lib/cs/types";
import { BRAND_LABEL, CHANNEL_LABEL } from "@/lib/cs/types";

const CHANNEL_ICON: Record<CsChannel, React.ElementType> = {
  gmail: Mail,
  threads: AtSign,
  ig_dm: Camera,
  ig_comment: Camera,
  channeltalk: MessageCircle,
  kakao_bizchat: MessageCircle,
  cafe24_board: Store,
  sixshop_board: ShoppingBag,
};

const STATUS_STYLE: Record<CsStatus, string> = {
  unanswered: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  waiting: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
  resolved: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  archived: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

const STATUS_LABEL: Record<CsStatus, string> = {
  unanswered: "미답변",
  waiting: "대기중",
  resolved: "해결됨",
  archived: "보관",
};

type BrandFilter = CsBrandId | "all";
type StatusFilter = CsStatus | "all";

interface ThreadDetail {
  thread: CsThread;
  messages: CsMessage[];
}

export default function InboxClient() {
  const [threads, setThreads] = useState<CsThread[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("unanswered");
  const [brandFilter, setBrandFilter] = useState<BrandFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [replyText, setReplyText] = useState("");
  const [draftLoading, setDraftLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [reclassifying, setReclassifying] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const loadThreads = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (brandFilter !== "all") params.set("brand", brandFilter);
      const res = await fetch(`/api/cs/threads?${params}`);
      const json = await res.json();
      setThreads(json.threads ?? []);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, brandFilter]);

  const loadDetail = useCallback(async (threadId: string) => {
    const res = await fetch(`/api/cs/threads/${threadId}`);
    const json = await res.json();
    setDetail(json);
    setReplyText("");
  }, []);

  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
    else setDetail(null);
  }, [selectedId, loadDetail]);

  const triggerSync = async () => {
    setSyncing(true);
    try {
      await Promise.all([
        fetch("/api/cs/ingest/gmail", { method: "POST" }),
        fetch("/api/cs/ingest/threads", { method: "POST" }),
      ]);
      await loadThreads();
      showToast("동기화 완료");
    } catch {
      showToast("동기화 실패");
    } finally {
      setSyncing(false);
    }
  };

  const generateDraft = async () => {
    if (!selectedId) return;
    setDraftLoading(true);
    try {
      const res = await fetch("/api/cs/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: selectedId }),
      });
      const json = await res.json();
      if (json.draft) {
        setReplyText(json.draft);
      } else {
        showToast(json.error ?? "초안 생성 실패");
      }
    } finally {
      setDraftLoading(false);
    }
  };

  const sendReply = async () => {
    if (!selectedId || !replyText.trim()) return;
    setSending(true);
    try {
      const res = await fetch("/api/cs/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: selectedId, body: replyText }),
      });
      const json = await res.json();
      if (json.ok) {
        setReplyText("");
        await loadDetail(selectedId);
        await loadThreads();
        showToast("답장 전송 완료");
      } else {
        showToast(json.error ?? "전송 실패");
      }
    } finally {
      setSending(false);
    }
  };

  const markResolved = async () => {
    if (!selectedId) return;
    await fetch(`/api/cs/threads/${selectedId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "resolved" }),
    });
    await loadThreads();
    setSelectedId(null);
    showToast("해결됨으로 표시");
  };

  const reclassifyAll = async () => {
    if (
      !confirm(
        "현재 미답변 스레드를 모두 AI로 다시 분류해서 노이즈를 자동 보관합니다. 계속할까요? (최대 200건, ~30초 소요)"
      )
    )
      return;
    setReclassifying(true);
    try {
      const res = await fetch("/api/cs/reclassify", { method: "POST" });
      const json = await res.json();
      if (json.ok) {
        showToast(
          `처리 ${json.processed} → 보관 ${json.archived}, 유지 ${json.kept}${json.failed ? `, 실패 ${json.failed}` : ""}`
        );
        await loadThreads();
      } else {
        showToast(json.error ?? "재분류 실패");
      }
    } finally {
      setReclassifying(false);
    }
  };

  const markNotCs = async (blockSender = false) => {
    if (!selectedId) return;
    const url = `/api/cs/threads/${selectedId}/not-cs${blockSender ? "?blockSender=1" : ""}`;
    const res = await fetch(url, { method: "POST" });
    const json = await res.json();
    if (json.ok) {
      showToast(
        blockSender && json.blacklisted
          ? `보관 + 송신자 차단: ${json.blacklisted}`
          : "보관됨"
      );
      await loadThreads();
      setSelectedId(null);
    } else {
      showToast(json.error ?? "실패");
    }
  };

  const unansweredCount = useMemo(
    () => threads.filter((t) => t.status === "unanswered").length,
    [threads]
  );

  return (
    <div className="flex h-[calc(100vh-56px)]">
      {/* 좌측 필터 */}
      <aside className="w-52 flex-shrink-0 border-r border-zinc-200 dark:border-zinc-800 p-4 overflow-y-auto bg-white dark:bg-zinc-900">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
            CS 인박스
          </h2>
          <div className="flex items-center gap-1">
            <button
              onClick={triggerSync}
              disabled={syncing}
              className="p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 disabled:opacity-50"
              title="새로고침 / 채널 동기화"
            >
              <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
            </button>
            <button
              onClick={reclassifyAll}
              disabled={reclassifying}
              className="p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 disabled:opacity-50"
              title="AI로 미답변 전체 재분류 (노이즈 정리)"
            >
              <Filter size={14} className={reclassifying ? "animate-pulse" : ""} />
            </button>
            <Link
              href="/inbox/setup"
              className="p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500"
              title="채널 연결 설정"
            >
              <Settings size={14} />
            </Link>
          </div>
        </div>

        {unansweredCount > 0 && (
          <div className="mb-4 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/40">
            <div className="text-[11px] text-red-600 dark:text-red-400 font-medium">
              미답변
            </div>
            <div className="text-xl font-bold text-red-700 dark:text-red-300">
              {unansweredCount}건
            </div>
          </div>
        )}

        <div className="mb-4">
          <div className="text-[11px] font-semibold text-zinc-400 uppercase mb-2">
            상태
          </div>
          {(["unanswered", "waiting", "resolved", "all"] as StatusFilter[]).map(
            (s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`block w-full text-left px-2 py-1.5 rounded text-sm mb-0.5 ${
                  statusFilter === s
                    ? "bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-300 font-medium"
                    : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                }`}
              >
                {s === "all" ? "전체" : STATUS_LABEL[s as CsStatus]}
              </button>
            )
          )}
        </div>

        <div>
          <div className="text-[11px] font-semibold text-zinc-400 uppercase mb-2">
            브랜드
          </div>
          {(["all", "paulvice", "harriot"] as BrandFilter[]).map((b) => (
            <button
              key={b}
              onClick={() => setBrandFilter(b)}
              className={`block w-full text-left px-2 py-1.5 rounded text-sm mb-0.5 ${
                brandFilter === b
                  ? "bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-300 font-medium"
                  : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800"
              }`}
            >
              {b === "all" ? "전체" : BRAND_LABEL[b as CsBrandId]}
            </button>
          ))}
        </div>
      </aside>

      {/* 가운데 목록 */}
      <section className="w-96 flex-shrink-0 border-r border-zinc-200 dark:border-zinc-800 overflow-y-auto bg-white dark:bg-zinc-900">
        {loading && threads.length === 0 ? (
          <div className="p-6 text-sm text-zinc-400">로딩 중…</div>
        ) : threads.length === 0 ? (
          <div className="p-6 text-sm text-zinc-400">
            표시할 대화가 없습니다.
          </div>
        ) : (
          threads.map((t) => {
            const Icon = CHANNEL_ICON[t.channel] ?? Mail;
            const isSelected = selectedId === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setSelectedId(t.id)}
                className={`w-full text-left px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 ${
                  isSelected ? "bg-violet-50 dark:bg-violet-500/10" : ""
                }`}
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Icon size={13} className="text-zinc-400 flex-shrink-0" />
                    <span className="text-[11px] text-zinc-500 truncate">
                      {BRAND_LABEL[t.brand]} · {CHANNEL_LABEL[t.channel]}
                    </span>
                  </div>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${STATUS_STYLE[t.status]}`}
                  >
                    {STATUS_LABEL[t.status]}
                  </span>
                </div>
                <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                  {t.customer_name || t.customer_handle || "알 수 없음"}
                </div>
                {t.subject && (
                  <div className="text-xs text-zinc-600 dark:text-zinc-400 truncate mt-0.5">
                    {t.subject}
                  </div>
                )}
                {t.last_message_preview && (
                  <div className="text-xs text-zinc-500 dark:text-zinc-500 line-clamp-2 mt-1">
                    {t.last_message_preview}
                  </div>
                )}
                <div className="text-[10px] text-zinc-400 mt-1">
                  {formatTime(t.last_message_at)}
                </div>
              </button>
            );
          })
        )}
      </section>

      {/* 우측 상세 */}
      <section className="flex-1 flex flex-col min-w-0 bg-zinc-50 dark:bg-zinc-950">
        {!detail ? (
          <div className="flex-1 flex items-center justify-center text-sm text-zinc-400">
            왼쪽에서 대화를 선택하세요.
          </div>
        ) : (
          <>
            <header className="px-5 py-3 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-center justify-between">
              <div className="min-w-0">
                <div className="text-[11px] text-zinc-500">
                  {BRAND_LABEL[detail.thread.brand]} ·{" "}
                  {CHANNEL_LABEL[detail.thread.channel]}
                </div>
                <div className="text-sm font-bold text-zinc-900 dark:text-zinc-100 truncate">
                  {detail.thread.subject || detail.thread.customer_name || "대화"}
                </div>
                <div className="text-xs text-zinc-500">
                  {detail.thread.customer_name} ({detail.thread.customer_handle})
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => markNotCs(false)}
                  className="px-3 py-1.5 rounded-md text-xs font-medium bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 flex items-center gap-1"
                  title="이 스레드 보관"
                >
                  <Ban size={13} />
                  CS 아님
                </button>
                <button
                  onClick={() => markNotCs(true)}
                  className="px-2 py-1.5 rounded-md text-xs font-medium bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-500"
                  title="보관 + 이 송신자 앞으로 차단 (스팸·마케팅용)"
                >
                  송신자 차단
                </button>
                <button
                  onClick={markResolved}
                  className="px-3 py-1.5 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-300 flex items-center gap-1"
                >
                  <Check size={13} />
                  해결됨
                </button>
              </div>
            </header>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {detail.messages.map((m) => (
                <div
                  key={m.id}
                  className={`max-w-[80%] ${
                    m.direction === "out" ? "ml-auto" : ""
                  }`}
                >
                  <div
                    className={`rounded-2xl px-4 py-2.5 text-sm ${
                      m.direction === "out"
                        ? "bg-violet-600 text-white"
                        : "bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-800"
                    }`}
                  >
                    <div className="whitespace-pre-wrap break-words">
                      {m.body_text || "(빈 메시지)"}
                    </div>
                  </div>
                  <div
                    className={`text-[10px] text-zinc-400 mt-1 ${
                      m.direction === "out" ? "text-right" : ""
                    }`}
                  >
                    {formatTime(m.sent_at)}
                  </div>
                </div>
              ))}
            </div>

            <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
              <div className="flex items-center justify-between mb-2">
                <button
                  onClick={generateDraft}
                  disabled={draftLoading}
                  className="px-3 py-1.5 rounded-md text-xs font-medium bg-violet-50 text-violet-700 hover:bg-violet-100 dark:bg-violet-500/10 dark:text-violet-300 flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Sparkles size={13} className={draftLoading ? "animate-pulse" : ""} />
                  {draftLoading ? "초안 생성 중…" : "AI 초안 생성"}
                </button>
                <span className="text-[10px] text-zinc-400">
                  cs-responder 스킬 사용
                </span>
              </div>
              <textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="답장을 입력하거나 AI 초안을 생성하세요…"
                rows={6}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
              <div className="flex justify-end mt-2">
                <button
                  onClick={sendReply}
                  disabled={sending || !replyText.trim()}
                  className="px-4 py-2 rounded-md text-sm font-medium bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 flex items-center gap-1.5"
                >
                  <Send size={14} />
                  {sending ? "전송 중…" : "전송"}
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      {toast && (
        <div className="fixed bottom-4 right-4 px-4 py-2 bg-zinc-900 text-white text-sm rounded-lg shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diff = now - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}일 전`;
  return d.toLocaleDateString("ko-KR", {
    month: "short",
    day: "numeric",
  });
}
