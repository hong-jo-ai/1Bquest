"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Maximize2, MessageCircle, Minimize2, Sparkles, X } from "lucide-react";

export default function MoriFloatingLauncher() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const hidden =
    pathname === "/login" ||
    pathname === "/mori" ||
    pathname === "/mori-embed" ||
    pathname.startsWith("/api/");

  if (hidden) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[80] sm:bottom-5 sm:right-5">
      {open && (
        <section
          className={`mb-3 overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-950 shadow-2xl shadow-black/30 transition-all dark:border-zinc-800 ${
            expanded
              ? "h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] sm:h-[min(760px,calc(100dvh-2.5rem))] sm:w-[min(720px,calc(100vw-2.5rem))]"
              : "h-[min(680px,calc(100dvh-6rem))] w-[min(430px,calc(100vw-2rem))]"
          }`}
          aria-label="MORI 플로팅 패널"
        >
          <div className="flex h-11 items-center justify-between border-b border-white/10 bg-[#0d1320] px-3 text-[#E8ECF0]">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#F4E4C1] text-[#1A2332]">
                <Sparkles size={15} />
              </span>
              <div>
                <p className="text-xs font-semibold leading-none">MORI</p>
                <p className="mt-0.5 text-[10px] text-[#7c8aa0]">운영 비서</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="rounded-full p-2 text-[#9fb0c8] transition hover:bg-white/10 hover:text-white"
                title={expanded ? "작게 보기" : "크게 보기"}
              >
                {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full p-2 text-[#9fb0c8] transition hover:bg-white/10 hover:text-white"
                title="닫기"
              >
                <X size={15} />
              </button>
            </div>
          </div>
          <iframe
            title="MORI"
            src="/mori-embed"
            className="h-[calc(100%-2.75rem)] w-full border-0 bg-[#0d1320]"
            allow="microphone; autoplay"
          />
        </section>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group flex h-14 items-center gap-2 rounded-full border border-violet-300/40 bg-zinc-950 px-4 text-white shadow-xl shadow-black/20 transition hover:-translate-y-0.5 hover:bg-zinc-900 dark:border-violet-400/30"
        aria-expanded={open}
        aria-label={open ? "모리 닫기" : "모리 열기"}
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#F4E4C1] text-[#1A2332]">
          <MessageCircle size={18} />
        </span>
        <span className="hidden pr-1 text-sm font-semibold sm:inline">모리</span>
      </button>
    </div>
  );
}
