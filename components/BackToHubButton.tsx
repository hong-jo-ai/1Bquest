import Link from "next/link";
import { ArrowLeft, LayoutDashboard } from "lucide-react";

/**
 * 서브 앱(재무/광고/CS/...)에서 대시보드(hub)로 돌아가는 모바일 내비게이션.
 * 데스크톱은 사이드바/상단 내비게이션이 복귀 동선이고, 모바일에서만 상단 바를 제공한다.
 *
 * 각 서브 앱의 layout.tsx 에 <BackToHubButton /> 추가하면 자동 노출.
 */
export default function BackToHubButton() {
  return (
    <nav
      aria-label="앱 내비게이션"
      className="md:hidden sticky top-0 z-40 border-b border-zinc-200/80 bg-white/95 px-3 py-2 shadow-[0_1px_0_rgba(24,24,27,0.04)] backdrop-blur dark:border-zinc-800/90 dark:bg-zinc-950/95"
      style={{ paddingTop: "calc(0.5rem + env(safe-area-inset-top))" }}
    >
      <div className="flex h-10 items-center justify-between gap-3">
        <Link
          href="/"
          title="대시보드로 돌아가기"
          aria-label="대시보드로 돌아가기"
          className="inline-flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 text-sm font-semibold text-zinc-800 transition-colors active:bg-zinc-100 dark:text-zinc-100 dark:active:bg-zinc-900"
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
            <ArrowLeft size={16} aria-hidden="true" />
          </span>
          <span className="truncate">대시보드</span>
        </Link>
        <div className="inline-flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-zinc-400 dark:text-zinc-500">
          <LayoutDashboard size={13} aria-hidden="true" />
          <span className="truncate">운영 허브</span>
        </div>
      </div>
    </nav>
  );
}
