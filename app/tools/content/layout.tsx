import type { Metadata } from "next";

export const metadata: Metadata = {
  title:       "콘텐츠 — PAULVICE",
  description: "AI 콘텐츠 스튜디오 · 캡션 · 영상 스크립트",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
