import { cookies } from "next/headers";
import { LogIn, RefreshCw, Megaphone, Store } from "lucide-react";
import { getMetaTokenServer } from "@/lib/metaTokenStore";

interface Props {
  isAuthenticated?: boolean; // 카페24. 미지정 시 쿠키 직접 읽음
  refreshHref?: string;
}

export default async function AppHeader({ isAuthenticated, refreshHref }: Props) {
  const cookieStore = await cookies();
  const cafe24Connected =
    isAuthenticated ?? !!(
      cookieStore.get("c24_at")?.value || cookieStore.get("c24_rt")?.value
    );
  const metaConnected = !!(await getMetaTokenServer());

  return (
    <header className="hidden md:block bg-white dark:bg-zinc-900 border-b border-zinc-100 dark:border-zinc-800 sticky top-0 z-10">
      <div className="px-6 py-2.5 flex items-center justify-end gap-2">
        {/* 카페24 */}
        <a
          href={cafe24Connected ? "/api/auth/logout" : "/api/auth/login"}
          className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
            cafe24Connected
              ? "bg-sky-50 hover:bg-sky-100 dark:bg-sky-900/20 dark:hover:bg-sky-900/30 text-sky-700 dark:text-sky-300"
              : "bg-violet-600 hover:bg-violet-700 text-white"
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
          className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
            metaConnected
              ? "bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/20 dark:hover:bg-blue-900/30 text-blue-700 dark:text-blue-300"
              : "bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300"
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
