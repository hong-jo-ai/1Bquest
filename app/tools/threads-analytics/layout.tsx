import type { Metadata } from "next";
import BackToHubButton from "@/components/BackToHubButton";

export const metadata: Metadata = {
  title:       "쓰레드 분석 — PAULVICE",
  description: "쓰레드 게시물 인사이트 · 도달 · 참여",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <><BackToHubButton />{children}</>;
}
