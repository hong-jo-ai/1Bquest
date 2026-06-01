import type { Metadata, Viewport } from "next";
import BackToHubButton from "@/components/BackToHubButton";

export const metadata: Metadata = {
  title:       "MORI — 모리",
  description: "해리엇/폴바이스 1인 운영 비서",
};

// 모바일: 노치/홈인디케이터 아래까지 채우고(safe-area 활성화),
// 키보드가 떠도 레이아웃이 리사이즈돼 하단 입력창이 가려지지 않게.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <><BackToHubButton />{children}</>;
}
