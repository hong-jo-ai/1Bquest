import type { Metadata } from "next";

export const metadata: Metadata = {
  title:       "재무 — PAULVICE",
  description: "폴바이스 매출 · 비용 · P&L 통합 관리",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
