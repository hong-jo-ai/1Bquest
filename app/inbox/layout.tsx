import type { Metadata } from "next";

export const metadata: Metadata = {
  title:       "CS 인박스 — PAULVICE",
  description: "Cafe24 · Instagram · Threads · Naver · Crisp 통합 고객 응대",
};

// BackToHubButton 은 InboxClient 내부에서 selectedId 에 따라 조건부 렌더링한다
// (모바일 상세 오버레이에서 입력창과 겹치는 문제 해결).
export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
