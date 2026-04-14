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
  Clock,
  Hash,
  User,
  Inbox as InboxIcon,
} from "lucide-react";
import type {
  CsThread,
  CsMessage,
  CsStatus,
  CsChannel,
  CsBrandId,
} from "@/lib/cs/types";
import { BRAND_LABEL, CHANNEL_LABEL } from "@/lib/cs/types";

// ── 채널별 시각 스타일 ──────────────────────────────────────────────
const CHANNEL_STYLE: Record<
  CsChannel,
  { icon: React.ElementType; color: string; bg: string }
> = {
  gmail: {
    icon: Mail,
    color: "text-red-600 dark:text-red-400",
    bg: "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-900/40",
  },
  threads: {
    icon: AtSign,
    color: "text-zinc-700 dark:text-zinc-300",
    bg: "bg-zinc-100 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700",
  },
  ig_dm: {
    icon: Camera,
    color: "text-pink-600 dark:text-pink-400",
    bg: "bg-pink-50 dark:bg-pink-900/20 border-pink-200 dark:border-pink-900/40",
  },
  ig_comment: {
    icon: Camera,
    color: "text-pink-600 dark:text-pink-400",
    bg: "bg-pink-50 dark:bg-pink-900/20 border-pink-200 dark:border-pink-900/40",
  },
  channeltalk: {
    icon: MessageCircle,
    color: "text-sky-600 dark:text-sky-400",
    bg: "bg-sky-50 dark:bg-sky-900/20 border-sky-200 dark:border-sky-900/40",
  },
  crisp: {
    icon: MessageCircle,
    color: "text-blue-600 dark:text-blue-400",
    bg: "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-900/40",
  },
  kakao_bizchat: {
    icon: MessageCircle,
    color: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-900/40",
  },
  cafe24_board: {
    icon: Store,
    color: "text-orange-600 dark:text-orange-400",
    bg: "bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-900/40",
  },
  sixshop_board: {
    icon: ShoppingBag,
    color: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-900/40",
  },
};

const STATUS_STYLE: Record<CsStatus, string> = {
  unanswered: "bg-red-500 text-white",
  waiting: "bg-amber-500 text-white",
  resolved: "bg-emerald-500 text-white",
  archived: "bg-zinc-400 text-white",
};

const STATUS_LABEL: Record<CsStatus, string> = {
  unanswered: "미답변",
  waiting: "대기중",
  resolved: "해결",
  archived: "보관",
};

const BRAND_COLOR: Record<CsBrandId, string> = {
  paulvice: "from-violet-500 to-fuchsia-500",
  harriot: "from-amber-600 to-stone-800",
};

type BrandFilter = CsBrandId | "all";
type StatusFilter = CsStatus | "all";

interface ThreadDetail {
  thread: CsThread;
  messages: CsMessage[];
}

interface ContextData {
  related: Array<{
    id: string;
    brand: CsBrandId;
    channel: CsChannel;
    subject: string | null;
    last_message_at: string;
    status: CsStatus;
    last_message_preview: string | null;
  }>;
  totalThreads: number;
  firstContact: string;
}

export default function InboxClient() {
  const [threads, setThreads] = useState<CsThread[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("unanswered");
  const [brandFilter, setBrandFilter] = useState<BrandFilter>("all");
  const [channelFilter, setChannelFilter] = useState<CsChannel | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [context, setContext] = useState<ContextData | null>(null);
  const [replyText, setReplyText] = useState("");
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftNote, setDraftNote] = useState<string | null>(null);
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
      if (channelFilter !== "all") params.set("channel", channelFilter);
      const res = await fetch(`/api/cs/threads?${params}`);
      const json = await res.json();
      setThreads(json.threads ?? []);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, brandFilter, channelFilter]);

  const loadDetail = useCallback(async (threadId: string) => {
    const [d, c] = await Promise.all([
      fetch(`/api/cs/threads/${threadId}`).then((r) => r.json()),
      fetch(`/api/cs/threads/${threadId}/context`).then((r) => r.json()),
    ]);
    setDetail(d);
    setContext(c);
    setReplyText("");
    setDraftNote(null);
  }, []);

  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
    else {
      setDetail(null);
      setContext(null);
    }
  }, [selectedId, loadDetail]);

  const triggerSync = async () => {
    setSyncing(true);
    try {
      await Promise.all([
        fetch("/api/cs/ingest/gmail", { method: "POST" }),
        fetch("/api/cs/ingest/threads", { method: "POST" }),
        fetch("/api/cs/ingest/crisp", { method: "POST" }),
        fetch("/api/cs/ingest/instagram", { method: "POST" }),
      ]);
      await loadThreads();
      showToast("동기화 완료");
    } catch {
      showToast("동기화 실패");
    } finally {
      setSyncing(false);
    }
  };

  const reclassifyAll = async () => {
    if (
      !confirm(
        "현재 미답변 스레드를 모두 AI로 다시 분류해서 노이즈를 자동 보관합니다. 계속할까요? (최대 200건)"
      )
    )
      return;
    setReclassifying(true);
    try {
      const res = await fetch("/api/cs/reclassify", { method: "POST" });
      const json = await res.json();
      if (json.ok) {
        showToast(
          `처리 ${json.processed} → 보관 ${json.archived}, 유지 ${json.kept}`
        );
        await loadThreads();
      } else {
        showToast(json.error ?? "재분류 실패");
      }
    } finally {
      setReclassifying(false);
    }
  };

  const generateDraft = async () => {
    if (!selectedId) return;
    setDraftLoading(true);
    setDraftNote(null);
    try {
      const res = await fetch("/api/cs/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: selectedId }),
      });
      const json = await res.json();
      if (json.draft) {
        setReplyText(json.draft);
        setDraftNote(json.rationale ?? null);
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
        setDraftNote(null);
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

  const markNotCs = async (blockSender = false) => {
    if (!selectedId) return;
    const url = `/api/cs/threads/${selectedId}/not-cs${blockSender ? "?blockSender=1" : ""}`;
    const res = await fetch(url, { method: "POST" });
    const json = await res.json();
    if (json.ok) {
      showToast(blockSender && json.blacklisted ? `차단: ${json.blacklisted}` : "보관됨");
      await loadThreads();
      setSelectedId(null);
    } else {
      showToast(json.error ?? "실패");
    }
  };

  const counts = useMemo(() => {
    return {
      unanswered: threads.filter((t) => t.status === "unanswered").length,
      waiting: threads.filter((t) => t.status === "waiting").length,
      resolved: threads.filter((t) => t.status === "resolved").length,
      all: threads.length,
    };
  }, [threads]);

  return (
    <div className="flex h-[calc(100vh-56px)] bg-zinc-50 dark:bg-zinc-950">
      {/* ── 좌측 사이드바: 필터 ───────────────────────────────────── */}
      <aside className="w-56 flex-shrink-0 border-r border-zinc-200 dark:border-zinc-800 overflow-y-auto bg-white dark:bg-zinc-900">
        <div className="p-4 border-b border-zinc-100 dark:border-zinc-800">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <InboxIcon size={16} className="text-violet-600" />
              <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                CS 인박스
              </h2>
            </div>
            <div className="flex items-center gap-0.5">
              <button
                onClick={triggerSync}
                disabled={syncing}
                className="p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 disabled:opacity-50"
                title="동기화"
              >
                <RefreshCw
                  size={13}
                  className={syncing ? "animate-spin" : ""}
                />
              </button>
              <button
                onClick={reclassifyAll}
                disabled={reclassifying}
                className="p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 disabled:opacity-50"
                title="AI 재분류"
              >
                <Filter
                  size={13}
                  className={reclassifying ? "animate-pulse" : ""}
                />
              </button>
              <Link
                href="/inbox/setup"
                className="p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500"
                title="설정"
              >
                <Settings size={13} />
              </Link>
            </div>
          </div>
        </div>

        <nav className="p-3 space-y-0.5">
          {(
            [
              { key: "unanswered", label: "미답변", count: counts.unanswered },
              { key: "waiting", label: "대기중", count: counts.waiting },
              { key: "resolved", label: "해결됨", count: counts.resolved },
              { key: "all", label: "전체", count: counts.all },
            ] as { key: StatusFilter; label: string; count: number }[]
          ).map(({ key, label, count }) => (
            <button
              key={key}
              onClick={() => setStatusFilter(key)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition ${
                statusFilter === key
                  ? "bg-violet-50 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300 font-medium"
                  : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800"
              }`}
            >
              <span>{label}</span>
              {count > 0 && (
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                    key === "unanswered" && statusFilter !== key
                      ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
                      : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="p-3 border-t border-zinc-100 dark:border-zinc-800">
          <div className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide mb-2 px-2">
            브랜드
          </div>
          {(["all", "paulvice", "harriot"] as BrandFilter[]).map((b) => (
            <button
              key={b}
              onClick={() => setBrandFilter(b)}
              className={`w-full text-left px-3 py-1.5 rounded-lg text-sm mb-0.5 flex items-center gap-2 ${
                brandFilter === b
                  ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-medium"
                  : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
              }`}
            >
              {b !== "all" && (
                <span
                  className={`w-2 h-2 rounded-full bg-gradient-to-br ${BRAND_COLOR[b as CsBrandId]}`}
                />
              )}
              {b === "all" ? "전체 브랜드" : BRAND_LABEL[b as CsBrandId]}
            </button>
          ))}
        </div>

        <div className="p-3 border-t border-zinc-100 dark:border-zinc-800">
          <div className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide mb-2 px-2">
            채널
          </div>
          {(
            [
              "all",
              "gmail",
              "ig_dm",
              "threads",
              "crisp",
              "cafe24_board",
              "sixshop_board",
            ] as (CsChannel | "all")[]
          ).map((c) => {
            const Icon = c !== "all" ? CHANNEL_STYLE[c as CsChannel].icon : Hash;
            return (
              <button
                key={c}
                onClick={() => setChannelFilter(c)}
                className={`w-full text-left px-3 py-1.5 rounded-lg text-sm mb-0.5 flex items-center gap-2 ${
                  channelFilter === c
                    ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-medium"
                    : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                }`}
              >
                <Icon
                  size={13}
                  className={
                    c !== "all"
                      ? CHANNEL_STYLE[c as CsChannel].color
                      : "text-zinc-400"
                  }
                />
                {c === "all" ? "전체 채널" : CHANNEL_LABEL[c as CsChannel]}
              </button>
            );
          })}
        </div>
      </aside>

      {/* ── 가운데: 대화 목록 ───────────────────────────────────── */}
      <section className="w-[380px] flex-shrink-0 border-r border-zinc-200 dark:border-zinc-800 overflow-y-auto bg-white dark:bg-zinc-900">
        <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 sticky top-0 bg-white dark:bg-zinc-900 z-10">
          <div className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
            {statusFilter === "all"
              ? "전체"
              : STATUS_LABEL[statusFilter as CsStatus]}
            {brandFilter !== "all" && ` · ${BRAND_LABEL[brandFilter as CsBrandId]}`}
          </div>
          <div className="text-xs text-zinc-500 mt-0.5">
            {threads.length}건
          </div>
        </div>

        {loading && threads.length === 0 ? (
          <div className="p-6 text-sm text-zinc-400">로딩 중…</div>
        ) : threads.length === 0 ? (
          <div className="p-12 text-center">
            <InboxIcon size={32} className="text-zinc-300 dark:text-zinc-700 mx-auto mb-2" />
            <div className="text-sm text-zinc-400">표시할 대화가 없습니다</div>
          </div>
        ) : (
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {threads.map((t) => (
              <ThreadListItem
                key={t.id}
                thread={t}
                selected={selectedId === t.id}
                onClick={() => setSelectedId(t.id)}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── 메인: 대화 상세 ───────────────────────────────────── */}
      <section className="flex-1 flex flex-col min-w-0">
        {!detail ? (
          <EmptyDetail />
        ) : (
          <ThreadDetailView
            detail={detail}
            replyText={replyText}
            setReplyText={setReplyText}
            draftLoading={draftLoading}
            draftNote={draftNote}
            sending={sending}
            onDraft={generateDraft}
            onSend={sendReply}
            onResolved={markResolved}
            onNotCs={() => markNotCs(false)}
            onBlockSender={() => markNotCs(true)}
          />
        )}
      </section>

      {/* ── 우측: 컨텍스트 패널 ───────────────────────────────────── */}
      {detail && (
        <aside className="w-[280px] flex-shrink-0 border-l border-zinc-200 dark:border-zinc-800 overflow-y-auto bg-white dark:bg-zinc-900">
          <ContextPanel thread={detail.thread} context={context} />
        </aside>
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 px-4 py-2.5 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm rounded-lg shadow-xl z-50 animate-in fade-in slide-in-from-bottom-2">
          {toast}
        </div>
      )}
    </div>
  );
}

// ── 리스트 항목 ──────────────────────────────────────────────
function ThreadListItem({
  thread,
  selected,
  onClick,
}: {
  thread: CsThread;
  selected: boolean;
  onClick: () => void;
}) {
  const ChannelIcon = CHANNEL_STYLE[thread.channel].icon;
  const channelStyle = CHANNEL_STYLE[thread.channel];
  const name = thread.customer_name || thread.customer_handle || "알 수 없음";
  const isUnanswered = thread.status === "unanswered";

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 transition relative ${
        selected
          ? "bg-violet-50 dark:bg-violet-500/10 border-l-[3px] border-violet-600"
          : "hover:bg-zinc-50 dark:hover:bg-zinc-800/40 border-l-[3px] border-transparent"
      }`}
    >
      <div className="flex gap-3">
        <Avatar name={name} brand={thread.brand} size={36} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-0.5">
            <div
              className={`font-semibold text-sm truncate ${
                isUnanswered
                  ? "text-zinc-900 dark:text-zinc-100"
                  : "text-zinc-700 dark:text-zinc-300"
              }`}
            >
              {name}
            </div>
            <div className="text-[10px] text-zinc-400 flex-shrink-0">
              {formatTime(thread.last_message_at)}
            </div>
          </div>
          {thread.subject && (
            <div className="text-xs font-medium text-zinc-700 dark:text-zinc-400 truncate mb-0.5">
              {thread.subject}
            </div>
          )}
          {thread.last_message_preview && (
            <div className="text-xs text-zinc-500 dark:text-zinc-500 line-clamp-1 mb-1.5">
              {thread.last_message_preview}
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <span
              className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded border ${channelStyle.bg} ${channelStyle.color}`}
            >
              <ChannelIcon size={9} />
              {CHANNEL_LABEL[thread.channel]}
            </span>
            <span className="text-[10px] text-zinc-400">
              · {BRAND_LABEL[thread.brand]}
            </span>
            {isUnanswered && (
              <span className="ml-auto w-1.5 h-1.5 rounded-full bg-red-500" />
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

// ── 대화 상세 뷰 ──────────────────────────────────────────────
function ThreadDetailView({
  detail,
  replyText,
  setReplyText,
  draftLoading,
  draftNote,
  sending,
  onDraft,
  onSend,
  onResolved,
  onNotCs,
  onBlockSender,
}: {
  detail: ThreadDetail;
  replyText: string;
  setReplyText: (v: string) => void;
  draftLoading: boolean;
  draftNote: string | null;
  sending: boolean;
  onDraft: () => void;
  onSend: () => void;
  onResolved: () => void;
  onNotCs: () => void;
  onBlockSender: () => void;
}) {
  const { thread, messages } = detail;
  const ChannelIcon = CHANNEL_STYLE[thread.channel].icon;
  const channelStyle = CHANNEL_STYLE[thread.channel];
  const customerName = thread.customer_name || thread.customer_handle || "알 수 없음";

  return (
    <>
      <header className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Avatar name={customerName} brand={thread.brand} size={44} />
            <div className="min-w-0">
              <div className="text-lg font-bold text-zinc-900 dark:text-zinc-100 truncate">
                {thread.subject || customerName}
              </div>
              <div className="flex items-center gap-2 mt-1 text-xs">
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border font-medium ${channelStyle.bg} ${channelStyle.color}`}
                >
                  <ChannelIcon size={10} />
                  {CHANNEL_LABEL[thread.channel]}
                </span>
                <span className="text-zinc-500">·</span>
                <span className="text-zinc-600 dark:text-zinc-400">
                  {customerName}
                </span>
                {thread.customer_handle &&
                  thread.customer_handle !== customerName && (
                    <span className="text-zinc-400 truncate max-w-[200px]">
                      ({thread.customer_handle})
                    </span>
                  )}
                <span
                  className={`ml-2 text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_STYLE[thread.status]}`}
                >
                  {STATUS_LABEL[thread.status]}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              onClick={onNotCs}
              className="px-3 py-1.5 rounded-md text-xs font-medium bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 flex items-center gap-1"
              title="이 스레드 보관"
            >
              <Ban size={12} />
              CS 아님
            </button>
            <button
              onClick={onBlockSender}
              className="px-2.5 py-1.5 rounded-md text-xs font-medium bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800"
              title="보관 + 송신자 자동 차단"
            >
              송신자 차단
            </button>
            <button
              onClick={onResolved}
              className="px-3 py-1.5 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-300 flex items-center gap-1"
            >
              <Check size={12} />
              해결됨
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5 bg-zinc-50 dark:bg-zinc-950">
        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            customerName={customerName}
            brand={thread.brand}
          />
        ))}
      </div>

      <div className="border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <div className="px-6 py-3 flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800/60">
          <button
            onClick={onDraft}
            disabled={draftLoading}
            className="px-3 py-1.5 rounded-md text-xs font-semibold bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white hover:shadow-md flex items-center gap-1.5 disabled:opacity-50"
          >
            <Sparkles size={12} className={draftLoading ? "animate-pulse" : ""} />
            {draftLoading ? "생성 중…" : "AI 답장 초안"}
          </button>
          {draftNote && (
            <span className="text-[10px] text-zinc-500 truncate ml-3 flex-1">
              💡 {draftNote}
            </span>
          )}
        </div>
        <div className="p-4">
          <textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="답장 내용을 입력하거나 AI 초안을 생성하세요…"
            rows={5}
            className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none"
          />
          <div className="flex justify-between items-center mt-2">
            <span className="text-[11px] text-zinc-400">
              {replyText.length > 0 && `${replyText.length}자`}
            </span>
            <button
              onClick={onSend}
              disabled={sending || !replyText.trim()}
              className="px-5 py-2 rounded-md text-sm font-semibold bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 flex items-center gap-1.5"
            >
              <Send size={13} />
              {sending ? "전송 중…" : "전송"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── 메시지 버블 ──────────────────────────────────────────────
function MessageBubble({
  message,
  customerName,
  brand,
}: {
  message: CsMessage;
  customerName: string;
  brand: CsBrandId;
}) {
  const isOut = message.direction === "out";
  const senderName = isOut ? BRAND_LABEL[brand] : customerName;

  return (
    <div className={`flex gap-3 ${isOut ? "flex-row-reverse" : ""}`}>
      <Avatar
        name={senderName}
        brand={brand}
        size={32}
        self={isOut}
      />
      <div
        className={`flex-1 min-w-0 max-w-[75%] ${isOut ? "items-end flex flex-col" : ""}`}
      >
        <div className="flex items-baseline gap-2 mb-1">
          <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            {senderName}
          </span>
          <span className="text-[10px] text-zinc-400">
            {formatTime(message.sent_at, { verbose: true })}
          </span>
        </div>
        <div
          className={`rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap break-words shadow-sm ${
            isOut
              ? "bg-violet-600 text-white rounded-tr-sm"
              : "bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-800 rounded-tl-sm"
          }`}
        >
          {message.body_text || "(빈 메시지)"}
        </div>
      </div>
    </div>
  );
}

// ── 빈 상세 상태 ──────────────────────────────────────────────
function EmptyDetail() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-100 to-fuchsia-100 dark:from-violet-900/30 dark:to-fuchsia-900/30 flex items-center justify-center mb-4">
        <InboxIcon size={28} className="text-violet-600 dark:text-violet-400" />
      </div>
      <h3 className="text-base font-semibold text-zinc-800 dark:text-zinc-200 mb-1">
        대화를 선택하세요
      </h3>
      <p className="text-sm text-zinc-500 dark:text-zinc-500 max-w-sm">
        왼쪽 목록에서 대화를 클릭하면 내용을 확인하고 답장할 수 있어요.
      </p>
    </div>
  );
}

// ── 우측 컨텍스트 패널 ──────────────────────────────────────────────
function ContextPanel({
  thread,
  context,
}: {
  thread: CsThread;
  context: ContextData | null;
}) {
  const customerName = thread.customer_name || thread.customer_handle || "알 수 없음";

  return (
    <div className="p-5">
      <div className="flex flex-col items-center text-center mb-5">
        <Avatar name={customerName} brand={thread.brand} size={64} />
        <div className="mt-3 font-bold text-zinc-900 dark:text-zinc-100">
          {customerName}
        </div>
        {thread.customer_handle &&
          thread.customer_handle !== customerName && (
            <div className="text-xs text-zinc-500 mt-0.5 break-all">
              {thread.customer_handle}
            </div>
          )}
      </div>

      <div className="space-y-3 mb-5 pb-5 border-b border-zinc-100 dark:border-zinc-800">
        <InfoRow
          icon={Hash}
          label="총 대화"
          value={`${context?.totalThreads ?? 1}건`}
        />
        <InfoRow
          icon={Clock}
          label="첫 문의"
          value={
            context?.firstContact
              ? new Date(context.firstContact).toLocaleDateString("ko-KR")
              : "—"
          }
        />
        <InfoRow
          icon={User}
          label="브랜드"
          value={BRAND_LABEL[thread.brand]}
        />
      </div>

      {context?.related && context.related.length > 0 ? (
        <div>
          <div className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide mb-2">
            과거 대화 ({context.related.length})
          </div>
          <div className="space-y-2">
            {context.related.map((r) => {
              const RI = CHANNEL_STYLE[r.channel].icon;
              return (
                <div
                  key={r.id}
                  className="p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/50"
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <RI
                      size={10}
                      className={CHANNEL_STYLE[r.channel].color}
                    />
                    <span className="text-[10px] text-zinc-500">
                      {CHANNEL_LABEL[r.channel]}
                    </span>
                    <span className="text-[10px] text-zinc-400 ml-auto">
                      {formatTime(r.last_message_at)}
                    </span>
                  </div>
                  <div className="text-xs font-medium text-zinc-800 dark:text-zinc-200 truncate">
                    {r.subject || "(제목 없음)"}
                  </div>
                  {r.last_message_preview && (
                    <div className="text-[11px] text-zinc-500 line-clamp-1 mt-0.5">
                      {r.last_message_preview}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="text-xs text-zinc-400 text-center py-4">
          이전 대화 이력이 없습니다
        </div>
      )}
    </div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2 text-xs text-zinc-500">
        <Icon size={12} />
        {label}
      </div>
      <span className="text-xs font-medium text-zinc-800 dark:text-zinc-200">
        {value}
      </span>
    </div>
  );
}

// ── Avatar ──────────────────────────────────────────────
function Avatar({
  name,
  brand,
  size = 40,
  self = false,
}: {
  name: string;
  brand: CsBrandId;
  size?: number;
  self?: boolean;
}) {
  const initial = (name || "?").trim().charAt(0).toUpperCase();
  const gradient = self
    ? BRAND_COLOR[brand]
    : stringGradient(name);

  return (
    <div
      className={`flex-shrink-0 rounded-full bg-gradient-to-br ${gradient} flex items-center justify-center text-white font-bold shadow-sm`}
      style={{
        width: size,
        height: size,
        fontSize: Math.floor(size * 0.4),
      }}
    >
      {initial}
    </div>
  );
}

const GRADIENTS = [
  "from-rose-400 to-red-500",
  "from-orange-400 to-amber-500",
  "from-yellow-400 to-orange-500",
  "from-green-400 to-emerald-500",
  "from-teal-400 to-cyan-500",
  "from-sky-400 to-blue-500",
  "from-blue-400 to-indigo-500",
  "from-indigo-400 to-violet-500",
  "from-violet-400 to-purple-500",
  "from-fuchsia-400 to-pink-500",
];

function stringGradient(s: string): string {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) | 0;
  }
  return GRADIENTS[Math.abs(hash) % GRADIENTS.length];
}

// ── 시간 포맷 ──────────────────────────────────────────────
function formatTime(
  iso: string,
  opts: { verbose?: boolean } = {}
): string {
  const d = new Date(iso);
  const now = Date.now();
  const diff = now - d.getTime();
  const min = Math.floor(diff / 60000);

  if (opts.verbose) {
    if (min < 1) return "방금";
    if (min < 60) return `${min}분 전`;
    return d.toLocaleString("ko-KR", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  if (min < 1) return "방금";
  if (min < 60) return `${min}분`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}일`;
  return d.toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
}
