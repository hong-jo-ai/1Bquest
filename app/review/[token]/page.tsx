import type { Metadata } from "next";
import ReviewPage from "./ReviewPage";
import { reviewTitleFromToken } from "@/lib/reviews/core";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  return { title: reviewTitleFromToken(token), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ReviewPage token={token} />;
}
