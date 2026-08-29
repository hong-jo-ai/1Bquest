import type { Metadata } from "next";
import ReviewPage from "@/app/review/[token]/ReviewPage";
import { resolveReviewCode, recordReviewLinkClick } from "@/lib/reviews/shortlink";
import { reviewTitleFromToken } from "@/lib/reviews/core";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const { code } = await params;
  const token = await resolveReviewCode(code);
  return { title: reviewTitleFromToken(token), robots: { index: false, follow: false } };
}

/** 짧은 링크 /r/<code> → 토큰 조회 후 리뷰 폼 렌더. 열람은 퍼널 집계용으로 기록. */
export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const token = await resolveReviewCode(code);
  // generateMetadata 도 같은 코드를 조회하지만 클릭은 여기서만 센다(중복 방지).
  await recordReviewLinkClick(code);
  return <ReviewPage token={token} />;
}
