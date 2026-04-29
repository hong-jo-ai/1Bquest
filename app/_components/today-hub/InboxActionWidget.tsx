// TODO v3: Gmail '답장필요' 라벨 메일 자동 표시
"use client";

import { useState } from "react";
import { Mail } from "lucide-react";
import { MOCK_INBOX } from "./mockData";
import type { InboxItem } from "./types";

export default function InboxActionWidget() {
  const [items] = useState<InboxItem[]>(MOCK_INBOX);

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
      </div>

      <div className="p-2">
        <ul className="space-y-0.5">
          {items.map((it) => (
            <li key={it.id}>
              <a
                href="#"
                className="flex items-start gap-2 px-3 py-2 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${
                    it.overdue ? "bg-rose-500" : "bg-transparent"
                  }`}
                  aria-label={it.overdue ? "우선순위 높음 (24시간 초과)" : undefined}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-zinc-700 dark:text-zinc-200 truncate">{it.sender}</p>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">{it.subject}</p>
                </div>
                <span className={`text-[10px] shrink-0 mt-0.5 ${
                  it.overdue ? "text-rose-600 font-semibold" : "text-zinc-400"
                }`}>
                  {it.receivedLabel}
                </span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
