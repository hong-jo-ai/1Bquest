import Link from "next/link";
import { LogIn, LogOut, RefreshCw } from "lucide-react";

interface Props {
  isAuthenticated?: boolean;
  refreshHref?: string;
}

export default function AppHeader({ isAuthenticated = false, refreshHref }: Props) {
  return (
    <header className="bg-white dark:bg-zinc-900 border-b border-zinc-100 dark:border-zinc-800 sticky top-0 z-10">
      <div className="px-6 py-2.5 flex items-center justify-end gap-2">
        {isAuthenticated ? (
          <a
            href="/api/auth/logout"
            className="flex items-center gap-1.5 text-xs font-medium bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 px-3 py-1.5 rounded-full transition-colors"
          >
            <LogOut size={13} />
            <span>연결 해제</span>
          </a>
        ) : (
          <a
            href="/api/auth/login"
            className="flex items-center gap-1.5 text-xs font-medium bg-violet-600 hover:bg-violet-700 text-white px-3 py-1.5 rounded-full transition-colors"
          >
            <LogIn size={13} />
            <span>카페24 연결</span>
          </a>
        )}
        {refreshHref && (
          <a
            href={refreshHref}
            className="p-2 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-zinc-500"
            title="새로고침"
          >
            <RefreshCw size={15} />
          </a>
        )}
      </div>
    </header>
  );
}
