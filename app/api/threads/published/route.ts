import { cookies } from "next/headers";
import { getThreadsTokenFromStore } from "@/lib/threadsTokenStore";
import { getRecentPublished } from "@/lib/threadsScheduler";
import { NextResponse } from "next/server";

const THREADS_BASE = "https://graph.threads.net/v1.0";

export interface PublishedPostWithMetrics {
  threadId: string;
  text: string;
  publishedAt: string;
  likes: number;
  replies: number;
  views: number;
  permalink: string | null;
}

export async function GET() {
  const cookieStore = await cookies();
  const token =
    cookieStore.get("threads_at")?.value ||
    (await getThreadsTokenFromStore()) ||
    process.env.THREADS_ACCESS_TOKEN ||
    null;

  if (!token) {
    return NextResponse.json({ error: "Threads 미연결" }, { status: 401 });
  }

  const published = await getRecentPublished();
  if (published.length === 0) {
    return NextResponse.json({ posts: [] });
  }

  const posts: PublishedPostWithMetrics[] = [];

  for (const post of published) {
    try {
      const res = await fetch(
        `${THREADS_BASE}/${post.threadId}?fields=id,text,like_count,reply_count,permalink&access_token=${token}`,
        { cache: "no-store" }
      );
      if (!res.ok) {
        posts.push({
          threadId: post.threadId,
          text: post.text,
          publishedAt: post.publishedAt,
          likes: 0,
          replies: 0,
          views: 0,
          permalink: null,
        });
        continue;
      }
      const data = await res.json();
      posts.push({
        threadId: post.threadId,
        text: data.text ?? post.text,
        publishedAt: post.publishedAt,
        likes: data.like_count ?? 0,
        replies: data.reply_count ?? 0,
        views: 0,
        permalink: data.permalink ?? null,
      });
    } catch {
      posts.push({
        threadId: post.threadId,
        text: post.text,
        publishedAt: post.publishedAt,
        likes: 0,
        replies: 0,
        views: 0,
        permalink: null,
      });
    }
  }

  // 최신순 정렬
  posts.sort(
    (a, b) =>
      new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  );

  return NextResponse.json({ posts });
}
