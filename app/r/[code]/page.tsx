import ReviewPage from "@/app/review/[token]/ReviewPage";
import { resolveReviewCode } from "@/lib/reviews/shortlink";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

/** 짧은 링크 /r/<code> → 토큰 조회 후 리뷰 폼 렌더. */
export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const token = await resolveReviewCode(code);
  return <ReviewPage token={token} />;
}
