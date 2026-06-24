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
  Gem,
  Inbox,
  Wrench,
  ShoppingBag,
  Wallet,
  Brain,
  PanelLeftClose,
  PanelLeft,
  Menu,
  X,
  LogIn,
  LogOut,
  Store,
  Tags,
  MessageSquare,
  Sparkles,
  Wand2,
  ExternalLink,
  Truck,
  Star,
} from "lucide-react";

type AppPage =
  | "dashboard"
  | "inbox"
  | "as"
  | "inventory"
  | "jewelry"
  | "influencer"
  | "groupbuying"
  | "adsauto"
  | "threads"
  | "finance"
  | "pricing"
  | "sms"
  | "shipping"
  | "reviews"
  | "mori";

const NAV_ITEMS: {
  href: string;
  label: string;
  icon: React.ElementType;
  page: AppPage;
}[] = [
  { href: "/", label: "대시보드", icon: LayoutDashboard, page: "dashboard" },
  { href: "/mori", label: "모리 (MORI)", icon: Sparkles, page: "mori" },
  { href: "/reviews", label: "리뷰 관리", icon: Star, page: "reviews" },
  { href: "/finance", label: "재무 관리", icon: Wallet, page: "finance" },
  { href: "/channel-pricing", label: "채널 가격", icon: Tags, page: "pricing" },
  { href: "/inbox", label: "CS 인박스", icon: Inbox, page: "inbox" },
  { href: "/as", label: "AS 수리 추적", icon: Wrench, page: "as" },
  { href: "/shipping", label: "우체국 발송", icon: Truck, page: "shipping" },
  { href: "/sms", label: "고객 안내 SMS", icon: MessageSquare, page: "sms" },
  { href: "/inventory", label: "재고관리", icon: Package, page: "inventory" },
  { href: "/jewelry-clearance", label: "주얼리청산", icon: Gem, page: "jewelry" },
  { href: "/tools/influencer", label: "인플루언서", icon: Users, page: "influencer" },
  { href: "/tools/group-buying", label: "공동구매", icon: ShoppingBag, page: "groupbuying" },
  { href: "/ads", label: "광고 의사결정", icon: Brain, page: "adsauto" },
  { href: "/tools/threads", label: "쓰레드", icon: AtSign, page: "threads" },
];

const HREF_TO_PAGE: Record<string, AppPage> = {
  "/": "dashboard",
  "/mori": "mori",
  "/reviews": "reviews",
  "/finance": "finance",
  "/channel-pricing": "pricing",
  "/inbox": "inbox",
  "/as": "as",
  "/shipping": "shipping",
  "/sms": "sms",
  "/inventory": "inventory",
  "/jewelry-clearance": "jewelry",
  "/tools/influencer": "influencer",
  "/tools/group-buying": "groupbuying",
  "/ads": "adsauto",
  "/tools/threads": "threads",
};

// 외부 도구 (이 앱의 라우트가 아님) — 아이맥 셀프호스팅 엔진, Cloudflare Tunnel 경유.
// 새 탭으로 연다.
const EXTERNAL_ITEMS: { href: string; label: string; icon: React.ElementType }[] = [
  { href: "https://engine.harriot.co.kr", label: "광고 소재 생성", icon: Wand2 },
];

interface SidebarProps {
  cafe24Connected?: boolean;
  metaConnected?: boolean;
}

export default function Sidebar({
  cafe24Connected = false,
  metaConnected = false,
}: SidebarProps = {}) {
  const pathname = usePathname();
  const activePage = HREF_TO_PAGE[pathname] ?? "dashboard";

  const [collapsed, setCollapsed] = useState(false);
  const [csUnanswered, setCsUnanswered] = useState(0);

  // CS 미답변 수 폴링
  useEffect(() => {
    const fetchCount = async () => {
      if (document.hidden) return;
      try {
        const res = await fetch("/api/cs/notifications", { cache: "no-store" });
        const json = await res.json();
        setCsUnanswered(json.unansweredCount ?? 0);
      } catch {}
    };
    fetchCount();
    const id = setInterval(fetchCount, 60 * 1000);
    const onVisible = () => !document.hidden && fetchCount();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const [mobileOpen, setMobileOpen] = useState(false);

  const navContent = (isMobile: boolean) => (
    <>
      {/* 로고 */}
      <div className={`p-4 border-b border-zinc-100 dark:border-zinc-800 ${isMobile ? "flex items-center justify-between" : ""}`}>
        <div className="flex items-center gap-3">
          <div className="bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl p-2 flex-shrink-0">
            <Watch size={20} className="text-white" />
          </div>
          {(!collapsed || isMobile) && (
            <div>
              <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 tracking-tight leading-none">
                HARRIOT WATCHES
              </h1>
              <p className="text-[11px] text-zinc-400 leading-none mt-0.5">
                AI 운영 허브 · 멀티 브랜드
              </p>
            </div>
          )}
        </div>
        {isMobile && (
          <button onClick={() => setMobileOpen(false)} className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500">
            <X size={20} />
          </button>
        )}
      </div>

      {/* 네비게이션 */}
      <nav className="flex-1 overflow-y-auto py-2 px-2">
        <div className="space-y-1">
          {NAV_ITEMS.map(({ href, label, icon: Icon, page }) => {
            const isActive = activePage === page;
            const badge = page === "inbox" && csUnanswered > 0 ? csUnanswered : 0;

            return (
              <div key={page} className="group">
                <div className="flex items-center gap-1">
                  <Link
                    href={href}
                    target={isActive ? undefined : "_blank"}
                    rel={isActive ? undefined : "noopener noreferrer"}
                    onClick={() => {
                      if (isMobile) setMobileOpen(false);
                    }}
                    className={`flex-1 flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                      isActive
                        ? "bg-zinc-950 text-white shadow-sm dark:bg-zinc-100 dark:text-zinc-950"
                        : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                    }`}
                    title={collapsed && !isMobile ? label : undefined}
                  >
                    <div className="relative">
                      <Icon
                        size={18}
                        className={isActive ? "text-white dark:text-zinc-950" : "text-zinc-400 dark:text-zinc-500"}
                      />
                      {badge > 0 && collapsed && !isMobile && (
                        <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-1 flex items-center justify-center text-[9px] font-bold bg-red-500 text-white rounded-full">
                          {badge > 99 ? "99+" : badge}
                        </span>
                      )}
                    </div>
                    {(!collapsed || isMobile) && (
                      <>
                        <span className="flex-1">{label}</span>
                        {badge > 0 && (
                          <span className="min-w-[18px] h-[18px] px-1.5 flex items-center justify-center text-[10px] font-bold bg-red-500 text-white rounded-full">
                            {badge > 99 ? "99+" : badge}
                          </span>
                        )}
                      </>
                    )}
                  </Link>
                </div>
              </div>
            );
          })}

          {/* 외부 도구 — 새 탭 */}
          {EXTERNAL_ITEMS.map(({ href, label, icon: Icon }) => (
            <a
              key={href}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              title={collapsed && !isMobile ? label : undefined}
            >
              <Icon size={18} className="text-zinc-400 dark:text-zinc-500" />
              {(!collapsed || isMobile) && (
                <>
                  <span className="flex-1">{label}</span>
                  <ExternalLink size={13} className="text-zinc-300 dark:text-zinc-600" />
                </>
              )}
            </a>
          ))}
        </div>
      </nav>

      {/* 외부 서비스 연결 (모바일 전용) */}
      {isMobile && (
        <div className="p-3 border-t border-zinc-100 dark:border-zinc-800 space-y-3">
          {/* 카페24 */}
          <div className="space-y-1">
            <div className="px-1 text-[10px] font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
              <Store size={11} />
              카페24
              {cafe24Connected && (
                <span className="text-emerald-500 normal-case font-medium ml-auto">● 연결됨</span>
              )}
            </div>
            <a
              href="/api/auth/login"
              className={`w-full flex items-center gap-2 px-3 h-11 rounded-lg text-sm ${
                cafe24Connected
                  ? "font-medium bg-sky-50 dark:bg-sky-500/10 text-sky-700 dark:text-sky-300 active:bg-sky-100"
                  : "font-semibold bg-violet-600 text-white active:bg-violet-700"
              }`}
            >
              <LogIn size={16} />
              {cafe24Connected ? "재연결" : "연결하기"}
            </a>
            {cafe24Connected && (
              <a
                href="/api/auth/logout"
                className="w-full flex items-center gap-2 px-3 h-10 rounded-lg text-xs text-zinc-500 dark:text-zinc-500 active:bg-zinc-100 dark:active:bg-zinc-800"
              >
                <LogOut size={14} />
                연결 해제
              </a>
            )}
          </div>

          {/* 메타 광고 */}
          <div className="space-y-1">
            <div className="px-1 text-[10px] font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
              <Megaphone size={11} />
              Meta 광고
              {metaConnected && (
                <span className="text-emerald-500 normal-case font-medium ml-auto">● 연결됨</span>
              )}
            </div>
            <a
              href="/api/meta/auth/login"
              className={`w-full flex items-center gap-2 px-3 h-11 rounded-lg text-sm ${
                metaConnected
                  ? "font-medium bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 active:bg-blue-100"
                  : "font-semibold bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 active:opacity-80"
              }`}
            >
              <LogIn size={16} />
              {metaConnected ? "재연결" : "연결하기"}
            </a>
            {metaConnected && (
              <a
                href="/api/meta/auth/logout"
                className="w-full flex items-center gap-2 px-3 h-10 rounded-lg text-xs text-zinc-500 dark:text-zinc-500 active:bg-zinc-100 dark:active:bg-zinc-800"
              >
                <LogOut size={14} />
                연결 해제
              </a>
            )}
          </div>
        </div>
      )}

      {/* 접기/펼치기 (데스크톱만) */}
      {!isMobile && (
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
      )}
    </>
  );

  return (
    <>
      {/* 모바일 상단 바 */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-50 bg-white dark:bg-zinc-900 border-b border-zinc-100 dark:border-zinc-800 px-3 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setMobileOpen(true)}
            className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400 transition-colors"
          >
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-2">
            <div className="bg-gradient-to-br from-violet-500 to-purple-600 rounded-lg p-1.5">
              <Watch size={14} className="text-white" />
            </div>
            <span className="text-sm font-bold text-zinc-800 dark:text-zinc-100">HARRIOT WATCHES</span>
          </div>
        </div>
      </div>

      {/* 모바일 오버레이 + 슬라이드 메뉴 */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-72 bg-white dark:bg-zinc-900 flex flex-col shadow-2xl animate-in slide-in-from-left duration-200">
            {navContent(true)}
          </aside>
        </div>
      )}

      {/* 데스크톱 사이드바 */}
      <aside
        className={`hidden md:flex ${
          collapsed ? "w-16" : "w-64"
        } flex-shrink-0 bg-white dark:bg-zinc-900 border-r border-zinc-100 dark:border-zinc-800 flex-col transition-all duration-200 h-screen sticky top-0`}
      >
        {navContent(false)}
      </aside>
    </>
  );
}
