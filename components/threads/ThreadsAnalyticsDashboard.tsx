"use client";

import { useState, useEffect } from "react";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell,
  AreaChart, Area,
} from "recharts";
import {
  TrendingUp, TrendingDown, Heart, MessageCircle, Eye,
  Loader2, BarChart2, Clock, Zap, ArrowUpRight, ArrowDownRight,
  Minus, RefreshCw,
} from "lucide-react";
import type { BrandId } from "@/lib/threadsBrands";

// ── 타입 ──────────────────────────────────────────────────────────────────

interface PostWithMetrics {
  threadId: string;
  text: string;
  publishedAt: string;
  likes: number;
  replies: number;
  views: number;
  brand: BrandId;
  hour: number;
}

interface BrandAnalytics {
  brand: BrandId;
  brandName: string;
  emoji: string;
  connected: boolean;
  totalPosts: number;
  totalLikes: number;
  totalReplies: number;
  totalViews: number;
  avgLikes: number;
  avgReplies: number;
  engagementRate: number;
  thisWeekPosts: number;
  thisWeekLikes: number;
  lastWeekLikes: number;
  likesChange: number | null;
  hourlyPerformance: Array<{ hour: number; avgLikes: number; count: number }>;
  dailyTrend: Array<{ date: string; likes: number; replies: number; posts: number }>;
  posts: PostWithMetrics[];
}

// ── 색상 ──────────────────────────────────────────────────────────────────

const BRAND_COLORS: Record<BrandId, string> = {
  paulvice: "#8b5cf6",
  harriot: "#f59e0b",
  hongsungjo: "#3b82f6",
};

const BRAND_COLORS_LIGHT: Record<BrandId, string> = {
  paulvice: "#c4b5fd",
  harriot: "#fcd34d",
  hongsungjo: "#93c5fd",
};

// ── 변화율 뱃지 ───────────────────────────────────────────────────────────

function ChangeBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="text-[10px] text-zinc-400">데이터 부족</span>;
  if (value === 0) return (
    <span className="flex items-center gap-0.5 text-[10px] text-zinc-400">
      <Minus size={10} /> 변동 없음
    </span>
  );
  const isUp = value > 0;
  return (
    <span className={`flex items-center gap-0.5 text-[10px] font-semibold ${isUp ? "text-emerald-500" : "text-rose-500"}`}>
      {isUp ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
      {isUp ? "+" : ""}{value}%
    </span>
  );
}

// ── 요약 카드 ─────────────────────────────────────────────────────────────

function StatCard({ label, value, suffix, icon: Icon, color, sub }: {
  label: string; value: string | number; suffix?: string;
  icon: React.ElementType; color: string; sub?: React.ReactNode;
}) {
  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-3 sm:p-4">
      <div className="flex items-center gap-2 mb-1.5 sm:mb-2">
        <div className={`w-6 h-6 sm:w-7 sm:h-7 rounded-lg flex items-center justify-center ${color}`}>
          <Icon size={13} className="text-white" />
        </div>
        <span className="text-[11px] sm:text-xs text-zinc-400">{label}</span>
      </div>
      <p className="text-xl sm:text-2xl font-bold text-zinc-800 dark:text-zinc-100">
        {typeof value === "number" ? value.toLocaleString("ko-KR") : value}
        {suffix && <span className="text-sm font-normal text-zinc-400 ml-1">{suffix}</span>}
      </p>
      {sub && <div className="mt-1">{sub}</div>}
    </div>
  );
}

// ── 브랜드 비교 카드 ──────────────────────────────────────────────────────

function BrandCompareCard({ brand }: { brand: BrandAnalytics }) {
  if (!brand.connected) {
    return (
      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-4 opacity-50">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg">{brand.emoji}</span>
          <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{brand.brandName}</span>
          <span className="text-[10px] text-zinc-400 ml-auto">미연결</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg">{brand.emoji}</span>
        <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{brand.brandName}</span>
        <ChangeBadge value={brand.likesChange} />
      </div>
      <div className="grid grid-cols-4 gap-3 text-center">
        <div>
          <p className="text-lg font-bold text-zinc-800 dark:text-zinc-100">{brand.totalPosts}</p>
          <p className="text-[10px] text-zinc-400">게시물</p>
        </div>
        <div>
          <p className="text-lg font-bold text-rose-500">{brand.totalLikes.toLocaleString()}</p>
          <p className="text-[10px] text-zinc-400">좋아요</p>
        </div>
        <div>
          <p className="text-lg font-bold text-violet-500">{brand.totalReplies.toLocaleString()}</p>
          <p className="text-[10px] text-zinc-400">댓글</p>
        </div>
        <div>
          <p className="text-lg font-bold text-blue-500">{brand.totalViews.toLocaleString()}</p>
          <p className="text-[10px] text-zinc-400">조회수</p>
        </div>
      </div>
      <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-800 grid grid-cols-3 gap-2 text-center text-[11px]">
        <div>
          <p className="font-semibold text-zinc-700 dark:text-zinc-300">{brand.avgLikes}</p>
          <p className="text-zinc-400">평균 좋아요</p>
        </div>
        <div>
          <p className="font-semibold text-zinc-700 dark:text-zinc-300">{brand.avgReplies}</p>
          <p className="text-zinc-400">평균 댓글</p>
        </div>
        <div>
          <p className="font-semibold text-zinc-700 dark:text-zinc-300">{brand.engagementRate}%</p>
          <p className="text-zinc-400">참여율</p>
        </div>
      </div>
    </div>
  );
}

// ── 베스트/워스트 게시물 ──────────────────────────────────────────────────

function TopPostsSection({ brands }: { brands: BrandAnalytics[] }) {
  const allPosts = brands.flatMap(b => b.posts.map(p => ({ ...p, brandName: b.brandName, emoji: b.emoji })));
  const sorted = [...allPosts].sort((a, b) => b.likes - a.likes);
  const top5 = sorted.slice(0, 5);

  if (top5.length === 0) return null;

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-5">
      <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 mb-4 flex items-center gap-2">
        <Zap size={14} className="text-amber-500" />
        베스트 게시물 TOP 5
      </h3>
      <div className="space-y-3">
        {top5.map((post, i) => (
          <div key={post.threadId} className="flex items-start gap-3">
            <span className={`text-sm font-bold w-6 text-center flex-shrink-0 ${i === 0 ? "text-amber-500" : "text-zinc-400"}`}>
              {i + 1}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-xs">{post.emoji}</span>
                <span className="text-[10px] text-zinc-400">{post.brandName}</span>
              </div>
              <p className="text-sm text-zinc-700 dark:text-zinc-300 line-clamp-2">{post.text}</p>
              <div className="flex items-center gap-3 mt-1 text-[11px] text-zinc-400">
                <span>❤️ {post.likes}</span>
                <span>💬 {post.replies}</span>
                <span>👁 {post.views.toLocaleString()}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 주간 리포트 ───────────────────────────────────────────────────────────

function WeeklyReport({ brands }: { brands: BrandAnalytics[] }) {
  const connected = brands.filter(b => b.connected && b.totalPosts > 0);
  if (connected.length === 0) return null;

  return (
    <div className="bg-gradient-to-br from-zinc-900 to-zinc-800 dark:from-zinc-800 dark:to-zinc-900 rounded-2xl p-5 text-white">
      <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
        <BarChart2 size={14} className="text-zinc-400" />
        이번 주 리포트
      </h3>
      <div className="space-y-3">
        {connected.map(b => {
          const bestPost = b.posts
            .filter(p => {
              const d = new Date(p.publishedAt);
              return d >= new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            })
            .sort((a, bb) => bb.likes - a.likes)[0];

          return (
            <div key={b.brand} className="bg-white/5 rounded-xl p-3">
              <div className="flex items-center gap-2 mb-2">
                <span>{b.emoji}</span>
                <span className="text-sm font-semibold">{b.brandName}</span>
                <ChangeBadge value={b.likesChange} />
              </div>
              <p className="text-xs text-zinc-300">
                게시 <b className="text-white">{b.thisWeekPosts}개</b> ·
                좋아요 <b className="text-rose-400">{b.thisWeekLikes.toLocaleString()}</b> ·
                평균 <b className="text-white">{b.thisWeekPosts > 0 ? Math.round(b.thisWeekLikes / b.thisWeekPosts) : 0}</b>/글
              </p>
              {bestPost && (
                <p className="text-[11px] text-zinc-400 mt-1 line-clamp-1">
                  최고 참여: &ldquo;{bestPost.text.slice(0, 50)}...&rdquo; (❤️{bestPost.likes})
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 메인 대시보드 ─────────────────────────────────────────────────────────

export default function ThreadsAnalyticsDashboard() {
  const [brands, setBrands] = useState<BrandAnalytics[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/threads/analytics");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "조회 실패");
      setBrands(data.brands ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center">
        <div className="flex items-center gap-3">
          <Loader2 size={24} className="animate-spin text-zinc-400" />
          <span className="text-sm text-zinc-400">전체 브랜드 데이터 수집 중...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center">
        <p className="text-red-500">{error}</p>
      </div>
    );
  }

  const connected = brands.filter(b => b.connected);
  const grandTotalLikes = brands.reduce((s, b) => s + b.totalLikes, 0);
  const grandTotalReplies = brands.reduce((s, b) => s + b.totalReplies, 0);
  const grandTotalViews = brands.reduce((s, b) => s + b.totalViews, 0);
  const grandTotalPosts = brands.reduce((s, b) => s + b.totalPosts, 0);

  // 브랜드 비교 차트 데이터
  const brandCompareData = connected.map(b => ({
    name: b.brandName,
    좋아요: b.totalLikes,
    댓글: b.totalReplies,
    조회수: b.totalViews,
  }));

  // 전체 일별 추이 합산
  const allDailyMap = new Map<string, Record<string, number>>();
  for (const b of connected) {
    for (const d of b.dailyTrend) {
      const entry = allDailyMap.get(d.date) ?? {};
      entry[b.brandName] = (entry[b.brandName] ?? 0) + d.likes;
      entry._total = (entry._total ?? 0) + d.likes;
      allDailyMap.set(d.date, entry);
    }
  }
  const combinedDaily = Array.from(allDailyMap.entries())
    .map(([date, v]) => ({ date: date.slice(5), ...v }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // 시간대별 전체 성과
  const hourlyMap = new Map<number, { totalLikes: number; count: number }>();
  for (const b of connected) {
    for (const h of b.hourlyPerformance) {
      const entry = hourlyMap.get(h.hour) ?? { totalLikes: 0, count: 0 };
      entry.totalLikes += h.avgLikes * h.count;
      entry.count += h.count;
      hourlyMap.set(h.hour, entry);
    }
  }
  const hourlyData = Array.from({ length: 24 }, (_, h) => {
    const entry = hourlyMap.get(h);
    return {
      hour: `${h}시`,
      평균좋아요: entry && entry.count > 0 ? Math.round((entry.totalLikes / entry.count) * 10) / 10 : 0,
      게시수: entry?.count ?? 0,
    };
  });

  // 참여율 비교 (pie)
  const engagementPieData = connected
    .filter(b => b.totalLikes + b.totalReplies > 0)
    .map(b => ({
      name: b.brandName,
      value: b.totalLikes + b.totalReplies,
    }));

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 px-3 py-4 sm:p-6">
      <div className="max-w-6xl mx-auto space-y-4 sm:space-y-6">

        {/* 헤더 */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h1 className="text-lg sm:text-xl font-bold text-zinc-800 dark:text-zinc-100">Threads 종합 대시보드</h1>
            <p className="text-[11px] sm:text-xs text-zinc-400 mt-0.5">전체 브랜드 성과 분석 · 성장 추이 · 콘텐츠 전략</p>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="/tools/threads"
              className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
            >
              스튜디오 &rarr;
            </a>
            <button
              onClick={fetchData}
              className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
            >
              <RefreshCw size={12} />
              새로고침
            </button>
          </div>
        </div>

        {/* 전체 요약 */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
          <StatCard
            label="총 게시물" value={grandTotalPosts} suffix="개"
            icon={BarChart2} color="bg-blue-500"
          />
          <StatCard
            label="총 좋아요" value={grandTotalLikes}
            icon={Heart} color="bg-rose-500"
          />
          <StatCard
            label="총 댓글" value={grandTotalReplies}
            icon={MessageCircle} color="bg-violet-500"
          />
          <StatCard
            label="총 조회수" value={grandTotalViews}
            icon={Eye} color="bg-emerald-500"
          />
        </div>

        {/* 주간 리포트 + 브랜드 비교 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <WeeklyReport brands={brands} />

          {/* 브랜드별 참여 비율 */}
          {engagementPieData.length > 0 && (
            <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-4 sm:p-5">
              <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 mb-3 sm:mb-4">브랜드별 참여 비율</h3>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie
                    data={engagementPieData}
                    cx="50%" cy="50%"
                    innerRadius={50} outerRadius={80}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {engagementPieData.map((entry, i) => {
                      const brand = connected.find(b => b.brandName === entry.name);
                      return <Cell key={i} fill={brand ? BRAND_COLORS[brand.brand] : "#999"} />;
                    })}
                  </Pie>
                  <Tooltip formatter={(val) => Number(val).toLocaleString()} />
                  <Legend
                    formatter={(value) => <span className="text-xs text-zinc-600 dark:text-zinc-400">{value}</span>}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* 브랜드별 카드 */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
          {brands.map(b => <BrandCompareCard key={b.brand} brand={b} />)}
        </div>

        {/* 일별 좋아요 추이 */}
        {combinedDaily.length > 0 && (
          <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-4 sm:p-5">
            <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 mb-3 sm:mb-4 flex items-center gap-2">
              <TrendingUp size={14} className="text-emerald-500" />
              일별 좋아요 추이 (30일)
            </h3>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={combinedDaily}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="#a1a1aa" interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10 }} stroke="#a1a1aa" width={35} />
                <Tooltip />
                {connected.map(b => (
                  <Area
                    key={b.brand}
                    type="monotone"
                    dataKey={b.brandName}
                    stackId="1"
                    stroke={BRAND_COLORS[b.brand]}
                    fill={BRAND_COLORS_LIGHT[b.brand]}
                    fillOpacity={0.6}
                  />
                ))}
                <Legend
                  formatter={(value) => <span className="text-xs text-zinc-600 dark:text-zinc-400">{value}</span>}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* 브랜드 비교 차트 */}
        {brandCompareData.length > 0 && (
          <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-4 sm:p-5">
            <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 mb-3 sm:mb-4">브랜드 비교</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={brandCompareData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="#a1a1aa" />
                <YAxis tick={{ fontSize: 10 }} stroke="#a1a1aa" width={35} />
                <Tooltip />
                <Legend
                  formatter={(value) => <span className="text-xs text-zinc-600 dark:text-zinc-400">{value}</span>}
                />
                <Bar dataKey="좋아요" fill="#f43f5e" radius={[4, 4, 0, 0]} />
                <Bar dataKey="댓글" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* 시간대별 성과 */}
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-4 sm:p-5">
          <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 mb-3 sm:mb-4 flex items-center gap-2">
            <Clock size={14} className="text-blue-500" />
            시간대별 평균 좋아요
          </h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={hourlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
              <XAxis dataKey="hour" tick={{ fontSize: 9 }} stroke="#a1a1aa" interval={3} />
              <YAxis tick={{ fontSize: 11 }} stroke="#a1a1aa" />
              <Tooltip />
              <Bar dataKey="평균좋아요" fill="#3b82f6" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <p className="text-[11px] text-zinc-400 text-center mt-2">
            게시 시간대별 평균 좋아요 — 성과가 높은 시간대에 게시하면 효과적
          </p>
        </div>

        {/* 베스트 게시물 */}
        <TopPostsSection brands={brands} />

        {/* 안내 */}
        <p className="text-[11px] text-zinc-400 text-center pb-6">
          최근 50개 게시물 기준 분석 · 데이터는 Threads API 실시간 조회
        </p>
      </div>
    </div>
  );
}
