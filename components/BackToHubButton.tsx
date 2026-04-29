import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/**
 * 서브 앱(재무/광고/CS/...)에서 대시보드(hub)로 돌아가는 작은 floating 버튼.
 * 모바일·데스크탑 모두 좌상단 고정 — Sidebar 없는 standalone 레이아웃의 유일한 복귀 동선.
 *
 * 각 서브 앱의 layout.tsx 에 <BackToHubButton /> 추가하면 자동 노출.
 */
export default function BackToHubButton() {
  return (
    <Link
      href="/"
      title="대시보드로 돌아가기"
      className="fixed top-3 left-3 z-50 flex items-center gap-1.5 bg-white/90 dark:bg-zinc-900/90 backdrop-blur border border-zinc-200 dark:border-zinc-700 shadow-sm hover:shadow-md hover:bg-zinc-50 dark:hover:bg-zinc-800 active:scale-95 px-3 py-1.5 rounded-full text-xs font-medium text-zinc-700 dark:text-zinc-300 transition-all"
    >
      <ArrowLeft size={12} />
      <span>대시보드</span>
    </Link>
  );
}
