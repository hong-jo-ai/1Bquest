import type { Metadata } from "next";
import BackToHubButton from "@/components/BackToHubButton";

export const metadata: Metadata = {
  title:       "화보 메이커 — PAULVICE",
  description: "AI 이미지 생성 · 모델 화보 자동 제작",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <><BackToHubButton />{children}</>;
}
