import type { Metadata } from "next";
import CareClient from "./CareClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "PAULVICE CARE — 구매자 케어 등록",
  description: "구매하신 PAULVICE를 등록하고 배터리 교체 1회 무료 혜택을 받으세요.",
  robots: { index: false, follow: false },   // 고객이 QR로만 들어오는 페이지 — 검색 노출 불필요
};

/** QR 에 ?s=musinsa 처럼 유입 경로를 실어 보내면 어느 상자에서 왔는지 구분된다. */
export default async function CarePage({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  const { s } = await searchParams;
  return <CareClient source={s} />;
}
