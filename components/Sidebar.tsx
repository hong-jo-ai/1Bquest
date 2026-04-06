"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Watch,
  LayoutDashboard,
  Package,
  Users,
  Megaphone,
  AtSign,
  Film,
  BarChart2,
  Bot,
  Gem,
  PanelLeftClose,
  PanelLeft,
} from "lucide-react";

type AppPage =
  | "dashboard"
  | "inventory"
  | "jewelry"
  | "analytics"
  | "influencer"
  | "ads"
  | "threads"
  | "content"
  | "agents";

const NAV_ITEMS: {
  href: string;
  label: string;
  icon: React.ElementType;
  page: AppPage;
}[] = [
  { href: "/", label: "대시보드", icon: LayoutDashboard, page: "dashboard" },
  { href: "/inventory", label: "재고관리", icon: Package, page: "inventory" },
  { href: "/jewelry-clearance", label: "주얼리청산", icon: Gem, page: "jewelry" },
  { href: "/analytics", label: "방문자", icon: BarChart2, page: "analytics" },
  { href: "/tools/influencer", label: "인플루언서", icon: Users, page: "influencer" },
  { href: "/ads", label: "광고", icon: Megaphone, page: "ads" },
  { href: "/tools/threads", label: "쓰레드", icon: AtSign, page: "threads" },
  { href: "/tools/content", label: "콘텐츠", icon: Film, page: "content" },
  { href: "/agents", label: "에이전트", icon: Bot, page: "agents" },
];

const HREF_TO_PAGE: Record<string, AppPage> = {
  "/": "dashboard",
  "/inventory": "inventory",
  "/jewelry-clearance": "jewelry",
  "/analytics": "analytics",
  "/tools/influencer": "influencer",
  "/ads": "ads",
  "/tools/threads": "threads",
  "/tools/content": "content",
  "/agents": "agents",
};

const PROGRESS_STEPS = [0, 20, 40, 60, 80, 100];
const STORAGE_KEY = "paulvice_app_progress";

function getProgressColor(value: number) {
  if (value === 0) return "bg-zinc-200 dark:bg-zinc-700";
  if (value <= 20) return "bg-red-400";
  if (value <= 40) return "bg-orange-400";
  if (value <= 60) return "bg-yellow-400";
  if (value <= 80) return "bg-blue-400";
  return "bg-emerald-400";
}

function getProgressLabel(value: number) {
  if (value === 0) return "미시작";
  if (value <= 20) return "초기";
  if (value <= 40) return "진행중";
  if (value <= 60) return "중반";
  if (value <= 80) return "후반";
  return "완료";
}

export default function Sidebar() {
  const pathname = usePathname();
  const activePage = HREF_TO_PAGE[pathname] ?? "dashboard";

  const [collapsed, setCollapsed] = useState(false);
  const [progress, setProgress] = useState<Record<AppPage, number>>(() => {
    const defaults: Record<AppPage, number> = {
      dashboard: 0,
      inventory: 0,
      jewelry: 0,
      analytics: 0,
      influencer: 0,
      ads: 0,
      threads: 0,
      content: 0,
      agents: 0,
    };
    return defaults;
  });
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setProgress((prev) => ({ ...prev, ...JSON.parse(stored) }));
      }
    } catch {}
    setMounted(true);
  }, []);

  const updateProgress = (page: AppPage, value: number) => {
    setProgress((prev) => {
      const next = { ...prev, [page]: value };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const cycleProgress = (page: AppPage) => {
    const current = progress[page];
    const idx = PROGRESS_STEPS.indexOf(current);
    const next = PROGRESS_STEPS[(idx + 1) % PROGRESS_STEPS.length];
    updateProgress(page, next);
  };

  const totalProgress = Math.round(
    Object.values(progress).reduce((a, b) => a + b, 0) / Object.keys(progress).length
  );

  return (
    <aside
      className={`${
        collapsed ? "w-16" : "w-64"
      } flex-shrink-0 bg-white dark:bg-zinc-900 border-r border-zinc-100 dark:border-zinc-800 flex flex-col transition-all duration-200 h-screen sticky top-0`}
    >
      {/* 로고 */}
      <div className="p-4 border-b border-zinc-100 dark:border-zinc-800">
        <div className="flex items-center gap-3">
          <div className="bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl p-2 flex-shrink-0">
            <Watch size={20} className="text-white" />
          </div>
          {!collapsed && (
            <div>
              <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 tracking-tight leading-none">
                PAULVICE
              </h1>
              <p className="text-[11px] text-zinc-400 leading-none mt-0.5">
                카페24 · W컨셉 · 무신사
              </p>
            </div>
          )}
        </div>
      </div>

      {/* 전체 진행률 */}
      {!collapsed && (
        <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
              전체 진행률
            </span>
            <span className="text-[11px] font-bold text-zinc-700 dark:text-zinc-300">
              {mounted ? `${totalProgress}%` : "—"}
            </span>
          </div>
          <div className="w-full h-2 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-violet-500 to-purple-500 rounded-full transition-all duration-500"
              style={{ width: mounted ? `${totalProgress}%` : "0%" }}
            />
          </div>
        </div>
      )}

      {/* 네비게이션 */}
      <nav className="flex-1 overflow-y-auto py-2 px-2">
        <div className="space-y-1">
          {NAV_ITEMS.map(({ href, label, icon: Icon, page }) => {
            const isActive = activePage === page;
            const prog = progress[page];

            return (
              <div key={page} className="group">
                <div className="flex items-center gap-1">
                  <Link
                    href={href}
                    className={`flex-1 flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                      isActive
                        ? "bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-300"
                        : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-200"
                    }`}
                    title={collapsed ? label : undefined}
                  >
                    <Icon
                      size={18}
                      className={
                        isActive
                          ? "text-violet-600 dark:text-violet-400"
                          : "text-zinc-400 dark:text-zinc-500"
                      }
                    />
                    {!collapsed && <span>{label}</span>}
                  </Link>
                </div>

                {/* 진행도 게이지 */}
                {!collapsed && (
                  <div className="flex items-center gap-1.5 px-3 pb-1 mt-0.5">
                    <button
                      onClick={() => cycleProgress(page)}
                      className="flex items-center gap-0.5 group/gauge"
                      title={`${prog}% — 클릭하여 변경`}
                    >
                      {PROGRESS_STEPS.slice(1).map((step) => (
                        <div
                          key={step}
                          className={`w-5 h-1.5 rounded-full transition-all ${
                            prog >= step
                              ? getProgressColor(prog)
                              : "bg-zinc-100 dark:bg-zinc-800"
                          } group-hover/gauge:opacity-80`}
                        />
                      ))}
                    </button>
                    <span
                      className={`text-[10px] font-medium ml-1 ${
                        prog === 100
                          ? "text-emerald-500"
                          : prog === 0
                          ? "text-zinc-400"
                          : "text-zinc-500 dark:text-zinc-400"
                      }`}
                    >
                      {mounted ? `${prog}%` : "—"}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </nav>

      {/* 접기/펼치기 */}
      <div className="p-2 border-t border-zinc-100 dark:border-zinc-800">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
          title={collapsed ? "사이드바 펼치기" : "사이드바 접기"}
        >
          {collapsed ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}
          {!collapsed && <span>접기</span>}
        </button>
      </div>
    </aside>
  );
}
