import type { Metadata } from "next";
import BackToHubButton from "@/components/BackToHubButton";

export const metadata: Metadata = {
  title:       "MADS — 광고 의사결정 시스템",
  description: "Meta 광고 의사결정 강제 시스템 · 신뢰등급 + BE ROAS 기반 추천",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <><BackToHubButton />{children}</>;
}
