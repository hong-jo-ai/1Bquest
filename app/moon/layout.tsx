import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "그날의 달 — HARRIOT",
  description: "오래 남아 있는 밤의 달을 한 장의 기록으로 간직하세요.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#e9e9e2",
};

export default function MoonLayout({ children }: { children: React.ReactNode }) {
  return children;
}
