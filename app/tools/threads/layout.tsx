import type { Metadata } from "next";
import BackToHubButton from "@/components/BackToHubButton";

export const metadata: Metadata = {
  title:       "쓰레드 — PAULVICE",
  description: "쓰레드 자동 발행 · 댓글 응대 · 성과 분석",
  manifest: "/manifest-threads.webmanifest",
  appleWebApp: {
    capable: true,
    title: "쓰레드",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "/app-icon-threads-512.png",
    apple: "/app-icon-threads-180.png",
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <><BackToHubButton />{children}</>;
}
