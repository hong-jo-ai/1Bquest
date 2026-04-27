import type { Metadata } from "next";

export const metadata: Metadata = {
  title:       "공동구매 — PAULVICE",
  description: "공동구매 캠페인 운영 · 제안서 · 정산",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
