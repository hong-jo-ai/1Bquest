import { cookies } from "next/headers";
import { type NextRequest } from "next/server";
import { getThreadsTokenFromStore } from "@/lib/threadsTokenStore";
import { getRecentPublished } from "@/lib/threadsScheduler";
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

  // 현재 토큰의 username 조회
  let myUsername = "";
  try {
    const meRes = await fetch(`${THREADS_BASE}/me?fields=id,username&access_token=${token}`, { cache: "no-store" });
    if (meRes.ok) {
      const me = await meRes.json();
      myUsername = me.username ?? "";
    }
  } catch {}

  const allPublished = await getRecentPublished();
  // brand 필드가 있으면 그걸로, 없으면 API로 소유권 확인
  const published = allPublished.filter((p) => {
    if (p.brand) return p.brand === brand;
    return true; // brand 없는 기존 글은 API 조회로 필터링
  });
  if (published.length === 0) {
    return NextResponse.json({ posts: [] });
  }

  const posts: PublishedPostWithMetrics[] = [];

  for (const post of published) {
    let likes = 0, replies = 0, permalink: string | null = null, text = post.text;

    try {
      // 기본 필드로 먼저 시도
      const res = await fetch(
        `${THREADS_BASE}/${post.threadId}?fields=id,text,permalink&access_token=${token}`,
        { cache: "no-store" }
      );
      if (!res.ok) continue; // 다른 계정 글이거나 삭제된 글 → 제외
      const data = await res.json();
      text = data.text ?? post.text;
      permalink = data.permalink ?? null;

      // 인사이트 필드 별도 시도 (권한 없으면 무시)
      try {
        const insRes = await fetch(
          `${THREADS_BASE}/${post.threadId}?fields=like_count,reply_count&access_token=${token}`,
          { cache: "no-store" }
        );
        if (insRes.ok) {
          const ins = await insRes.json();
          likes = ins.like_count ?? 0;
          replies = ins.reply_count ?? 0;
        }
      } catch {}
    } catch {
      continue;
    }

    posts.push({ threadId: post.threadId, text, publishedAt: post.publishedAt, likes, replies, views: 0, permalink, brand });
  }

  // 최신순 정렬
  posts.sort(
    (a, b) =>
      new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  );

  return NextResponse.json({ posts });
}
