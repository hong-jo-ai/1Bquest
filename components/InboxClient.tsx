"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  ArrowLeft,
  MoreVertical,
  Menu as MenuIcon,
  X,
  RotateCcw,
  Wrench,
  CalendarClock,
} from "lucide-react";
import AsIntakeForm from "@/components/AsIntakeForm";
import PromiseForm from "@/components/PromiseForm";
import type { CsPromise } from "@/lib/cs/promises";
import type {
  CsThread,
  CsMessage,
  CsStatus,
  CsChannel,
  CsBrandId,
  CsReturn,
} from "@/lib/cs/types";
import { BRAND_LABEL, CHANNEL_LABEL, CLAIM_TYPE_LABEL, RETURN_STATUS_LABEL } from "@/lib/cs/types";

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
  webchat: {
    icon: MessageCircle,
    color: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-900/40",
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
  reddit: {
    icon: MessageCircle,
    color: "text-orange-600 dark:text-orange-400",
    bg: "bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-900/40",
  },
  sixshop: {
    icon: ShoppingBag,
    color: "text-violet-600 dark:text-violet-400",
    bg: "bg-violet-50 dark:bg-violet-900/20 border-violet-200 dark:border-violet-900/40",
  },
  wconcept: {
    icon: ShoppingBag,
    color: "text-zinc-800 dark:text-zinc-200",
    bg: "bg-zinc-100 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700",
  },
  musinsa: {
    icon: ShoppingBag,
    color: "text-zinc-900 dark:text-zinc-100",
    bg: "bg-zinc-200/70 dark:bg-zinc-700/40 border-zinc-400 dark:border-zinc-600",
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

/**
 * 인스타 댓글이 **어느 게시물에 달렸는지** 보여주는 카드.
 * 그전엔 제목 자리에 permalink URL 만 있어서 눌러서 인스타로 나가기 전엔 알 수 없었다
 * (사장님 지적 2026-09-01). 썸네일 + 캡션 + 원문 링크를 대화 맨 위에 붙인다.
 */
function IgPostCard({ messages, brand }: { messages: CsMessage[]; brand: string }) {
  const post = messages
    .map((m) => (m.raw as { post?: { id?: string; permalink?: string; caption?: string; mediaType?: string; timestamp?: string } } | null)?.post)
    .find((p) => p?.id);
  if (!post?.id) return null;

  const caption = (post.caption ?? "").replace(/\s+/g, " ").trim();
  const when = post.timestamp
    ? new Date(post.timestamp).toLocaleDateString("ko-KR", { month: "long", day: "numeric" })
    : null;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex gap-3 p-3">
        {/* 썸네일은 서명 URL 이라 저장해두면 만료된다 → 볼 때마다 프록시가 새로 받아온다. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/cs/instagram/media?id=${encodeURIComponent(post.id)}&brand=${encodeURIComponent(brand)}`}
          alt=""
          className="h-20 w-20 flex-shrink-0 rounded-lg object-cover bg-zinc-100 dark:bg-zinc-800"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
            <Camera className="h-3 w-3" />
            <span>이 게시물의 댓글</span>
            {when && <span>· {when}</span>}
            {post.mediaType === "VIDEO" && <span>· 영상</span>}
          </div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-zinc-700 line-clamp-3 dark:text-zinc-300">
            {caption || "(캡션 없음)"}
          </p>
          {post.permalink && (
            <a
              href={post.permalink}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1.5 inline-block text-[11px] font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              인스타그램에서 열기 ↗
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

interface ThreadDetail {
  thread: CsThread;
  messages: CsMessage[];
  csReturn?: CsReturn | null;
  csPromises?: CsPromise[] | null;
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
  orderHistory?: {
    phone: string | null;
    totalOrders: number;
    channels: string[];
    firstOrderDate: string | null;
    lastOrderDate: string | null;
    orders: Array<{
      channel: string;
      orderNumber: string;
      productName: string;
      qty: number | null;
      date: string | null;
      tracking: string | null;
      status: string | null;
      reqType: string;
      matchedBy: "phone" | "name";
    }>;
    nameOnlyCount: number;
  } | null;
  /** PAULVICE CARE 등록 여부 — 배터리 무료 1회가 남았는지 상담 중 즉시 확인 */
  care?: {
    registered: boolean;
    phone: string;
    products: Array<{ productNo: number | null; name: string | null; registeredAt: string }>;
    registeredAt: string | null;
    batteryFree: boolean;
    batteryUsedAt: string | null;
    adConsent: boolean;
    couponCode: string | null;
    channel: string | null;
    matchedBy: "handle" | "orders";
  } | null;
}

/**
 * CARE 배지 — 등록 고객이면 무조건 눈에 띄어야 한다.
 * 배터리 무료가 남았는지까지 배지 하나로 끝낸다(상담 중 다시 뒤지지 않도록).
 * 미등록이면 아무것도 그리지 않는다 — 배지가 흔해지면 안 보게 된다.
 */
function CareBadge({ care, compact }: { care: ContextData["care"]; compact?: boolean }) {
  if (!care?.registered) return null;
  const free = care.batteryFree;
  return (
    <span
      title={
        (free ? "배터리 교체 1회 무료 가능 (작업 무료, 보내는 택배비만 고객 부담)" : `배터리 무료 1회 사용함 (${care.batteryUsedAt?.slice(0, 10)})`)
        + (care.matchedBy === "orders" ? " · 주문 전화번호로 매칭" : "")
      }
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
        free
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
          : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
      }`}
    >
      CARE{free ? " · 배터리 무료" : " · 배터리 사용함"}
      {!compact && care.matchedBy === "orders" && <span className="font-normal opacity-60">추정</span>}
    </span>
  );
}

export default function InboxClient() {
  const [threads, setThreads] = useState<CsThread[]>([]);
  const [counts, setCounts] = useState({
    unanswered: 0,
    waiting: 0,
    resolved: 0,
    archived: 0,
    all: 0,
  });
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("unanswered");
  const [brandFilter, setBrandFilter] = useState<BrandFilter>("all");
  const [channelFilter, setChannelFilter] = useState<CsChannel | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [context, setContext] = useState<ContextData | null>(null);
  const [replyText, setReplyText] = useState("");
  const [operatorNotes, setOperatorNotes] = useState("");
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftNote, setDraftNote] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [reclassifying, setReclassifying] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);
  const [mobileContextOpen, setMobileContextOpen] = useState(false);
  const [asFormOpen, setAsFormOpen] = useState(false);
  const [promiseFormOpen, setPromiseFormOpen] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const completePromise = async (id: string) => {
    try {
      const res = await fetch("/api/cs/promises", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: "done" }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "처리 실패");
      if (selectedId) await refreshDetail(selectedId);
      showToast("약속을 완료 처리했습니다");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "약속 처리 실패");
    }
  };

  const loadCounts = useCallback(async () => {
    const params = new URLSearchParams();
    if (brandFilter !== "all") params.set("brand", brandFilter);
    if (channelFilter !== "all") params.set("channel", channelFilter);
    try {
      const res = await fetch(`/api/cs/threads/counts?${params}`);
      const json = await res.json();
      if (json.counts) setCounts(json.counts);
    } catch {
      // 카운트 실패는 치명적이지 않음 — 목록은 그대로
    }
  }, [brandFilter, channelFilter]);

  const loadThreads = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (brandFilter !== "all") params.set("brand", brandFilter);
      if (channelFilter !== "all") params.set("channel", channelFilter);
      const [res] = await Promise.all([
        fetch(`/api/cs/threads?${params}`),
        loadCounts(),
      ]);
      const json = await res.json();
      setThreads(json.threads ?? []);
      setLastRefresh(new Date());
    } finally {
      setLoading(false);
    }
  }, [statusFilter, brandFilter, channelFilter, loadCounts]);

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

  // 열린 스레드를 주기적으로 새로고침해 새 고객 메시지를 바로 보여준다.
  // loadDetail 과 달리 작성 중인 답장(replyText)·초안 메모는 건드리지 않는다.
  const refreshDetail = useCallback(async (threadId: string) => {
    try {
      const [d, c] = await Promise.all([
        fetch(`/api/cs/threads/${threadId}`).then((r) => r.json()),
        fetch(`/api/cs/threads/${threadId}/context`).then((r) => r.json()),
      ]);
      if (d) setDetail(d);
      if (c) setContext(c);
    } catch {
      // 일시적 네트워크 오류는 다음 틱에서 회복
    }
  }, []);

  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const threadId = params.get("thread");
    if (threadId && /^[0-9a-f-]{36}$/i.test(threadId)) {
      setSelectedId(threadId);
    }
  }, []);

  // 자동 동기화 — 탭 포커스 시 60초, 백그라운드에서는 쉼
  // 실시간 채널(IG DM, Crisp)은 서버 webhook으로 즉시 ingest되므로
  // 클라이언트는 목록만 빠르게 폴링하면 됨
  useEffect(() => {
    const FAST_INTERVAL_MS = 60 * 1000; // 1분

    const fastTick = async () => {
      if (document.hidden) return;
      await loadThreads(); // ingest는 서버 cron과 webhook이 담당
    };

    const id = setInterval(fastTick, FAST_INTERVAL_MS);

    const onVisible = () => {
      if (!document.hidden && Date.now() - lastRefresh.getTime() > 30 * 1000) {
        fastTick();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadThreads]);

  // 열린 스레드 실시간 갱신 — 새 고객 메시지가 새로고침 없이 바로 보이도록 15초마다 폴링.
  useEffect(() => {
    if (!selectedId) return;
    const id = setInterval(() => {
      if (document.hidden) return;
      refreshDetail(selectedId);
    }, 15 * 1000);
    return () => clearInterval(id);
  }, [selectedId, refreshDetail]);

  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
    else {
      setDetail(null);
      setContext(null);
      setMobileContextOpen(false);
    }
    // 다른 스레드로 전환할 때 운영자 메모 초기화 (이전 스레드 메모가 새 초안에 영향 주지 않도록)
    setOperatorNotes("");
    setDraftNote(null);
  }, [selectedId, loadDetail]);

  // 모바일에서 상세가 열려있을 때 기기 뒤로가기 버튼으로 목록 복귀
  useEffect(() => {
    if (!selectedId) return;
    history.pushState({ csInboxDetail: selectedId }, "");
    const onPop = () => setSelectedId(null);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [selectedId]);

  const triggerSync = async () => {
    setSyncing(true);
    try {
      await Promise.all([
        fetch("/api/cs/ingest/gmail", { method: "POST" }),
        fetch("/api/cs/ingest/threads", { method: "POST" }),
        fetch("/api/cs/ingest/crisp", { method: "POST" }),
        fetch("/api/cs/ingest/instagram", { method: "POST" }),
        fetch("/api/cs/ingest/cafe24", { method: "POST" }),
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
        body: JSON.stringify({
          threadId: selectedId,
          operatorNotes: operatorNotes.trim() || undefined,
        }),
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
        setOperatorNotes("");
        setDraftNote(null);
        await loadDetail(selectedId);
        await loadThreads();
        showToast("답장 전송 완료");
      } else {
        showToast(json.error ?? "전송 실패");
      }
    } catch (e) {
      // catch 가 없어서 fetch·JSON 파싱이 터지면 **아무 표시 없이** 조용히 끝났다.
      // 전송 실패를 모르고 넘어가는 게 가장 나쁜 경우다 (2026-09-01).
      showToast(`전송 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSending(false);
    }
  };

  // AS 접수 후: 해당 CS 건을 대기중으로 이동(물건 도착 대기).
  // 반품/교환 카드는 스레드 상태가 클레임 상태에서 자동 계산되므로,
  // 클레임을 회수중(in_transit=대기중)으로 올려야 재동기화에도 대기중이 유지됨.
  // 일반 문의는 스레드 상태만 직접 대기중으로 PATCH.
  const moveThreadToWaiting = async (d: ThreadDetail) => {
    try {
      if (d.thread.item_type === "return") {
        await fetch(`/api/cs/returns/${d.thread.id}/action`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "waiting" }),
        });
      } else {
        await fetch(`/api/cs/threads/${d.thread.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "waiting" }),
        });
      }
    } catch {
      // 대기중 이동 실패는 치명적이지 않음 — AS 접수 자체는 등록됨
    }
    await loadThreads();
    if (selectedId) await loadDetail(selectedId);
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

  // 반품 액션(회수 도착/완료/거부) — iMac 워커가 식스샵에 처리. 완료까지 대기 후 새로고침.
  const [returnBusy, setReturnBusy] = useState<string | null>(null);
  const onReturnAction = async (action: string) => {
    if (!selectedId) return;
    setReturnBusy(action);
    try {
      const res = await fetch(`/api/cs/returns/${selectedId}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "처리 실패");
      showToast(data.message || "처리 완료 — 식스샵 반영됨");
      await loadThreads();
      await loadDetail(selectedId);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "처리 실패");
    } finally {
      setReturnBusy(null);
    }
  };

  // 해결 취소 / 보관 되돌리기 — 다시 처리할 거리로 미답변 복귀.
  const reopenThread = async (toastMsg: string) => {
    if (!selectedId) return;
    await fetch(`/api/cs/threads/${selectedId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "unanswered" }),
    });
    await loadThreads();
    await loadDetail(selectedId);
    showToast(toastMsg);
  };

  const markNotCs = async (blockSender = false) => {
    if (!selectedId) return;
    const url = `/api/cs/threads/${selectedId}/not-cs${blockSender ? "?blockSender=1" : ""}`;
    const res = await fetch(url, { method: "POST" });
    const json = await res.json();
    if (json.ok) {
      showToast(json.blacklisted ? `보관 + 차단: ${json.blacklisted}` : "보관됨 (학습)");
      await loadThreads();
      setSelectedId(null);
    } else {
      showToast(json.error ?? "실패");
    }
  };

  return (
    <>
      {/* ════════════════════════════════════════════════════════════
          모바일 (<md): 단일 화면 흐름 (목록 ↔ 상세 전체화면 오버레이)
          ════════════════════════════════════════════════════════════ */}
      <div className="md:hidden flex flex-col h-[calc(100dvh-56px)] bg-zinc-50 dark:bg-zinc-950">
        {/* Top App Bar */}
        <div className="flex-shrink-0 flex items-center gap-1 px-3 h-12 bg-white dark:bg-zinc-900 border-b border-zinc-100 dark:border-zinc-800">
          <Link
            href="/"
            className="grid size-9 -ml-1 shrink-0 place-items-center rounded-lg text-zinc-700 active:bg-zinc-100 dark:text-zinc-300 dark:active:bg-zinc-800"
            aria-label="대시보드로 돌아가기"
            title="대시보드로 돌아가기"
          >
            <ArrowLeft size={18} />
          </Link>
          <button
            onClick={() => setMobileFilterOpen(true)}
            className="p-2 rounded-lg active:bg-zinc-100 dark:active:bg-zinc-800"
            aria-label="필터 열기"
          >
            <MenuIcon size={20} className="text-zinc-700 dark:text-zinc-300" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="text-base font-bold text-zinc-900 dark:text-zinc-100 truncate">
              CS 인박스
            </div>
            <div className="text-[10px] text-zinc-500 -mt-0.5">
              {threads.length}건 · {formatRelative(lastRefresh)}
            </div>
          </div>
          <button
            onClick={triggerSync}
            disabled={syncing}
            className="p-2 rounded-lg active:bg-zinc-100 dark:active:bg-zinc-800 disabled:opacity-50"
            aria-label="동기화"
          >
            <RefreshCw
              size={18}
              className={`text-zinc-700 dark:text-zinc-300 ${syncing ? "animate-spin" : ""}`}
            />
          </button>
        </div>

        {/* 상태 칩 (가로 스크롤) */}
        <div className="flex-shrink-0 flex gap-2 px-3 py-2.5 overflow-x-auto bg-white dark:bg-zinc-900 border-b border-zinc-100 dark:border-zinc-800 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {(
            [
              { key: "unanswered", label: "미답변", count: counts.unanswered, accent: "red" },
              { key: "waiting", label: "대기중", count: counts.waiting, accent: "amber" },
              { key: "resolved", label: "해결됨", count: counts.resolved, accent: "emerald" },
              { key: "all", label: "전체", count: counts.all, accent: "zinc" },
              { key: "archived", label: "보관", count: counts.archived, accent: "zinc" },
            ] as { key: StatusFilter; label: string; count: number; accent: string }[]
          ).map(({ key, label, count }) => {
            const active = statusFilter === key;
            return (
              <button
                key={key}
                onClick={() => setStatusFilter(key)}
                className={`flex-shrink-0 inline-flex items-center gap-1.5 px-3.5 h-9 rounded-full text-sm font-medium transition ${
                  active
                    ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900"
                    : "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
                }`}
              >
                {label}
                {count > 0 && (
                  <span
                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                      active
                        ? "bg-white/20 text-white dark:bg-zinc-900/20 dark:text-zinc-900"
                        : key === "unanswered"
                          ? "bg-red-500 text-white"
                          : "bg-zinc-300 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200"
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* 스레드 카드 리스트 */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2.5">
          {loading && threads.length === 0 ? (
            <div className="p-8 text-center text-sm text-zinc-400">로딩 중…</div>
          ) : threads.length === 0 ? (
            <div className="p-12 text-center">
              <InboxIcon size={36} className="text-zinc-300 dark:text-zinc-700 mx-auto mb-2" />
              <div className="text-sm text-zinc-400">표시할 대화가 없습니다</div>
            </div>
          ) : (
            threads.map((t) => (
              <MobileThreadCard
                key={t.id}
                thread={t}
                onClick={() => setSelectedId(t.id)}
              />
            ))
          )}
        </div>

        {/* 필터 드로어 */}
        {mobileFilterOpen && (
          <MobileFilterDrawer
            brandFilter={brandFilter}
            channelFilter={channelFilter}
            onBrand={setBrandFilter}
            onChannel={setChannelFilter}
            onReclassify={reclassifyAll}
            reclassifying={reclassifying}
            onClose={() => setMobileFilterOpen(false)}
          />
        )}
      </div>

      {/* 모바일 상세 오버레이 */}
      {selectedId && (
        <div className="md:hidden fixed inset-0 z-40 bg-zinc-50 dark:bg-zinc-950 flex flex-col overflow-x-hidden">
          {detail ? (
            <MobileThreadDetailView
              detail={detail}
              context={context}
              contextOpen={mobileContextOpen}
              onToggleContext={() => setMobileContextOpen((v) => !v)}
              replyText={replyText}
              setReplyText={setReplyText}
              operatorNotes={operatorNotes}
              setOperatorNotes={setOperatorNotes}
              draftLoading={draftLoading}
              draftNote={draftNote}
              sending={sending}
              onBack={() => setSelectedId(null)}
              onDraft={generateDraft}
              onSend={sendReply}
              onResolved={markResolved}
              onReopen={() => reopenThread("미답변으로 되돌림")}
              onNotCs={() => markNotCs(false)}
              onBlockSender={() => markNotCs(true)}
              onCreateAs={() => setAsFormOpen(true)}
              onCreatePromise={() => setPromiseFormOpen(true)}
              onPromiseDone={completePromise}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-zinc-400">
              로딩 중…
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════
          데스크톱 (≥md): 기존 3컬럼 레이아웃
          ════════════════════════════════════════════════════════════ */}
      <div className="max-md:hidden md:flex h-[calc(100vh-56px)] bg-zinc-50 dark:bg-zinc-950">
      {/* ── 좌측 사이드바: 필터 ───────────────────────────────────── */}
      <aside className="w-48 flex-shrink-0 border-r border-zinc-200 dark:border-zinc-800 overflow-y-auto bg-white dark:bg-zinc-900">
        <div className="p-4 border-b border-zinc-100 dark:border-zinc-800">
          <div className="flex items-center justify-between gap-1 mb-3">
            <div className="flex items-center gap-1.5 min-w-0">
              <InboxIcon size={16} className="text-violet-600 shrink-0" />
              <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 whitespace-nowrap">
                CS 인박스
              </h2>
            </div>
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                onClick={triggerSync}
                disabled={syncing}
                className="p-1 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 disabled:opacity-50"
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
                className="p-1 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 disabled:opacity-50"
                title="AI 재분류"
              >
                <Filter
                  size={13}
                  className={reclassifying ? "animate-pulse" : ""}
                />
              </button>
              <Link
                href="/inbox/setup"
                className="p-1 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500"
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
              { key: "archived", label: "보관", count: counts.archived },
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
              "webchat",
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
      <section className="w-[340px] flex-shrink-0 border-r border-zinc-200 dark:border-zinc-800 overflow-y-auto bg-white dark:bg-zinc-900">
        <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 sticky top-0 bg-white dark:bg-zinc-900 z-10">
          <div className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
            {statusFilter === "all"
              ? "전체"
              : STATUS_LABEL[statusFilter as CsStatus]}
            {brandFilter !== "all" && ` · ${BRAND_LABEL[brandFilter as CsBrandId]}`}
          </div>
          <div className="text-xs text-zinc-500 mt-0.5 flex items-center gap-2">
            <span>{threads.length}건</span>
            <span className="text-zinc-300 dark:text-zinc-700">·</span>
            <span>
              마지막 갱신 {formatRelative(lastRefresh)}
              <span className="text-zinc-400 ml-1">(1분마다 자동)</span>
            </span>
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
            context={context}
            replyText={replyText}
            setReplyText={setReplyText}
            operatorNotes={operatorNotes}
            setOperatorNotes={setOperatorNotes}
            draftLoading={draftLoading}
            draftNote={draftNote}
            sending={sending}
            onDraft={generateDraft}
            onSend={sendReply}
            onResolved={markResolved}
            onReopen={() => reopenThread("미답변으로 되돌림")}
            onNotCs={() => markNotCs(false)}
            onBlockSender={() => markNotCs(true)}
            onCreateAs={() => setAsFormOpen(true)}
            onCreatePromise={() => setPromiseFormOpen(true)}
            onPromiseDone={completePromise}
            returnBusy={returnBusy}
            onReturnAction={onReturnAction}
          />
        )}
      </section>

      {/* ── 우측: 컨텍스트 패널 ───────────────────────────────────── */}
      {detail && (
        <aside className="w-[280px] flex-shrink-0 border-l border-zinc-200 dark:border-zinc-800 overflow-y-auto bg-white dark:bg-zinc-900">
          <ContextPanel thread={detail.thread} context={context} />
        </aside>
      )}

      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 md:left-auto md:translate-x-0 md:right-6 px-4 py-2.5 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm rounded-lg shadow-xl z-[60] animate-in fade-in slide-in-from-bottom-2">
          {toast}
        </div>
      )}

      {asFormOpen && detail && (
        <AsIntakeForm
          initial={{
            brand: detail.thread.brand,
            // 반품·취소 → 환불, 교환 → 교환, 그 외 → 수리(기본)로 처리유형 미리 선택
            requestType:
              detail.csReturn?.claim_type === "exchange"
                ? "exchange"
                : detail.csReturn?.claim_type === "return" ||
                    detail.csReturn?.claim_type === "cancel"
                  ? "refund"
                  : undefined,
            // 반품/교환 카드는 고객명·상품명·주문번호가 csReturn 에 있음 → 미리 채움
            customerName: detail.csReturn?.customer_name ?? detail.thread.customer_name,
            channel: CHANNEL_LABEL[detail.thread.channel],
            model: detail.csReturn?.product ?? null,
            symptom: detail.csReturn?.reason ?? null,
            note: detail.csReturn?.order_number
              ? `주문번호: ${detail.csReturn.order_number}`
              : null,
            csThreadId: detail.thread.id,
          }}
          onClose={() => setAsFormOpen(false)}
          onCreated={async () => {
            setAsFormOpen(false);
            await moveThreadToWaiting(detail);
            showToast("AS 접수 등록됨 · 대기중으로 이동 — /as 에서 추적");
          }}
        />
      )}

      {promiseFormOpen && detail && (
        <PromiseForm
          initial={{
            threadId: detail.thread.id,
            customerName: detail.csReturn?.customer_name ?? detail.thread.customer_name,
            customerHandle: detail.thread.customer_handle,
            orderNumber: detail.csReturn?.order_number ?? null,
            seller: CHANNEL_LABEL[detail.thread.channel],
          }}
          onClose={() => setPromiseFormOpen(false)}
          onCreated={async (message) => {
            setPromiseFormOpen(false);
            if (selectedId) await refreshDetail(selectedId);
            showToast(message);
          }}
        />
      )}
    </>
  );
}

/**
 * 약속 배너 — 이 대화에서 한 약속을 대화 맨 위에 붙여 둔다.
 * 답장하러 스레드를 열면 무조건 눈에 들어와야 해서 메시지 위, 헤더 바로 아래에 둔다.
 */
function PromiseBanner({
  promises,
  onDone,
}: {
  promises: CsPromise[];
  onDone: (id: string) => void;
}) {
  return (
    <div className="px-5 py-2.5 border-b border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/30 space-y-1.5">
      {promises.map((p) => (
        <div key={p.id} className="flex items-start gap-2 text-xs">
          <CalendarClock size={13} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <span className="font-semibold text-amber-900 dark:text-amber-200">약속</span>
            <span className="text-amber-900 dark:text-amber-100"> · {p.text}</span>
            {(p.dueOn || p.orderNumber) && (
              <span className="text-amber-700/80 dark:text-amber-400/80">
                {p.dueOn ? ` · 마감 ${p.dueOn}` : ""}
                {p.orderNumber ? ` · 주문 ${p.orderNumber}` : ""}
              </span>
            )}
          </div>
          <button
            onClick={() => onDone(p.id)}
            className="shrink-0 px-2 py-0.5 rounded-md font-medium text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40"
            title="약속 이행 완료로 표시"
          >
            완료
          </button>
        </div>
      ))}
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
  context,
  replyText,
  setReplyText,
  operatorNotes,
  setOperatorNotes,
  draftLoading,
  draftNote,
  sending,
  onDraft,
  onSend,
  onResolved,
  onReopen,
  onNotCs,
  onBlockSender,
  onCreateAs,
  onCreatePromise,
  onPromiseDone,
  returnBusy,
  onReturnAction,
}: {
  detail: ThreadDetail;
  context: ContextData | null;
  replyText: string;
  setReplyText: (v: string) => void;
  operatorNotes: string;
  setOperatorNotes: (v: string) => void;
  draftLoading: boolean;
  draftNote: string | null;
  sending: boolean;
  onDraft: () => void;
  onSend: () => void;
  onResolved: () => void;
  onReopen: () => void;
  onNotCs: () => void;
  onBlockSender: () => void;
  onCreateAs: () => void;
  onCreatePromise: () => void;
  onPromiseDone: (id: string) => void;
  returnBusy?: string | null;
  onReturnAction?: (action: string) => void;
}) {
  const { thread, messages, csReturn } = detail;
  const openPromises = (detail.csPromises ?? []).filter((p) => p.status !== "done");
  const ChannelIcon = CHANNEL_STYLE[thread.channel].icon;
  const channelStyle = CHANNEL_STYLE[thread.channel];

  // 새 메시지(내 답변 포함)가 추가되면 대화 영역을 맨 아래로 자동 스크롤.
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const lastMessageId = messages[messages.length - 1]?.id;
  useEffect(() => {
    const el = messagesScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, lastMessageId]);
  const customerName = thread.customer_name || thread.customer_handle || "알 수 없음";
  const isReturn = thread.item_type === "return";

  return (
    <>
      <header className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <Avatar name={customerName} brand={thread.brand} size={40} />
            <div className="min-w-0 flex-1">
              <div className="text-base font-bold text-zinc-900 dark:text-zinc-100 truncate leading-snug">
                {thread.subject || customerName}
              </div>
              {/* 배지/메타 정보 — flex-wrap 으로 좁은 화면에서 줄바꿈 */}
              <div className="flex items-center flex-wrap gap-x-2 gap-y-1 mt-1 text-xs">
                <span
                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border font-medium ${channelStyle.bg} ${channelStyle.color}`}
                >
                  <ChannelIcon size={10} />
                  {CHANNEL_LABEL[thread.channel]}
                </span>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_STYLE[thread.status]}`}
                >
                  {STATUS_LABEL[thread.status]}
                </span>
                <CareBadge care={context?.care} />
                <span className="text-zinc-600 dark:text-zinc-400 truncate max-w-[160px]">
                  {customerName}
                </span>
                {thread.customer_handle &&
                  thread.customer_handle !== customerName && (
                    <span className="text-zinc-400 truncate max-w-[180px]">
                      ({thread.customer_handle})
                    </span>
                  )}
              </div>
            </div>
          </div>
          {/* 액션 버튼 — 좁은 폭에서는 아이콘만 보이도록 (lg 이상에서 라벨 표시) */}
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={onCreatePromise}
              className="p-1.5 lg:px-2.5 lg:py-1.5 rounded-md text-xs font-medium bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-900/20 dark:text-amber-300 flex items-center gap-1"
              title="이 대화에서 한 약속을 저장 — 지정한 날 알림 + 출고 화면 경고"
            >
              <CalendarClock size={12} />
              <span className="max-lg:hidden lg:inline">약속</span>
            </button>
            <button
              onClick={onCreateAs}
              className="p-1.5 lg:px-2.5 lg:py-1.5 rounded-md text-xs font-medium bg-violet-50 text-violet-700 hover:bg-violet-100 dark:bg-violet-900/20 dark:text-violet-300 flex items-center gap-1"
              title="이 대화로 AS 수리 접수 만들기"
            >
              <Wrench size={12} />
              <span className="max-lg:hidden lg:inline">AS 접수</span>
            </button>
            {thread.status === "archived" ? (
              <button
                onClick={onReopen}
                className="p-1.5 lg:px-2.5 lg:py-1.5 rounded-md text-xs font-medium bg-violet-50 text-violet-700 hover:bg-violet-100 dark:bg-violet-900/20 dark:text-violet-300 flex items-center gap-1"
                title="보관 해제 — 미답변으로 되돌리기"
              >
                <RotateCcw size={12} />
                <span className="max-lg:hidden lg:inline">되돌리기</span>
              </button>
            ) : (
              <>
                <button
                  onClick={onNotCs}
                  className="p-1.5 lg:px-2.5 lg:py-1.5 rounded-md text-xs font-medium bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 flex items-center gap-1"
                  title="이 스레드 보관 (CS 아님 학습)"
                >
                  <Ban size={12} />
                  <span className="max-lg:hidden lg:inline">CS 아님</span>
                </button>
                <button
                  onClick={onBlockSender}
                  className="p-1.5 lg:px-2.5 lg:py-1.5 rounded-md text-xs font-medium bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800"
                  title="보관 + 송신자 자동 차단"
                  aria-label="송신자 차단"
                >
                  <Ban size={12} className="lg:hidden" />
                  <span className="max-lg:hidden lg:inline">송신자 차단</span>
                </button>
                {thread.status === "resolved" ? (
                  <button
                    onClick={onReopen}
                    className="p-1.5 lg:px-2.5 lg:py-1.5 rounded-md text-xs font-medium bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-900/20 dark:text-amber-300 flex items-center gap-1"
                    title="해결 취소 — 미답변으로 되돌리기"
                  >
                    <RotateCcw size={12} />
                    <span className="max-lg:hidden lg:inline">해결 취소</span>
                  </button>
                ) : (
                  <button
                    onClick={onResolved}
                    className="p-1.5 lg:px-2.5 lg:py-1.5 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-300 flex items-center gap-1"
                    title="해결됨으로 표시"
                  >
                    <Check size={12} />
                    <span className="max-lg:hidden lg:inline">해결됨</span>
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </header>

      {openPromises.length > 0 && <PromiseBanner promises={openPromises} onDone={onPromiseDone} />}

      <div ref={messagesScrollRef} className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden px-6 py-6 space-y-5 bg-zinc-50 dark:bg-zinc-950">
        {thread.channel === "ig_comment" && <IgPostCard messages={messages} brand={thread.brand} />}
        {isReturn ? (
          <div className="max-w-md mx-auto rounded-xl border border-violet-200 dark:border-violet-900/40 bg-violet-50/50 dark:bg-violet-950/20 p-5 space-y-1.5 text-sm">
            <div className="font-semibold text-zinc-800 dark:text-zinc-200">{thread.subject || "반품/교환"}</div>
            <div className="text-zinc-600 dark:text-zinc-400">고객: {customerName}</div>
            {csReturn && <div className="text-zinc-600 dark:text-zinc-400">주문번호: {csReturn.order_number}</div>}
            <div className="text-zinc-600 dark:text-zinc-400">
              상태: {csReturn ? `${CLAIM_TYPE_LABEL[csReturn.claim_type]} · ${RETURN_STATUS_LABEL[csReturn.status]}` : thread.last_message_preview}
            </div>
            {csReturn?.reason && <div className="text-zinc-600 dark:text-zinc-400">사유: {csReturn.reason}</div>}
          </div>
        ) : (
          messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              customerName={customerName}
              brand={thread.brand}
            />
          ))
        )}
      </div>

      {isReturn ? (
        <div className="border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
          {csReturn && (csReturn.status === "done" || csReturn.status === "rejected") ? (
            <div className="text-center text-xs text-zinc-500">처리 완료됨 · {RETURN_STATUS_LABEL[csReturn.status]}</div>
          ) : csReturn && csReturn.channel === "wconcept" ? (
            // W컨셉: 회수는 자동, 택배 도착 후 '회수 완료' 단일 처리
            <div className="flex items-center justify-center">
              <button onClick={() => onReturnAction?.("complete")} disabled={!!returnBusy}
                className="px-5 py-2 rounded-lg text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
                {returnBusy ? "처리 중…" : "회수 완료"}
              </button>
            </div>
          ) : csReturn ? (
            <div className="flex items-center gap-2 justify-center flex-wrap">
              {csReturn.status === "requested" ? (
                // 신청 단계: 우체국 반품 회수 접수 → 대기중(택배 도착까지 알람 끔)
                <button onClick={() => onReturnAction?.("pickup")} disabled={!!returnBusy}
                  className="px-4 py-2 rounded-lg text-sm font-semibold bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50">
                  {returnBusy === "pickup" ? "우체국 접수 중…" : "우체국 회수 접수"}
                </button>
              ) : (
                <>
                  <button onClick={() => onReturnAction?.("received")} disabled={!!returnBusy}
                    className="px-4 py-2 rounded-lg text-sm font-semibold bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50">
                    {returnBusy === "received" ? "처리 중…" : "회수 도착 확인"}
                  </button>
                  <button onClick={() => onReturnAction?.("complete")} disabled={!!returnBusy}
                    className="px-4 py-2 rounded-lg text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
                    {returnBusy === "complete" ? "처리 중…" : `${CLAIM_TYPE_LABEL[csReturn.claim_type]} 완료`}
                  </button>
                </>
              )}
              <button onClick={() => onReturnAction?.("reject")} disabled={!!returnBusy}
                className="px-4 py-2 rounded-lg text-sm font-medium border border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50">
                {returnBusy === "reject" ? "처리 중…" : "거부"}
              </button>
            </div>
          ) : (
            <div className="text-center text-xs text-zinc-500">반품 정보를 불러오는 중…</div>
          )}
          <p className="text-center text-[11px] text-zinc-400 mt-2">
            {csReturn?.status === "requested"
              ? "우체국에 반품 회수를 접수하고 대기중으로 이동합니다 (~10초). 택배 도착 후 회수 도착 확인을 누르세요."
              : "버튼을 누르면 식스샵에 자동 반영됩니다(처리 ~20초)"}
          </p>
        </div>
      ) : (
      <div className="border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <div className="px-6 py-3 border-b border-zinc-100 dark:border-zinc-800/60">
          <textarea
            value={operatorNotes}
            onChange={(e) => setOperatorNotes(e.target.value)}
            placeholder="AI 에게 줄 메모 (선택) — 핵심 정보만 짧게: 예) 각인 한글 가능, 5자 제한 / 7월 발송 예정 / 환불 가능"
            rows={2}
            className="w-full px-3 py-2 text-xs rounded-md border border-amber-200 dark:border-amber-900/40 bg-amber-50/40 dark:bg-amber-950/20 text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-amber-400 resize-none"
          />
          <div className="flex items-center justify-between mt-2">
            <button
              onClick={onDraft}
              disabled={draftLoading}
              className="px-3 py-1.5 rounded-md text-xs font-semibold bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white hover:shadow-md flex items-center gap-1.5 disabled:opacity-50"
            >
              <Sparkles size={12} className={draftLoading ? "animate-pulse" : ""} />
              {draftLoading ? "생성 중…" : operatorNotes.trim() ? "메모 반영해서 작성" : "AI 답장 초안"}
            </button>
            {draftNote && (
              <span className="text-[10px] text-zinc-500 truncate ml-3 flex-1 text-right">
                💡 {draftNote}
              </span>
            )}
          </div>
        </div>
        <div className="p-4">
          <textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            onKeyDown={(e) => {
              // ⌘/Ctrl + Enter 로 전송
              if (
                (e.metaKey || e.ctrlKey) &&
                e.key === "Enter" &&
                !e.nativeEvent.isComposing &&
                !sending &&
                replyText.trim()
              ) {
                e.preventDefault();
                onSend();
              }
            }}
            placeholder="답장 내용을 입력하거나 AI 초안을 생성하세요… (⌘/Ctrl+Enter 전송)"
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
      )}
    </>
  );
}

// ── 메시지 버블 ──────────────────────────────────────────────
/** 메시지 raw 에서 카페24 상품 정보 추출 (cafe24_board 채널의 게시판 글에 첨부됨) */
function extractCafe24Product(raw: unknown): {
  productNo: number;
  name?: string;
  imageUrl?: string | null;
  productCode?: string;
} | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as { cafe24Product?: unknown };
  const p = obj.cafe24Product;
  if (!p || typeof p !== "object") return null;
  const ref = p as {
    productNo?: number;
    name?: string;
    imageUrl?: string | null;
    productCode?: string;
  };
  if (typeof ref.productNo !== "number" || ref.productNo <= 0) return null;
  return {
    productNo:   ref.productNo,
    name:        ref.name,
    imageUrl:    ref.imageUrl,
    productCode: ref.productCode,
  };
}

/** 메시지 raw 에서 첨부(고객이 올린 사진 등) 추출 — cafe24 게시판 attach_file_urls 유래. */
function extractAttachments(raw: unknown): Array<{ url: string; name?: string; isImage: boolean }> {
  if (!raw || typeof raw !== "object") return [];
  const list = (raw as { attachments?: unknown }).attachments;
  if (!Array.isArray(list)) return [];
  return list.flatMap((a) => {
    if (!a || typeof a !== "object") return [];
    const { url, name, isImage } = a as { url?: unknown; name?: unknown; isImage?: unknown };
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return [];
    return [{
      url,
      name: typeof name === "string" ? name : undefined,
      isImage: isImage === true,
    }];
  });
}

/**
 * 첨부 렌더 — 사진은 썸네일, 그 외는 파일 링크. 클릭하면 원본을 새 탭에서 연다.
 * 이게 없으면 사장님이 인박스를 보고도 사진 때문에 카페24 관리자를 또 열어야 한다.
 */
function AttachmentStrip({ items }: { items: Array<{ url: string; name?: string; isImage: boolean }> }) {
  if (!items.length) return null;
  const images = items.filter((a) => a.isImage);
  const files = items.filter((a) => !a.isImage);

  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {images.map((a) => (
            <a
              key={a.url}
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
              title={a.name ?? "첨부 사진"}
              className="block rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-700 hover:opacity-90 transition-opacity"
            >
              <img
                src={a.url}
                alt={a.name ?? "첨부 사진"}
                loading="lazy"
                className="w-28 h-28 object-cover bg-zinc-100 dark:bg-zinc-800"
              />
            </a>
          ))}
        </div>
      )}
      {files.map((a) => (
        <a
          key={a.url}
          href={a.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 hover:underline"
        >
          📎 {a.name ?? "첨부파일"}
        </a>
      ))}
    </div>
  );
}

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
  const product = !isOut ? extractCafe24Product(message.raw) : null;
  // 첨부는 방향 무관 — 고객 원글·댓글 양쪽에 붙을 수 있다.
  const attachments = extractAttachments(message.raw);

  return (
    <div className={`flex gap-3 min-w-0 ${isOut ? "flex-row-reverse" : ""}`}>
      <Avatar
        name={senderName}
        brand={brand}
        size={32}
        self={isOut}
      />
      <div
        className={`min-w-0 max-w-[calc(100%-44px)] ${isOut ? "items-end flex flex-col" : ""}`}
      >
        <div className="flex items-baseline gap-2 mb-1">
          <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            {senderName}
          </span>
          <span className="text-[10px] text-zinc-400">
            {formatTime(message.sent_at, { verbose: true })}
          </span>
        </div>

        {/* 카페24 상품 문의의 경우 — 어떤 상품에 대한 문의인지 즉시 식별 */}
        {product && (
          <div className="mb-1.5 inline-flex items-center gap-2 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 px-2.5 py-1.5 max-w-full">
            {product.imageUrl ? (
              <img
                src={product.imageUrl}
                alt={product.name ?? `상품 ${product.productNo}`}
                className="w-10 h-10 rounded-md object-cover bg-zinc-100 dark:bg-zinc-800 shrink-0"
                loading="lazy"
              />
            ) : (
              <div className="w-10 h-10 rounded-md bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center text-[9px] text-zinc-400 shrink-0">
                IMG
              </div>
            )}
            <div className="min-w-0">
              <p className="text-[10px] font-semibold text-amber-700 dark:text-amber-300 leading-none mb-0.5">상품 문의</p>
              <p className="text-xs font-medium text-zinc-800 dark:text-zinc-200 truncate">
                {product.name ?? `상품 #${product.productNo}`}
              </p>
              {product.productCode && (
                <p className="text-[10px] text-zinc-500 truncate tabular-nums">{product.productCode}</p>
              )}
            </div>
          </div>
        )}

        <div
          className={`max-w-full rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap [overflow-wrap:anywhere] shadow-sm ${
            isOut
              ? "bg-violet-600 text-white rounded-tr-sm"
              : "bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-800 rounded-tl-sm"
          }`}
        >
          {message.body_text || "(빈 메시지)"}
        </div>

        {/* 고객이 올린 사진 — 게시판 문의의 상당수가 사진으로 증상을 보낸다 */}
        <AttachmentStrip items={attachments} />
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

      {context?.care?.registered && (
        <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-800/60 dark:bg-emerald-900/20">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">PAULVICE CARE</span>
            <span className="text-[10px] text-emerald-600/70 dark:text-emerald-400/70">
              {context.care.registeredAt?.slice(0, 10)} 등록
            </span>
          </div>
          <div className={`text-[13px] font-bold ${context.care.batteryFree ? "text-emerald-700 dark:text-emerald-300" : "text-zinc-500"}`}>
            {context.care.batteryFree ? "배터리 교체 1회 무료 사용 가능" : `배터리 무료 사용함 (${context.care.batteryUsedAt?.slice(0, 10)})`}
          </div>
          {context.care.batteryFree && (
            <div className="mt-0.5 text-[11px] text-emerald-700/70 dark:text-emerald-400/70">
              작업 무료 · 보내주시는 택배비만 고객 부담
            </div>
          )}
          {context.care.products.length > 0 && (
            <div className="mt-1.5 text-[11px] text-zinc-600 dark:text-zinc-400">
              등록 제품: {context.care.products.map((p) => p.name ?? "제품미상").join(", ")}
            </div>
          )}
          {context.care.matchedBy === "orders" && (
            <div className="mt-1 text-[10px] text-amber-600 dark:text-amber-400">
              ⚠️ 문의에 번호가 없어 과거 주문 전화번호로 매칭했습니다 — 안내 전 본인 확인 권장
            </div>
          )}
          {context.care.batteryFree && (
            <button
              onClick={async () => {
                if (!confirm("배터리 무료 1회를 사용 처리할까요? 실제로 접수했을 때만 누르세요.")) return;
                await fetch("/api/cs/care/use-battery", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ phone: context.care!.phone }),
                });
                location.reload();
              }}
              className="mt-2 w-full rounded-lg border border-emerald-300 bg-white px-2 py-1.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:bg-transparent dark:text-emerald-300"
            >
              무료 교체 접수함 — 1회 사용 처리
            </button>
          )}
        </div>
      )}

      {context?.orderHistory && context.orderHistory.totalOrders > 0 && (
        <div className="mb-5 pb-5 border-b border-zinc-100 dark:border-zinc-800">
          <OrderHistorySection oh={context.orderHistory} />
        </div>
      )}

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

// ── 고객 구매 이력 (모든 채널 pp_shipments 매칭) ──────────────────
function OrderHistorySection({
  oh,
  compact = false,
}: {
  oh: NonNullable<ContextData["orderHistory"]>;
  compact?: boolean;
}) {
  if (!oh || oh.totalOrders === 0) {
    return (
      <div className="text-xs text-zinc-400 text-center py-3">
        매칭된 구매 이력이 없습니다
      </div>
    );
  }
  const limit = compact ? 5 : 14;
  return (
    <div>
      <div className="flex items-center justify-between mb-2 gap-2">
        <div className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide">
          구매 이력 ({oh.totalOrders})
        </div>
        <div className="text-[10px] text-zinc-400 truncate">
          {oh.channels.join(" · ")}
        </div>
      </div>
      <div className="space-y-2">
        {oh.orders.slice(0, limit).map((o) => (
          <div
            key={`${o.channel}-${o.orderNumber}-${o.reqType}`}
            className="p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/50"
          >
            <div className="flex items-center gap-1.5 mb-1 flex-wrap">
              <span className="text-[10px] font-medium text-zinc-600 dark:text-zinc-300">
                {o.channel}
              </span>
              {o.reqType === "2" && (
                <span className="text-[9px] px-1 rounded bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
                  반품
                </span>
              )}
              {o.matchedBy === "name" && (
                <span className="text-[9px] px-1 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                  이름매칭
                </span>
              )}
              <span className="text-[10px] text-zinc-400 ml-auto">
                {o.date ? new Date(o.date).toLocaleDateString("ko-KR") : ""}
              </span>
            </div>
            <div className="text-xs font-medium text-zinc-800 dark:text-zinc-200 line-clamp-2">
              {o.productName || "(상품명 없음)"}
            </div>
            <div className="text-[11px] text-zinc-500 mt-0.5">
              {o.qty ? `${o.qty}개` : ""}
              {o.qty && (o.tracking || o.orderNumber) ? " · " : ""}
              {o.tracking ? `송장 ${o.tracking}` : `주문 ${o.orderNumber}`}
            </div>
          </div>
        ))}
      </div>
      {oh.orders.length > limit && (
        <div className="text-[10px] text-zinc-400 mt-2 text-center">
          외 {oh.orders.length - limit}건 더
        </div>
      )}
      {oh.nameOnlyCount > 0 && (
        <div className="text-[10px] text-amber-600 dark:text-amber-400 mt-2 leading-snug">
          ※ 이름만 일치한 {oh.nameOnlyCount}건 포함 — 동일인 여부 확인
        </div>
      )}
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

function formatRelative(d: Date): string {
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  return d.toLocaleDateString("ko-KR");
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

// ════════════════════════════════════════════════════════════════════
// 모바일 전용 컴포넌트
// ════════════════════════════════════════════════════════════════════

function MobileThreadCard({
  thread,
  onClick,
}: {
  thread: CsThread;
  onClick: () => void;
}) {
  const ChannelIcon = CHANNEL_STYLE[thread.channel].icon;
  const channelStyle = CHANNEL_STYLE[thread.channel];
  const name = thread.customer_name || thread.customer_handle || "알 수 없음";
  const isUnanswered = thread.status === "unanswered";

  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-white dark:bg-zinc-900 rounded-2xl p-4 shadow-sm active:scale-[0.99] active:bg-zinc-50 dark:active:bg-zinc-800 transition relative overflow-hidden"
    >
      {/* 좌측 브랜드 컬러 스트라이프 */}
      <span
        className={`absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b ${BRAND_COLOR[thread.brand]}`}
      />
      <div className="flex gap-3">
        <Avatar name={name} brand={thread.brand} size={44} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-0.5">
            <div className="font-semibold text-[15px] text-zinc-900 dark:text-zinc-100 truncate">
              {name}
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {isUnanswered && (
                <span className="w-2 h-2 rounded-full bg-red-500" />
              )}
              <span className="text-[11px] text-zinc-400">
                {formatTime(thread.last_message_at)}
              </span>
            </div>
          </div>
          {thread.subject && (
            <div className="text-[13px] font-medium text-zinc-700 dark:text-zinc-300 line-clamp-1 mb-0.5">
              {thread.subject}
            </div>
          )}
          {thread.last_message_preview && (
            <div className="text-[12px] text-zinc-500 dark:text-zinc-500 line-clamp-2 mb-2">
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
          </div>
        </div>
      </div>
    </button>
  );
}

function MobileFilterDrawer({
  brandFilter,
  channelFilter,
  onBrand,
  onChannel,
  onReclassify,
  reclassifying,
  onClose,
}: {
  brandFilter: BrandFilter;
  channelFilter: CsChannel | "all";
  onBrand: (b: BrandFilter) => void;
  onChannel: (c: CsChannel | "all") => void;
  onReclassify: () => void;
  reclassifying: boolean;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex">
      {/* 백드롭 */}
      <div
        onClick={onClose}
        className="absolute inset-0 bg-black/40 animate-in fade-in"
      />
      {/* 드로어 */}
      <div className="relative w-[280px] max-w-[80vw] bg-white dark:bg-zinc-900 flex flex-col animate-in slide-in-from-left-4">
        <div className="flex items-center justify-between px-4 h-12 border-b border-zinc-100 dark:border-zinc-800">
          <div className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
            필터 / 메뉴
          </div>
          <button
            onClick={onClose}
            className="p-2 -mr-2 rounded-lg active:bg-zinc-100 dark:active:bg-zinc-800"
            aria-label="닫기"
          >
            <X size={18} className="text-zinc-700 dark:text-zinc-300" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
          {/* 브랜드 */}
          <div>
            <div className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide mb-2 px-2">
              브랜드
            </div>
            {(["all", "paulvice", "harriot"] as BrandFilter[]).map((b) => (
              <button
                key={b}
                onClick={() => {
                  onBrand(b);
                  onClose();
                }}
                className={`w-full text-left px-3 h-11 rounded-lg text-sm flex items-center gap-2.5 ${
                  brandFilter === b
                    ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-semibold"
                    : "text-zinc-600 dark:text-zinc-400 active:bg-zinc-50 dark:active:bg-zinc-800/60"
                }`}
              >
                {b !== "all" && (
                  <span
                    className={`w-2.5 h-2.5 rounded-full bg-gradient-to-br ${BRAND_COLOR[b as CsBrandId]}`}
                  />
                )}
                {b === "all" ? "전체 브랜드" : BRAND_LABEL[b as CsBrandId]}
              </button>
            ))}
          </div>

          {/* 채널 */}
          <div>
            <div className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide mb-2 px-2">
              채널
            </div>
            {(
              [
                "all",
                "gmail",
                "ig_dm",
                "threads",
                "webchat",
                "crisp",
                "cafe24_board",
                "sixshop_board",
              ] as (CsChannel | "all")[]
            ).map((c) => {
              const Icon = c !== "all" ? CHANNEL_STYLE[c as CsChannel].icon : Hash;
              return (
                <button
                  key={c}
                  onClick={() => {
                    onChannel(c);
                    onClose();
                  }}
                  className={`w-full text-left px-3 h-11 rounded-lg text-sm flex items-center gap-2.5 ${
                    channelFilter === c
                      ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-semibold"
                      : "text-zinc-600 dark:text-zinc-400 active:bg-zinc-50 dark:active:bg-zinc-800/60"
                  }`}
                >
                  <Icon
                    size={15}
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

          {/* 액션 */}
          <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800 space-y-1">
            <button
              onClick={() => {
                onReclassify();
                onClose();
              }}
              disabled={reclassifying}
              className="w-full text-left px-3 h-11 rounded-lg text-sm flex items-center gap-2.5 text-zinc-600 dark:text-zinc-400 active:bg-zinc-50 dark:active:bg-zinc-800/60 disabled:opacity-50"
            >
              <Filter size={15} className={reclassifying ? "animate-pulse" : ""} />
              AI 재분류 (현재 목록)
            </button>
            <Link
              href="/inbox/setup"
              onClick={onClose}
              className="w-full text-left px-3 h-11 rounded-lg text-sm flex items-center gap-2.5 text-zinc-600 dark:text-zinc-400 active:bg-zinc-50 dark:active:bg-zinc-800/60"
            >
              <Settings size={15} />
              인박스 설정
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function MobileThreadDetailView({
  detail,
  context,
  contextOpen,
  onToggleContext,
  replyText,
  setReplyText,
  operatorNotes,
  setOperatorNotes,
  draftLoading,
  draftNote,
  sending,
  onBack,
  onDraft,
  onSend,
  onResolved,
  onReopen,
  onNotCs,
  onBlockSender,
  onCreateAs,
  onCreatePromise,
  onPromiseDone,
}: {
  detail: ThreadDetail;
  context: ContextData | null;
  contextOpen: boolean;
  onToggleContext: () => void;
  replyText: string;
  setReplyText: (v: string) => void;
  operatorNotes: string;
  setOperatorNotes: (v: string) => void;
  draftLoading: boolean;
  draftNote: string | null;
  sending: boolean;
  onBack: () => void;
  onDraft: () => void;
  onSend: () => void;
  onResolved: () => void;
  onReopen: () => void;
  onNotCs: () => void;
  onBlockSender: () => void;
  onCreateAs: () => void;
  onCreatePromise: () => void;
  onPromiseDone: (id: string) => void;
}) {
  const { thread, messages } = detail;
  const openPromises = (detail.csPromises ?? []).filter((p) => p.status !== "done");
  const ChannelIcon = CHANNEL_STYLE[thread.channel].icon;
  const channelStyle = CHANNEL_STYLE[thread.channel];
  const customerName = thread.customer_name || thread.customer_handle || "알 수 없음";

  // 새 메시지(내 답변 포함)가 추가되면 대화 영역을 맨 아래로 자동 스크롤.
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const lastMessageId = messages[messages.length - 1]?.id;
  useEffect(() => {
    const el = messagesScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, lastMessageId]);
  const [actionsOpen, setActionsOpen] = useState(false);

  return (
    <>
      {/* Header */}
      <div className="flex-shrink-0 flex items-center gap-1 px-2 h-12 bg-white dark:bg-zinc-900 border-b border-zinc-100 dark:border-zinc-800">
        <button
          onClick={onBack}
          className="p-2 rounded-lg active:bg-zinc-100 dark:active:bg-zinc-800"
          aria-label="뒤로"
        >
          <ArrowLeft size={20} className="text-zinc-700 dark:text-zinc-300" />
        </button>
        <button
          onClick={onToggleContext}
          className="flex-1 min-w-0 flex items-center gap-2 px-1 py-1 rounded-lg active:bg-zinc-100 dark:active:bg-zinc-800 text-left"
        >
          <Avatar name={customerName} brand={thread.brand} size={32} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-zinc-900 dark:text-zinc-100 truncate">
              {customerName}
            </div>
            <div className="text-[11px] text-zinc-500 truncate flex items-center gap-1">
              <ChannelIcon size={10} className={channelStyle.color} />
              <span>{CHANNEL_LABEL[thread.channel]}</span>
              <span className="text-zinc-400">·</span>
              <span>{BRAND_LABEL[thread.brand]}</span>
              <span
                className={`ml-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full ${STATUS_STYLE[thread.status]}`}
              >
                {STATUS_LABEL[thread.status]}
              </span>
              <CareBadge care={context?.care} compact />
            </div>
          </div>
        </button>
        <button
          onClick={() => setActionsOpen((v) => !v)}
          className="p-2 rounded-lg active:bg-zinc-100 dark:active:bg-zinc-800 relative"
          aria-label="작업"
        >
          <MoreVertical size={20} className="text-zinc-700 dark:text-zinc-300" />
        </button>
        {actionsOpen && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setActionsOpen(false)}
            />
            <div className="absolute top-12 right-2 z-50 bg-white dark:bg-zinc-900 rounded-xl shadow-lg border border-zinc-200 dark:border-zinc-800 py-1 w-48 animate-in fade-in slide-in-from-top-1">
              <button
                onClick={() => {
                  setActionsOpen(false);
                  onCreatePromise();
                }}
                className="w-full text-left px-4 py-2.5 text-sm flex items-center gap-2 text-amber-700 dark:text-amber-400 active:bg-amber-50 dark:active:bg-amber-900/20"
              >
                <CalendarClock size={14} />
                약속 남기기
              </button>
              <button
                onClick={() => {
                  setActionsOpen(false);
                  onCreateAs();
                }}
                className="w-full text-left px-4 py-2.5 text-sm flex items-center gap-2 text-violet-700 dark:text-violet-400 active:bg-violet-50 dark:active:bg-violet-900/20"
              >
                <Wrench size={14} />
                AS 수리 접수
              </button>
              {thread.status === "archived" ? (
                <button
                  onClick={() => {
                    setActionsOpen(false);
                    onReopen();
                  }}
                  className="w-full text-left px-4 py-2.5 text-sm flex items-center gap-2 text-violet-700 dark:text-violet-400 active:bg-violet-50 dark:active:bg-violet-900/20"
                >
                  <RotateCcw size={14} />
                  되돌리기 (미답변)
                </button>
              ) : (
                <>
                  {thread.status === "resolved" ? (
                    <button
                      onClick={() => {
                        setActionsOpen(false);
                        onReopen();
                      }}
                      className="w-full text-left px-4 py-2.5 text-sm flex items-center gap-2 text-amber-700 dark:text-amber-400 active:bg-amber-50 dark:active:bg-amber-900/20"
                    >
                      <RotateCcw size={14} />
                      해결 취소 (미답변)
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        setActionsOpen(false);
                        onResolved();
                      }}
                      className="w-full text-left px-4 py-2.5 text-sm flex items-center gap-2 text-emerald-700 dark:text-emerald-400 active:bg-emerald-50 dark:active:bg-emerald-900/20"
                    >
                      <Check size={14} />
                      해결됨으로 표시
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setActionsOpen(false);
                      onNotCs();
                    }}
                    className="w-full text-left px-4 py-2.5 text-sm flex items-center gap-2 text-zinc-700 dark:text-zinc-300 active:bg-zinc-50 dark:active:bg-zinc-800"
                  >
                    <Ban size={14} />
                    CS 아님 (보관)
                  </button>
                  <button
                    onClick={() => {
                      setActionsOpen(false);
                      onBlockSender();
                    }}
                    className="w-full text-left px-4 py-2.5 text-sm flex items-center gap-2 text-zinc-700 dark:text-zinc-300 active:bg-zinc-50 dark:active:bg-zinc-800"
                  >
                    <Ban size={14} />
                    송신자 차단
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* 컨텍스트 패널 (접힘) */}
      {contextOpen && (
        <div className="flex-shrink-0 px-3 py-3 bg-white dark:bg-zinc-900 border-b border-zinc-100 dark:border-zinc-800">
          <MobileContextSummary thread={thread} context={context} />
        </div>
      )}

      {/* 제목 */}
      {thread.subject && (
        <div className="flex-shrink-0 px-4 py-2.5 bg-zinc-50 dark:bg-zinc-950 border-b border-zinc-100 dark:border-zinc-800/60">
          <div className="text-[13px] font-semibold text-zinc-700 dark:text-zinc-300 line-clamp-2">
            {thread.subject}
          </div>
        </div>
      )}

      {openPromises.length > 0 && <PromiseBanner promises={openPromises} onDone={onPromiseDone} />}

      {/* 메시지 영역 */}
      <div ref={messagesScrollRef} className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden px-3 py-4 space-y-4 bg-zinc-50 dark:bg-zinc-950">
        {thread.channel === "ig_comment" && <IgPostCard messages={messages} brand={thread.brand} />}
        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            customerName={customerName}
            brand={thread.brand}
          />
        ))}
      </div>

      {/* 답장 입력 영역 (sticky bottom) */}
      <div
        className="flex-shrink-0 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="px-3 py-2 border-b border-zinc-100 dark:border-zinc-800/60">
          <textarea
            value={operatorNotes}
            onChange={(e) => setOperatorNotes(e.target.value)}
            placeholder="AI 에게 줄 메모 (선택) — 짧게: 예) 각인 한글 가능, 5자 제한"
            rows={2}
            className="w-full px-2.5 py-1.5 text-[16px] rounded-md border border-amber-200 dark:border-amber-900/40 bg-amber-50/40 dark:bg-amber-950/20 text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-amber-400 resize-none"
          />
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={onDraft}
              disabled={draftLoading}
              className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 h-8 rounded-full text-xs font-semibold bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white disabled:opacity-50"
            >
              <Sparkles size={12} className={draftLoading ? "animate-pulse" : ""} />
              {draftLoading ? "생성 중…" : operatorNotes.trim() ? "메모 반영해서 작성" : "AI 초안"}
            </button>
            {draftNote && (
              <span className="text-[10px] text-zinc-500 truncate flex-1 min-w-0">
                💡 {draftNote}
              </span>
            )}
          </div>
        </div>
        <div className="p-3">
          <div className="flex items-end gap-2">
            <textarea
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              onKeyDown={(e) => {
                // ⌘/Ctrl + Enter 로 전송
                if (
                  (e.metaKey || e.ctrlKey) &&
                  e.key === "Enter" &&
                  !e.nativeEvent.isComposing &&
                  !sending &&
                  replyText.trim()
                ) {
                  e.preventDefault();
                  onSend();
                }
              }}
              placeholder="답장 입력…"
              rows={4}
              className="flex-1 px-3.5 py-2.5 text-[16px] leading-snug rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-violet-500 resize-none min-h-[112px] max-h-[50dvh]"
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = "auto";
                const cap = Math.round(window.innerHeight * 0.5);
                el.style.height = Math.min(el.scrollHeight, cap) + "px";
              }}
            />
            <button
              onClick={onSend}
              disabled={sending || !replyText.trim()}
              className="flex-shrink-0 w-11 h-11 rounded-full bg-violet-600 text-white disabled:opacity-40 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 flex items-center justify-center active:scale-95 transition"
              aria-label="전송"
            >
              <Send size={16} className={sending ? "animate-pulse" : ""} />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function MobileContextSummary({
  thread,
  context,
}: {
  thread: CsThread;
  context: ContextData | null;
}) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-zinc-500">총 대화</span>
        <span className="font-medium text-zinc-800 dark:text-zinc-200">
          {context?.totalThreads ?? 1}건
        </span>
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-zinc-500">첫 문의</span>
        <span className="font-medium text-zinc-800 dark:text-zinc-200">
          {context?.firstContact
            ? new Date(context.firstContact).toLocaleDateString("ko-KR")
            : "—"}
        </span>
      </div>
      {thread.customer_handle && (
        <div className="flex items-center justify-between text-xs gap-2">
          <span className="text-zinc-500 flex-shrink-0">연락처</span>
          <span className="font-mono text-[11px] text-zinc-600 dark:text-zinc-400 truncate">
            {thread.customer_handle}
          </span>
        </div>
      )}
      {context?.orderHistory && context.orderHistory.totalOrders > 0 && (
        <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800">
          <OrderHistorySection oh={context.orderHistory} compact />
        </div>
      )}
      {context?.related && context.related.length > 0 && (
        <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800">
          <div className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide mb-1.5">
            과거 대화 ({context.related.length})
          </div>
          <div className="space-y-1.5">
            {context.related.slice(0, 3).map((r) => {
              const RI = CHANNEL_STYLE[r.channel].icon;
              return (
                <div
                  key={r.id}
                  className="text-xs flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400 truncate"
                >
                  <RI size={10} className={CHANNEL_STYLE[r.channel].color} />
                  <span className="truncate">{r.subject || "(제목 없음)"}</span>
                  <span className="text-zinc-400 ml-auto flex-shrink-0">
                    {formatTime(r.last_message_at)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
