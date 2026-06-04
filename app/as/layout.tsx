import type { Metadata } from "next";
import BackToHubButton from "@/components/BackToHubButton";

export const metadata: Metadata = {
  title: "AS 수리 추적 — PAULVICE",
  description: "수리 접수 → 수리 → 안내 → 발송까지 한 곳에서 추적. 모델·증상으로 완료품 매칭.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <BackToHubButton />
      {children}
    </>
  );
}
