import { cookies } from "next/headers";
import { type NextRequest } from "next/server";
import { getThreadsTokenFromStore } from "@/lib/threadsTokenStore";
import { NextResponse } from "next/server";
import type { BrandId } from "@/lib/threadsBrands";

const THREADS_BASE = "https://graph.threads.net/v1.0";

export interface PublishedPostWithMetrics {
  threadId: string;
  text: string;
  publishedAt: string;
  likes: number;
  replies: number;
  views: number;
  permalink: string | null;
  brand?: string;
}

export async function GET(req: NextRequest) {
  const brand = (req.nextUrl.searchParams.get("brand") ?? "paulvice") as BrandId;

  const cookieStore = await cookies();
  const token =
    cookieStore.get(`threads_at_${brand}`)?.value ||
    (await getThreadsTokenFromStore(brand)) ||
    null;

  if (!token) {
    return NextResponse.json({ error: "Threads 미연결" }, { status: 401 });
  }

  // Threads API에서 실제 게시물 목록 가져오기
  const threadsRes = await fetch(
    `${THREADS_BASE}/me/threads?fields=id,text,timestamp,permalink&limit=50&access_token=${token}`,
    { cache: "no-store" }
  );

  if (!threadsRes.ok) {
    const err = await threadsRes.text();
    console.error("[Threads published] API 조회 실패:", err);
    return NextResponse.json({ error: "게시물 조회 실패" }, { status: threadsRes.status });
  }

  const threadsData = await threadsRes.json();
  const threads: Array<{ id: string; text?: string; timestamp?: string; permalink?: string }> =
    threadsData.data ?? [];

  if (threads.length === 0) {
    return NextResponse.json({ posts: [] });
  }

  const posts: PublishedPostWithMetrics[] = [];

  for (const thread of threads) {
    if (!thread.text) continue; // 미디어 전용 글 등 텍스트 없으면 스킵

    let likes = 0, replies = 0, views = 0;

    // Insights API로 좋아요/댓글/조회수 조회
    try {
      const insRes = await fetch(
        `${THREADS_BASE}/${thread.id}/insights?metric=likes,replies,views&access_token=${token}`,
        { cache: "no-store" }
      );
      if (insRes.ok) {
        const ins = await insRes.json();
        for (const m of ins.data ?? []) {
          if (m.name === "likes") likes = m.values?.[0]?.value ?? 0;
          if (m.name === "replies") replies = m.values?.[0]?.value ?? 0;
          if (m.name === "views") views = m.values?.[0]?.value ?? 0;
        }
      } else {
        const errText = await insRes.text();
        console.error(`[Threads published] Insights 실패 (${thread.id}, ${brand}):`, insRes.status, errText);
      }
    } catch (insErr) {
      console.error(`[Threads published] Insights 예외 (${thread.id}, ${brand}):`, insErr);
    }

    posts.push({
      threadId: thread.id,
      text: thread.text,
      publishedAt: thread.timestamp ?? new Date().toISOString(),
      likes,
      replies,
      views,
      permalink: thread.permalink ?? null,
      brand,
    });
  }

  // 최신순 정렬
  posts.sort(
    (a, b) =>
      new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  );

  return NextResponse.json({ posts });
}
