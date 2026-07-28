import { RefreshCw, Megaphone, Store } from "lucide-react";
import { getMetaTokenServer } from "@/lib/metaTokenStore";
import { readRefreshTokenFromStore } from "@/lib/cafe24TokenStore";

interface Props {
  isAuthenticated?: boolean; // 카페24. 미지정 시 Supabase 직접 읽음
  refreshHref?: string;
}

export default async function AppHeader({ isAuthenticated, refreshHref }: Props) {
  const cafe24Connected =
    isAuthenticated ?? !!(await readRefreshTokenFromStore());          // 폴바이스
  const harriotConnected = !!(await readRefreshTokenFromStore("harriot")); // 해리엇
  const metaConnected = !!(await getMetaTokenServer());

  const malls = [
    { key: "paulvice", label: "폴바이스", connected: cafe24Connected, href: "/api/auth/login" },
    { key: "harriot", label: "해리엇", connected: harriotConnected, href: "/api/auth/login?mall=harriot" },
  ];

  return (
    // max-md:hidden — "hidden md:block" 은 .hidden 이 이겨 데스크톱에서 사라짐(2026-07-28)
    <header className="max-md:hidden md:block sticky top-0 z-10 border-b border-zinc-200/70 bg-white/85 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
      <div className="relative pl-6 pr-16 py-3 flex items-center justify-end gap-2">
        {/* 카페24 — 폴바이스/해리엇 각각 연결·재연결 */}
        {malls.map((m) => (
          <a
            key={m.key}
            href={m.href}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              m.connected
                ? "border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 dark:border-sky-900/50 dark:bg-sky-500/10 dark:text-sky-300 dark:hover:bg-sky-500/15"
                : "border-violet-600 bg-violet-600 text-white hover:bg-violet-700"
            }`}
            title={`${m.label} 카페24 ${m.connected ? "연결됨 — 클릭 시 재연결" : "연결하기"}`}
          >
            <Store size={13} />
            <span>{m.label}</span>
            <span className={`text-[10px] ${m.connected ? "opacity-60" : "opacity-90"}`}>
              {m.connected ? "연결됨" : "연결"}
            </span>
          </a>
        ))}

        {/* 메타 광고 */}
        <a
          href={metaConnected ? "/api/meta/auth/logout" : "/api/meta/auth/login"}
          className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
            metaConnected
              ? "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-900/50 dark:bg-blue-500/10 dark:text-blue-300 dark:hover:bg-blue-500/15"
              : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
          }`}
          title={metaConnected ? "Meta 광고 연결됨 — 클릭 시 연결 해제" : "Meta 광고 연결"}
        >
          <Megaphone size={13} />
          <span>Meta</span>
          <span className={`text-[10px] ${metaConnected ? "opacity-60" : "opacity-90"}`}>
            {metaConnected ? "연결됨" : "연결"}
          </span>
        </a>

        {refreshHref && (
          <a
            href={refreshHref}
            className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full border border-zinc-200 bg-white p-2 text-zinc-500 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800"
            title="새로고침"
          >
            <RefreshCw size={15} />
          </a>
        )}
      </div>
    </header>
  );
}
