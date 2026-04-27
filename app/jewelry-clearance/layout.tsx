import type { Metadata } from "next";

export const metadata: Metadata = {
  title:       "주얼리 청산 — PAULVICE",
  description: "데드스톡 정리 · 청산 가격 운영",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
