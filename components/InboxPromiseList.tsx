"use client";

import { CalendarClock, Check, Package, RotateCcw } from "lucide-react";
import type { CsPromise } from "@/lib/cs/promises";

/**
 * 약속 모아보기 — 인박스 가운데 목록 자리에 대화 대신 약속을 늘어놓는다.
 *
 * 문제: 약속은 대화 상단 배너에만 있어서, 완료를 누르려면 그 대화를 일일이 찾아 들어가야 했다
 *       (사장님 지적 2026-09-10). 여기서 한눈에 보고 바로 완료하고, 누르면 그 대화가 열린다.
 *
 * 정렬: 급한 것부터 — 마감일(없으면 알림일) 오름차순, 날짜 없는 건 뒤, 완료는 맨 뒤.
 */
export default function InboxPromiseList({
  promises,
  loading,
  includeDone,
  onToggleIncludeDone,
  selectedThreadId,
  onOpenThread,
  onSetStatus,
  variant,
}: {
  promises: CsPromise[];
  loading: boolean;
  includeDone: boolean;
  onToggleIncludeDone: () => void;
  selectedThreadId: string | null;
  onOpenThread: (threadId: string) => void;
  onSetStatus: (id: string, status: "open" | "done") => void;
  variant: "desktop" | "mobile";
}) {
  const today = todayKst();
  const rows = [...promises].sort(comparePromises);
  const openCount = promises.filter((p) => p.status !== "done").length;

  const toggle = (
    <label className="flex items-center gap-1.5 text-xs text-zinc-500 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={includeDone}
        onChange={onToggleIncludeDone}
        className="accent-amber-600"
      />
      완료 포함
    </label>
  );

  const list =
    loading && rows.length === 0 ? (
      <div className="p-8 text-center text-sm text-zinc-400">로딩 중…</div>
    ) : rows.length === 0 ? (
      <div className="p-12 text-center">
        <CalendarClock size={32} className="text-zinc-300 dark:text-zinc-700 mx-auto mb-2" />
        <div className="text-sm text-zinc-400">
          {includeDone ? "저장된 약속이 없습니다" : "지킬 약속이 없습니다"}
        </div>
      </div>
    ) : (
      rows.map((p) => (
        <PromiseRow
          key={p.id}
          promise={p}
          today={today}
          selected={!!p.threadId && p.threadId === selectedThreadId}
          onOpenThread={onOpenThread}
          onSetStatus={onSetStatus}
          variant={variant}
        />
      ))
    );

  if (variant === "mobile") {
    return (
      <>
        <div className="flex items-center justify-between px-1 pb-1">
          <span className="text-xs text-zinc-500">미완료 {openCount}건</span>
          {toggle}
        </div>
        {list}
      </>
    );
  }

  return (
    <>
      <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 sticky top-0 bg-white dark:bg-zinc-900 z-10">
        <div className="text-sm font-bold text-zinc-900 dark:text-zinc-100">약속</div>
        <div className="text-xs text-zinc-500 mt-0.5 flex items-center justify-between gap-2">
          <span>미완료 {openCount}건 · 누르면 대화가 열립니다</span>
          {toggle}
        </div>
      </div>
      <div className="divide-y divide-zinc-100 dark:divide-zinc-800/60">{list}</div>
    </>
  );
}

function PromiseRow({
  promise: p,
  today,
  selected,
  onOpenThread,
  onSetStatus,
  variant,
}: {
  promise: CsPromise;
  today: string;
  selected: boolean;
  onOpenThread: (threadId: string) => void;
  onSetStatus: (id: string, status: "open" | "done") => void;
  variant: "desktop" | "mobile";
}) {
  const done = p.status === "done";
  const name = p.customerName || p.customerHandle || "고객 미상";
  const due = dueLabel(p, today);
  const canOpen = !!p.threadId;

  const shell =
    variant === "mobile"
      ? "bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-3.5"
      : `px-4 py-3 border-l-[3px] ${
          selected
            ? "bg-violet-50 dark:bg-violet-500/10 border-violet-600"
            : "border-transparent hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
        }`;

  return (
    <div className={`${shell} ${done ? "opacity-55" : ""}`}>
      <div className="flex items-start gap-3">
        {/* 본문 — 대화가 연결된 약속만 눌러서 열 수 있다(수동 등록 등은 threadId 없음) */}
        <button
          type="button"
          onClick={() => canOpen && onOpenThread(p.threadId!)}
          disabled={!canOpen}
          className="flex-1 min-w-0 text-left disabled:cursor-default"
          title={canOpen ? "이 약속을 한 대화 열기" : "연결된 대화가 없는 약속"}
        >
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 truncate">
              {name}
            </span>
            {due && (
              <span
                className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${DUE_TONE[due.tone]}`}
              >
                {due.text}
              </span>
            )}
          </div>
          <div
            className={`text-sm leading-snug text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap break-words ${
              done ? "line-through" : ""
            }`}
          >
            {p.text}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-zinc-500">
            {p.remindOn && (
              <span className="inline-flex items-center gap-0.5">
                <CalendarClock size={10} /> 알림 {p.remindOn}
              </span>
            )}
            {p.dueOn && <span>마감 {p.dueOn}</span>}
            {p.orderNumber && (
              <span className="inline-flex items-center gap-0.5">
                <Package size={10} /> {p.seller ? `${p.seller} ` : ""}
                {p.orderNumber}
              </span>
            )}
            {done && p.doneAt && <span>완료 {p.doneAt.slice(0, 10)}</span>}
          </div>
        </button>

        {done ? (
          <button
            type="button"
            onClick={() => onSetStatus(p.id, "open")}
            className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            title="완료를 취소하고 다시 알림 받기"
          >
            <RotateCcw size={12} /> 되돌리기
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onSetStatus(p.id, "done")}
            className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white active:scale-95 transition"
            title="약속 이행 완료로 표시 — 알림·출고 경고가 멈춥니다"
          >
            <Check size={12} /> 완료
          </button>
        )}
      </div>
    </div>
  );
}

const DUE_TONE = {
  overdue: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  today: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  later: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
} as const;

/** 마감일 기준 D-day. 마감일이 없으면 알림일로 대신 — 알림일이 지났으면 이미 챙겨야 할 약속이다. */
function dueLabel(p: CsPromise, today: string): { text: string; tone: keyof typeof DUE_TONE } | null {
  if (p.status === "done") return null;
  const date = p.dueOn ?? p.remindOn;
  if (!date) return null;
  const days = Math.round((Date.parse(date) - Date.parse(today)) / 86_400_000);
  const prefix = p.dueOn ? "마감" : "알림";
  if (days < 0) return { text: `${prefix} ${-days}일 지남`, tone: "overdue" };
  if (days === 0) return { text: `${prefix} 오늘`, tone: "today" };
  return { text: `${prefix} D-${days}`, tone: "later" };
}

function comparePromises(a: CsPromise, b: CsPromise): number {
  const doneA = a.status === "done" ? 1 : 0;
  const doneB = b.status === "done" ? 1 : 0;
  if (doneA !== doneB) return doneA - doneB;
  if (doneA) return (b.doneAt ?? "").localeCompare(a.doneAt ?? ""); // 완료는 최근 완료부터
  const keyA = a.dueOn ?? a.remindOn ?? "9999";
  const keyB = b.dueOn ?? b.remindOn ?? "9999";
  return keyA.localeCompare(keyB) || b.createdAt.localeCompare(a.createdAt);
}

// lib/cs/promises 의 todayKst 는 서버 모듈(supabase)을 끌고 와서 클라이언트에선 따로 둔다.
function todayKst(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
