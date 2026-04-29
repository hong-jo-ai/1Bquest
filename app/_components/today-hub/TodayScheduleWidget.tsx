// v3: 구글 캘린더(shong@harriotwatches.com) 오늘 일정 읽기 전용. 입력은 폰 캘린더 앱에서.
"use client";

import { useState, useEffect, useCallback } from "react";
import { Calendar, Loader2, AlertCircle, RefreshCw } from "lucide-react";

interface CalendarEvent {
  id:       string;
  time:     string;
  title:    string;
  location: string;
  startAt:  string;
  htmlLink: string;
}

export default function TodayScheduleWidget() {
  const [events,  setEvents]  = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/today-hub/schedule", { cache: "no-store" });
      const j   = await res.json();
      if (!j.ok) throw new Error(j.error ?? "캘린더 조회 실패");
      setEvents(j.events as CalendarEvent[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 overflow-hidden h-full">
      <div className="px-5 py-3 border-b border-zinc-100 dark:border-zinc-800 flex items-center gap-2.5">
        <div className="w-7 h-7 bg-gradient-to-br from-sky-500 to-sky-700 rounded-lg flex items-center justify-center text-white shrink-0">
          <Calendar size={13} />
        </div>
        <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 flex-1">오늘 외부 약속</h3>
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

      <div className="p-4">
        {loading && events.length === 0 && (
          <div className="flex items-center justify-center py-6 gap-2 text-zinc-400">
            <Loader2 size={14} className="animate-spin" />
            <span className="text-xs">불러오는 중...</span>
          </div>
        )}

        {!loading && error && (
          <div className="flex items-start gap-2 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-lg px-3 py-2 text-xs">
            <AlertCircle size={12} className="shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="whitespace-pre-line break-words font-mono text-[11px] leading-relaxed">
                {error}
              </p>
              {(error.includes("미연결") || error.includes("권한") || error.includes("HTTP 4")) && (
                <div className="mt-2 flex gap-3 flex-wrap">
                  <a
                    href="/api/auth/google/login?hint=shong@harriotwatches.com"
                    className="underline font-medium"
                  >
                    shong@harriotwatches.com 으로 재연결 →
                  </a>
                  <a
                    href="/api/auth/google/login"
                    className="underline font-medium opacity-70"
                  >
                    다른 계정으로 →
                  </a>
                </div>
              )}
            </div>
          </div>
        )}

        {!loading && !error && events.length === 0 && (
          <p className="text-xs text-zinc-400 py-4 text-center">오늘은 외부 약속 없음</p>
        )}

        {!error && events.length > 0 && (
          <ul className="space-y-3">
            {events.map((e) => (
              <li key={e.id} className="flex items-baseline gap-3">
                <span className="text-sm font-bold text-zinc-800 dark:text-zinc-100 tabular-nums shrink-0 w-12">
                  {e.time}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-zinc-700 dark:text-zinc-200 truncate">
                    {e.htmlLink ? (
                      <a
                        href={e.htmlLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline"
                      >
                        {e.title}
                      </a>
                    ) : e.title}
                  </p>
                  {e.location && (
                    <p className="text-[11px] text-zinc-400 truncate">{e.location}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
