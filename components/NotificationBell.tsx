"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Bell,
  Mail,
  AtSign,
  MessageCircle,
  Camera,
  Store,
  ShoppingBag,
} from "lucide-react";
import type { CsThread, CsChannel, CsBrandId } from "@/lib/cs/types";
import { BRAND_LABEL, CHANNEL_LABEL } from "@/lib/cs/types";

const CHANNEL_ICON: Record<CsChannel, React.ElementType> = {
  gmail: Mail,
  threads: AtSign,
  ig_dm: Camera,
  ig_comment: Camera,
  channeltalk: MessageCircle,
  crisp: MessageCircle,
  kakao_bizchat: MessageCircle,
  cafe24_board: Store,
  sixshop_board: ShoppingBag,
};

const BRAND_COLOR: Record<CsBrandId, string> = {
  paulvice: "from-violet-500 to-fuchsia-500",
  harriot: "from-amber-600 to-stone-800",
};

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [recent, setRecent] = useState<CsThread[]>([]);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/cs/notifications", { cache: "no-store" });
      const json = await res.json();
      setCount(json.unansweredCount ?? 0);
      setRecent(json.recent ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(() => {
      if (!document.hidden) load();
    }, 60 * 1000);
    const onVisible = () => {
      if (!document.hidden) load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  // 바깥 클릭 시 닫기
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  return (
    <div ref={ref} className="fixed top-3 right-4 z-40 md:top-4 md:right-6">
      <button
        onClick={() => setOpen(!open)}
        className="relative p-2 rounded-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm hover:shadow-md transition text-zinc-600 dark:text-zinc-300"
        aria-label="알림"
      >
        <Bell size={18} />
        {count > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 flex items-center justify-center text-[10px] font-bold bg-red-500 text-white rounded-full shadow">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute top-12 right-0 w-80 max-h-[70vh] overflow-y-auto bg-white dark:bg-zinc-900 rounded-xl shadow-2xl border border-zinc-200 dark:border-zinc-800 animate-in fade-in slide-in-from-top-2">
          <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 sticky top-0 bg-white dark:bg-zinc-900">
            <div className="flex items-center justify-between">
              <div className="font-bold text-sm text-zinc-900 dark:text-zinc-100">
                미답변 CS
              </div>
              <div className="text-xs text-zinc-500">{count}건</div>
            </div>
          </div>

          {loading && recent.length === 0 ? (
            <div className="p-6 text-center text-sm text-zinc-400">
              불러오는 중…
            </div>
          ) : recent.length === 0 ? (
            <div className="p-8 text-center">
              <div className="text-2xl mb-2">🎉</div>
              <div className="text-sm text-zinc-500">모든 문의에 답변 완료</div>
            </div>
          ) : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
              {recent.map((t) => {
                const Icon = CHANNEL_ICON[t.channel] ?? Mail;
                const name =
                  t.customer_name || t.customer_handle || "알 수 없음";
                return (
                  <Link
                    key={t.id}
                    href="/inbox"
                    onClick={() => setOpen(false)}
                    className="block px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/60 transition"
                  >
                    <div className="flex items-start gap-2.5">
                      <div
                        className={`w-7 h-7 rounded-full bg-gradient-to-br ${BRAND_COLOR[t.brand]} flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0`}
                      >
                        {name.trim().charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <Icon size={10} className="text-zinc-400 flex-shrink-0" />
                          <span className="text-[10px] text-zinc-500 truncate">
                            {BRAND_LABEL[t.brand]} · {CHANNEL_LABEL[t.channel]}
                          </span>
                          <span className="text-[10px] text-zinc-400 ml-auto flex-shrink-0">
                            {formatRelative(t.last_message_at)}
                          </span>
                        </div>
                        <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                          {name}
                        </div>
                        {t.last_message_preview && (
                          <div className="text-xs text-zinc-500 line-clamp-1 mt-0.5">
                            {t.last_message_preview}
                          </div>
                        )}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}

          <div className="px-4 py-2 border-t border-zinc-100 dark:border-zinc-800 sticky bottom-0 bg-white dark:bg-zinc-900">
            <Link
              href="/inbox"
              onClick={() => setOpen(false)}
              className="block text-center text-xs text-violet-600 dark:text-violet-400 hover:underline font-medium py-1"
            >
              전체 인박스 보기 →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간`;
  return `${Math.floor(hr / 24)}일`;
}
