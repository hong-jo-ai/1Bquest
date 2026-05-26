import type { Metadata } from "next";
import BackToHubButton from "@/components/BackToHubButton";

export const metadata: Metadata = {
  title:       "고객 안내 SMS — PAULVICE",
  description: "배송지연 · AS 등 아웃바운드 고객 공지 발송",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <><BackToHubButton />{children}</>;
}
