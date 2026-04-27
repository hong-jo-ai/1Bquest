import type { Metadata } from "next";

export const metadata: Metadata = {
  title:       "CS 인박스 — PAULVICE",
  description: "Cafe24 · Instagram · Threads · Naver · Crisp 통합 고객 응대",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
