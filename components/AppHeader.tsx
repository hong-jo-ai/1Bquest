import { RefreshCw, Megaphone, Store } from "lucide-react";
import { getMetaTokenServer } from "@/lib/metaTokenStore";
import { readRefreshTokenFromStore } from "@/lib/cafe24TokenStore";

interface Props {
  isAuthenticated?: boolean; // 카페24. 미지정 시 Supabase 직접 읽음
  refreshHref?: string;
}

export default async function AppHeader({ isAuthenticated, refreshHref }: Props) {
  const cafe24Connected =
    isAuthenticated ?? !!(await readRefreshTokenFromStore());
  const metaConnected = !!(await getMetaTokenServer());

  return (
    <header className="hidden md:block sticky top-0 z-10 border-b border-zinc-200/70 bg-white/85 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
      <div className="px-6 py-3 flex items-center justify-end gap-2">
        {/* 카페24 */}
        <a
          href={cafe24Connected ? "/api/auth/logout" : "/api/auth/login"}
          className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
            cafe24Connected
              ? "border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 dark:border-sky-900/50 dark:bg-sky-500/10 dark:text-sky-300 dark:hover:bg-sky-500/15"
              : "border-violet-600 bg-violet-600 text-white hover:bg-violet-700"
          }`}
          title={cafe24Connected ? "카페24 연결됨 — 클릭 시 연결 해제" : "카페24 연결"}
        >
          <Store size={13} />
          <span>카페24</span>
          <span className={`text-[10px] ${cafe24Connected ? "opacity-60" : "opacity-90"}`}>
            {cafe24Connected ? "연결됨" : "연결"}
          </span>
        </a>

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
            className="rounded-full border border-zinc-200 bg-white p-2 text-zinc-500 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800"
            title="새로고침"
          >
            <RefreshCw size={15} />
          </a>
        )}
      </div>
    </header>
  );
}
