import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { getThreadsTokenFromStore } from "@/lib/threadsTokenStore";
import { BRAND_LIST, type BrandId } from "@/lib/threadsBrands";

const THREADS_BASE = "https://graph.threads.net/v1.0";

interface ThreadPost {
  id: string;
  text?: string;
  timestamp?: string;
  permalink?: string;
}

interface PostWithMetrics {
  threadId: string;
  text: string;
  publishedAt: string;
  likes: number;
  replies: number;
  views: number;
  permalink: string | null;
  brand: BrandId;
  hour: number;
}

interface BrandAnalytics {
  brand: BrandId;
  brandName: string;
  emoji: string;
  connected: boolean;
  followerCount: number | null;
  posts: PostWithMetrics[];
  totalPosts: number;
  totalLikes: number;
  totalReplies: number;
  totalViews: number;
  avgLikes: number;
  avgReplies: number;
  engagementRate: number;
  // 주간 비교
  thisWeekPosts: number;
  thisWeekLikes: number;
  lastWeekLikes: number;
  likesChange: number | null;
  // 시간대별 성과
  hourlyPerformance: Array<{ hour: number; avgLikes: number; count: number }>;
  // 일별 추이
  dailyTrend: Array<{ date: string; likes: number; replies: number; posts: number }>;
}

/**
 * GET /api/threads/analytics
 * 모든 브랜드의 종합 분석 데이터
 */
export async function GET(req: NextRequest) {
  const cookieStore = await cookies();
  const results: BrandAnalytics[] = [];

  for (const brandConfig of BRAND_LIST) {
    const brand = brandConfig.id;
    const token =
      cookieStore.get(`threads_at_${brand}`)?.value ||
      (await getThreadsTokenFromStore(brand)) ||
      null;

    if (!token) {
      results.push({
        brand,
        brandName: brandConfig.name,
        emoji: brandConfig.emoji,
        connected: false,
        followerCount: null,
        posts: [],
        totalPosts: 0,
        totalLikes: 0,
        totalReplies: 0,
        totalViews: 0,
        avgLikes: 0,
        avgReplies: 0,
        engagementRate: 0,
        thisWeekPosts: 0,
        thisWeekLikes: 0,
        lastWeekLikes: 0,
        likesChange: null,
        hourlyPerformance: [],
        dailyTrend: [],
      });
      continue;
    }

    try {
      // 프로필 정보 (팔로워 수)
      let followerCount: number | null = null;
      try {
        const profileRes = await fetch(
          `${THREADS_BASE}/me?fields=id,username,threads_profile_picture_url&access_token=${token}`,
          { cache: "no-store" },
        );
        if (profileRes.ok) {
          // Threads API에서 follower_count 제공 시 사용
          // 현재는 null (API 제한)
        }
      } catch {}

      // 게시물 목록
      const threadsRes = await fetch(
        `${THREADS_BASE}/me/threads?fields=id,text,timestamp,permalink&limit=50&access_token=${token}`,
        { cache: "no-store" },
      );

      if (!threadsRes.ok) {
        results.push({
          brand, brandName: brandConfig.name, emoji: brandConfig.emoji,
          connected: true, followerCount: null, posts: [], totalPosts: 0,
          totalLikes: 0, totalReplies: 0, totalViews: 0,
          avgLikes: 0, avgReplies: 0, engagementRate: 0,
          thisWeekPosts: 0, thisWeekLikes: 0, lastWeekLikes: 0, likesChange: null,
          hourlyPerformance: [], dailyTrend: [],
        });
        continue;
      }

      const threadsData = await threadsRes.json();
      const threads: ThreadPost[] = threadsData.data ?? [];

      const posts: PostWithMetrics[] = [];

      for (const thread of threads) {
        if (!thread.text) continue;

        let likes = 0, replies = 0, views = 0;
        try {
          const insRes = await fetch(
            `${THREADS_BASE}/${thread.id}/insights?metric=likes,replies,views&access_token=${token}`,
            { cache: "no-store" },
          );
          if (insRes.ok) {
            const ins = await insRes.json();
            for (const m of ins.data ?? []) {
              if (m.name === "likes") likes = m.values?.[0]?.value ?? 0;
              if (m.name === "replies") replies = m.values?.[0]?.value ?? 0;
              if (m.name === "views") views = m.values?.[0]?.value ?? 0;
            }
          }
        } catch {}

        const publishedAt = thread.timestamp ?? new Date().toISOString();
        const hour = new Date(publishedAt).getHours();

        posts.push({
          threadId: thread.id,
          text: thread.text,
          publishedAt,
          likes, replies, views,
          permalink: thread.permalink ?? null,
          brand,
          hour,
        });
      }

      posts.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

      // 집계
      const totalLikes = posts.reduce((s, p) => s + p.likes, 0);
      const totalReplies = posts.reduce((s, p) => s + p.replies, 0);
      const totalViews = posts.reduce((s, p) => s + p.views, 0);
      const avgLikes = posts.length > 0 ? totalLikes / posts.length : 0;
      const avgReplies = posts.length > 0 ? totalReplies / posts.length : 0;
      const engagementRate = totalViews > 0 ? ((totalLikes + totalReplies) / totalViews) * 100 : 0;

      // 주간 비교
      const now = new Date();
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

      const thisWeekPosts = posts.filter(p => new Date(p.publishedAt) >= oneWeekAgo);
      const lastWeekPosts = posts.filter(p => {
        const d = new Date(p.publishedAt);
        return d >= twoWeeksAgo && d < oneWeekAgo;
      });

      const thisWeekLikes = thisWeekPosts.reduce((s, p) => s + p.likes, 0);
      const lastWeekLikes = lastWeekPosts.reduce((s, p) => s + p.likes, 0);
      const likesChange = lastWeekLikes > 0
        ? Math.round(((thisWeekLikes - lastWeekLikes) / lastWeekLikes) * 100)
        : null;

      // 시간대별 성과
      const hourMap = new Map<number, { totalLikes: number; count: number }>();
      for (const p of posts) {
        const entry = hourMap.get(p.hour) ?? { totalLikes: 0, count: 0 };
        entry.totalLikes += p.likes;
        entry.count += 1;
        hourMap.set(p.hour, entry);
      }
      const hourlyPerformance = Array.from(hourMap.entries())
        .map(([hour, v]) => ({ hour, avgLikes: v.count > 0 ? Math.round(v.totalLikes / v.count * 10) / 10 : 0, count: v.count }))
        .sort((a, b) => a.hour - b.hour);

      // 일별 추이 (최근 30일)
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const dayMap = new Map<string, { likes: number; replies: number; posts: number }>();
      for (const p of posts) {
        if (new Date(p.publishedAt) < thirtyDaysAgo) continue;
        const date = new Date(p.publishedAt).toISOString().split("T")[0];
        const entry = dayMap.get(date) ?? { likes: 0, replies: 0, posts: 0 };
        entry.likes += p.likes;
        entry.replies += p.replies;
        entry.posts += 1;
        dayMap.set(date, entry);
      }
      const dailyTrend = Array.from(dayMap.entries())
        .map(([date, v]) => ({ date, ...v }))
        .sort((a, b) => a.date.localeCompare(b.date));

      results.push({
        brand,
        brandName: brandConfig.name,
        emoji: brandConfig.emoji,
        connected: true,
        followerCount,
        posts,
        totalPosts: posts.length,
        totalLikes,
        totalReplies,
        totalViews,
        avgLikes: Math.round(avgLikes * 10) / 10,
        avgReplies: Math.round(avgReplies * 10) / 10,
        engagementRate: Math.round(engagementRate * 100) / 100,
        thisWeekPosts: thisWeekPosts.length,
        thisWeekLikes,
        lastWeekLikes,
        likesChange,
        hourlyPerformance,
        dailyTrend,
      });
    } catch (e: any) {
      console.error(`[Analytics] ${brand} 실패:`, e.message);
      results.push({
        brand, brandName: brandConfig.name, emoji: brandConfig.emoji,
        connected: true, followerCount: null, posts: [], totalPosts: 0,
        totalLikes: 0, totalReplies: 0, totalViews: 0,
        avgLikes: 0, avgReplies: 0, engagementRate: 0,
        thisWeekPosts: 0, thisWeekLikes: 0, lastWeekLikes: 0, likesChange: null,
        hourlyPerformance: [], dailyTrend: [],
      });
    }
  }

  return NextResponse.json({ brands: results });
}
