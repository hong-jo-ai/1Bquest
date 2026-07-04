import type { Metadata } from "next";
import BackToHubButton from "@/components/BackToHubButton";

export const metadata: Metadata = {
  title: "파쇼 발주 — 생산 원장 · 거래 양식",
  description: "파쇼(조성섭) 발주·사급·납품 트래킹 + 발주서·거래명세서·사급출고증 인쇄.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <BackToHubButton />
      {children}
    </>
  );
}
