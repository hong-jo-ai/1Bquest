import type { Metadata } from "next";
import BackToHubButton from "@/components/BackToHubButton";

export const metadata: Metadata = {
  title:       "채널 가격 관리 — PAULVICE",
  description: "5채널 판매가 · 할인가 · 마진 매트릭스",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <><BackToHubButton />{children}</>;
}
