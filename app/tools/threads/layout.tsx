import type { Metadata } from "next";
import BackToHubButton from "@/components/BackToHubButton";

export const metadata: Metadata = {
  title:       "쓰레드 — PAULVICE",
  description: "쓰레드 자동 발행 · 댓글 응대 · 성과 분석",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <><BackToHubButton />{children}</>;
}
