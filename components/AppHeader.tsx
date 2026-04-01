import Link from "next/link";
import { Watch, LayoutDashboard, Package, Users, Megaphone, LogIn, LogOut, RefreshCw, AtSign, Film, BarChart2 } from "lucide-react";

type ActivePage = "dashboard" | "inventory" | "influencer" | "ads" | "threads" | "content" | "analytics";

interface Props {
  activePage: ActivePage;
  isAuthenticated?: boolean;
}

const NAV_ITEMS: { href: string; label: string; icon: React.ElementType; page: ActivePage }[] = [
  { href: "/",                 label: "대시보드",   icon: LayoutDashboard, page: "dashboard"  },
  { href: "/inventory",        label: "재고관리",   icon: Package,         page: "inventory"  },
  { href: "/analytics",        label: "방문자",     icon: BarChart2,       page: "analytics"  },
  { href: "/tools/influencer", label: "인플루언서", icon: Users,           page: "influencer" },
  { href: "/ads",              label: "광고",       icon: Megaphone,       page: "ads"        },
  { href: "/tools/threads",    label: "쓰레드",     icon: AtSign,          page: "threads"    },
  { href: "/tools/content",    label: "콘텐츠",     icon: Film,            page: "content"    },
];

const PAGE_HREFS: Record<ActivePage, string> = {
  dashboard:  "/",
  inventory:  "/inventory",
  analytics:  "/analytics",
  influencer: "/tools/influencer",
  ads:        "/ads",
  threads:    "/tools/threads",
  content:    "/tools/content",
};

export default function AppHeader({ activePage, isAuthenticated = false }: Props) {
  return (
    <header className="bg-white dark:bg-zinc-900 border-b border-zinc-100 dark:border-zinc-800 sticky top-0 z-10">
      <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
        {/* 로고 */}
        <div className="flex items-center gap-3">
          <div className="bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl p-2">
            <Watch size={20} className="text-white" />
          </div>
          <div className="hidden sm:block">
            <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 tracking-tight leading-none">PAULVICE</h1>
            <p className="text-[11px] text-zinc-400 leading-none mt-0.5">카페24 · W컨셉 · 무신사</p>
          </div>
        </div>

        {/* 네비게이션 탭 */}
        <nav className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800 rounded-xl p-1">
          {NAV_ITEMS.map(({ href, label, icon: Icon, page }) => (
            <Link
              key={page}
              href={href}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                activePage === page
                  ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
              }`}
            >
              <Icon size={15} />
              <span className="hidden sm:inline">{label}</span>
            </Link>
          ))}
        </nav>

        {/* 우측 액션 */}
        <div className="flex items-center gap-2">
          {isAuthenticated ? (
            <a
              href="/api/auth/logout"
              className="flex items-center gap-1.5 text-xs font-medium bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 px-3 py-1.5 rounded-full transition-colors"
            >
              <LogOut size={13} />
              <span className="hidden sm:inline">연결 해제</span>
            </a>
          ) : (
            <a
              href="/api/auth/login"
              className="flex items-center gap-1.5 text-xs font-medium bg-violet-600 hover:bg-violet-700 text-white px-3 py-1.5 rounded-full transition-colors"
            >
              <LogIn size={13} />
              <span className="hidden sm:inline">카페24 연결</span>
            </a>
          )}
          <a
            href={PAGE_HREFS[activePage]}
            className="p-2 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-zinc-500"
            title="새로고침"
          >
            <RefreshCw size={15} />
          </a>
        </div>
      </div>
    </header>
  );
}
