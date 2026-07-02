import type { Metadata } from "next";
import ReviewPage from "@/app/review/[token]/ReviewPage";
import { resolveReviewCode } from "@/lib/reviews/shortlink";
import { reviewTitleFromToken } from "@/lib/reviews/core";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const { code } = await params;
  const token = await resolveReviewCode(code);
  return { title: reviewTitleFromToken(token), robots: { index: false, follow: false } };
}

/** 짧은 링크 /r/<code> → 토큰 조회 후 리뷰 폼 렌더. */
export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const token = await resolveReviewCode(code);
  return <ReviewPage token={token} />;
}
