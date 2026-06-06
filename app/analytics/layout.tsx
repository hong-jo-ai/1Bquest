import type { Metadata } from "next";
import BackToHubButton from "@/components/BackToHubButton";

export const metadata: Metadata = {
  title:       "방문자 분석 — PAULVICE",
  description: "Cafe24 트래픽 · 유입 채널 분석",
  manifest: "/manifest-dashboard.webmanifest",
  appleWebApp: {
    capable: true,
    title: "대시보드",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "/app-icon-dashboard-512.png",
    apple: "/app-icon-dashboard-180.png",
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <><BackToHubButton />{children}</>;
}
