import Link from "next/link";
import { Home } from "lucide-react";

/**
 * 서브 앱(재무/광고/CS/...)에서 대시보드(hub)로 돌아가는 floating 버튼.
 * 모바일·데스크탑 모두 우하단 고정 — Sidebar 없는 standalone 레이아웃의 복귀 동선.
 * 좌상단은 사이드바 토글/뒤로가기 등 앱 자체 UI 와 자주 겹쳐서 우하단으로 이동.
 *
 * 각 서브 앱의 layout.tsx 에 <BackToHubButton /> 추가하면 자동 노출.
 */
export default function BackToHubButton() {
  return (
    <Link
      href="/"
      title="대시보드로 돌아가기"
      aria-label="대시보드로 돌아가기"
      className="fixed bottom-4 right-4 z-50 flex items-center gap-1.5 bg-zinc-900/90 dark:bg-zinc-100/90 hover:bg-zinc-900 dark:hover:bg-white backdrop-blur shadow-lg hover:shadow-xl active:scale-95 px-4 py-2.5 rounded-full text-xs font-semibold text-white dark:text-zinc-900 transition-all"
    >
      <Home size={13} />
      <span>대시보드</span>
    </Link>
  );
}
