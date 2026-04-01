"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Users, Eye, ShoppingCart, TrendingUp, TrendingDown,
  Minus, AlertCircle, Sparkles, LogIn, RefreshCw,
  Loader2, BarChart2, MousePointerClick, Zap, Target,
  ArrowUpRight, ArrowDownRight, ChevronRight, Info,
} from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import type { AnalyticsData, DailyVisitorData } from "@/app/api/analytics/visitors/route";
import type { AnalyticsAIResult } from "@/app/api/analytics/ai/route";

// ── 색상 팔레트 ──────────────────────────────────────────────────────────────
const COLORS = ["#8b5cf6", "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#6366f1"];

type Tab = "overview" | "traffic" | "conversion" | "ai";

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "overview",    label: "방문 현황",  icon: Users },
  { id: "traffic",     label: "유입 분석",  icon: MousePointerClick },
  { id: "conversion",  label: "전환 분석",  icon: ShoppingCart },
  { id: "ai",          label: "AI 인사이트", icon: Sparkles },
];

// ── 포매터 ────────────────────────────────────────────────────────────────
function fmtKRW(n: number) {
  if (n >= 100_000_000) return (n / 100_000_000).toFixed(1) + "억원";
  if (n >= 10_000) return Math.round(n / 10_000) + "만원";
  return n.toLocaleString("ko-KR") + "원";
}
function fmtNum(n: number) {
  if (n >= 10_000) return (n / 10_000).toFixed(1) + "만";
  return n.toLocaleString("ko-KR");
}
function pctDiff(a: number, b: number) {
  if (b === 0) return null;
  return ((a - b) / b) * 100;
}
function shortDate(ds: string) {
  const [, m, d] = ds.split("-");
  return `${parseInt(m)}/${parseInt(d)}`;
}

// ── KPI 카드 ────────────────────────────────────────────────────────────
function KpiCard({
  label, value, sub, icon: Icon, color, trend, trendLabel,
}: {
  label: string; value: string; sub?: string;
  icon: React.ElementType; color: string;
  trend?: number | null; trendLabel?: string;
}) {
  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-5">
      <div className="flex items-start justify-between mb-3">
        <p className="text-xs font-medium text-zinc-500">{label}</p>
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${color}`}>
          <Icon size={14} className="text-white" />
        </div>
      </div>
      <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 leading-none">{value}</p>
      {sub && <p className="text-xs text-zinc-400 mt-1.5">{sub}</p>}
      {trend != null && (
        <div className={`flex items-center gap-1 mt-2 text-xs font-medium ${
          trend > 0 ? "text-emerald-600" : trend < 0 ? "text-red-500" : "text-zinc-400"
        }`}>
          {trend > 0 ? <ArrowUpRight size={12} /> : trend < 0 ? <ArrowDownRight size={12} /> : <Minus size={12} />}
          {Math.abs(trend).toFixed(1)}% {trendLabel ?? "전주 대비"}
        </div>
      )}
    </div>
  );
}

// ── 커스텀 툴팁 ──────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 rounded-xl px-3 py-2 shadow-lg text-xs">
      <p className="font-medium text-zinc-600 mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color }} className="font-semibold">
          {p.name}: {typeof p.value === "number" && p.name?.includes("매출")
            ? fmtKRW(p.value)
            : p.value?.toLocaleString("ko-KR")}
        </p>
      ))}
    </div>
  );
}

// ── 미연결 상태 ──────────────────────────────────────────────────────────
function NotConnected() {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4">
      <div className="w-16 h-16 bg-violet-50 dark:bg-violet-950/30 rounded-2xl flex items-center justify-center">
        <BarChart2 size={28} className="text-violet-500" />
      </div>
      <div className="text-center">
        <h3 className="text-lg font-bold text-zinc-800 dark:text-zinc-100">카페24 연결이 필요합니다</h3>
        <p className="text-sm text-zinc-400 mt-1">카페24 계정을 연결하면 방문자 통계를 확인할 수 있어요</p>
      </div>
      <a
        href="/api/auth/login"
        className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors"
      >
        <LogIn size={15} />
        카페24 연결하기
      </a>
    </div>
  );
}

// ── Analytics Scope 안내 ──────────────────────────────────────────────────
function ScopeBanner({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-4 flex gap-3 items-start mb-6">
      <Info size={16} className="text-amber-600 mt-0.5 shrink-0" />
      <div className="flex-1">
        <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">방문자 상세 통계를 보려면 재연결이 필요합니다</p>
        <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
          현재 방문자 수·이탈률·유입경로 데이터는 카페24 <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded">mall.read_analytics</code> 권한이 필요합니다.
          아래 버튼으로 재연결하면 활성화됩니다.
        </p>
      </div>
      <a
        href="/api/auth/login"
        className="text-xs font-semibold text-amber-700 bg-amber-100 hover:bg-amber-200 dark:bg-amber-900 dark:hover:bg-amber-800 px-3 py-1.5 rounded-lg transition-colors shrink-0"
      >
        재연결
      </a>
    </div>
  );
}

// ── Score Gauge ─────────────────────────────────────────────────────────
function ScoreGauge({ score }: { score: number }) {
  const color = score >= 70 ? "#10b981" : score >= 50 ? "#f59e0b" : "#ef4444";
  const label = score >= 70 ? "양호" : score >= 50 ? "보통" : "주의";
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative w-24 h-24">
        <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
          <circle cx="50" cy="50" r="38" fill="none" stroke="#e4e4e7" strokeWidth="10" />
          <circle
            cx="50" cy="50" r="38" fill="none"
            stroke={color} strokeWidth="10"
            strokeDasharray={`${(score / 100) * 239} 239`}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold text-zinc-800 dark:text-zinc-100">{score}</span>
          <span className="text-[10px] text-zinc-400">/ 100</span>
        </div>
      </div>
      <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
        style={{ backgroundColor: color + "20", color }}>
        {label}
      </span>
    </div>
  );
}

// ── 메인 컴포넌트 ────────────────────────────────────────────────────────
export default function AnalyticsDashboard({ isAuthenticated }: { isAuthenticated: boolean }) {
  const [tab, setTab] = useState<Tab>("overview");
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<AnalyticsAIResult | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!isAuthenticated) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/analytics/visitors", { cache: "no-store" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "데이터 조회 실패");
      }
      const json = await res.json();
      setData(json);
      setLastUpdated(new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit" }));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const runAI = async () => {
    if (!data) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await fetch("/api/analytics/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analytics: data }),
      });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setAiResult(json);
      setTab("ai");
    } catch (e: any) {
      setAiError(e.message);
    } finally {
      setAiLoading(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <NotConnected />
      </div>
    );
  }

  // 주간 비교
  const recent7 = data ? data.daily.slice(-7) : [];
  const prev7   = data ? data.daily.slice(-14, -7) : [];
  const r7Visitors = recent7.reduce((s, d) => s + d.visitors, 0);
  const p7Visitors = prev7.reduce((s, d) => s + d.visitors, 0);
  const r7Orders   = recent7.reduce((s, d) => s + d.orders, 0);
  const p7Orders   = prev7.reduce((s, d) => s + d.orders, 0);
  const r7Revenue  = recent7.reduce((s, d) => s + d.revenue, 0);
  const p7Revenue  = prev7.reduce((s, d) => s + d.revenue, 0);

  // 차트 데이터 (7일/14일/30일)
  const chart30 = data?.daily.map(d => ({
    date: shortDate(d.date),
    방문자: d.visitors,
    주문: d.orders,
    "매출(만원)": Math.round(d.revenue / 10000),
  })) ?? [];

  const chart14 = chart30.slice(-14);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">방문자 분석</h2>
          <p className="text-sm text-zinc-400 mt-0.5">
            최근 30일 · {lastUpdated ? `${lastUpdated} 기준` : "로딩 중"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={runAI}
            disabled={!data || aiLoading}
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors"
          >
            {aiLoading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            AI 인사이트 분석
          </button>
          <button
            onClick={loadData}
            disabled={loading}
            className="p-2 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-zinc-500"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* 스코프 배너 */}
      <ScopeBanner show={!!(data as any)?.needsScope} />

      {/* 에러 */}
      {error && (
        <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 rounded-2xl p-4 flex gap-3">
          <AlertCircle size={16} className="text-red-500 mt-0.5 shrink-0" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* 로딩 */}
      {loading && !data && (
        <div className="flex justify-center py-20">
          <div className="flex flex-col items-center gap-3">
            <Loader2 size={32} className="animate-spin text-violet-500" />
            <p className="text-sm text-zinc-400">데이터를 불러오는 중...</p>
          </div>
        </div>
      )}

      {data && (
        <>
          {/* KPI 카드 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <KpiCard
              label="방문자 (7일)"
              value={fmtNum(r7Visitors)}
              sub={data.overview.hasRealAnalytics ? "UV 기준" : "주문 데이터 기준"}
              icon={Users}
              color="bg-violet-500"
              trend={pctDiff(r7Visitors, p7Visitors)}
            />
            <KpiCard
              label="주문수 (7일)"
              value={r7Orders.toLocaleString("ko-KR") + "건"}
              sub="결제 완료 기준"
              icon={ShoppingCart}
              color="bg-emerald-500"
              trend={pctDiff(r7Orders, p7Orders)}
            />
            <KpiCard
              label="매출 (7일)"
              value={fmtKRW(r7Revenue)}
              sub="총 결제금액"
              icon={TrendingUp}
              color="bg-blue-500"
              trend={pctDiff(r7Revenue, p7Revenue)}
            />
            <KpiCard
              label="전환율 (30일)"
              value={data.overview.avgConversionRate > 0
                ? data.overview.avgConversionRate + "%"
                : data.overview.totalOrders + "건"}
              sub={data.overview.avgConversionRate > 0
                ? "방문자 대비 구매율"
                : "30일 총 주문"}
              icon={Target}
              color="bg-amber-500"
              trend={null}
            />
          </div>

          {/* 탭 */}
          <div className="flex gap-1 bg-zinc-100 dark:bg-zinc-800 rounded-xl p-1 w-fit">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  tab === id
                    ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm"
                    : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                }`}
              >
                <Icon size={14} />
                {label}
                {id === "ai" && aiResult && (
                  <span className="w-2 h-2 rounded-full bg-violet-500 ml-0.5" />
                )}
              </button>
            ))}
          </div>

          {/* 탭 컨텐츠 */}

          {/* ── 방문 현황 ──────────────────────────────────────────────── */}
          {tab === "overview" && (
            <div className="space-y-6">
              {/* 30일 방문자+주문 추이 */}
              <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-6">
                <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-4">
                  30일 주문 추이
                </h3>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={chart30} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#a1a1aa" }} interval={4} />
                    <YAxis tick={{ fontSize: 11, fill: "#a1a1aa" }} width={35} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {data.overview.hasRealAnalytics && (
                      <Line type="monotone" dataKey="방문자" stroke="#8b5cf6" strokeWidth={2} dot={false} />
                    )}
                    <Line type="monotone" dataKey="주문" stroke="#10b981" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
                {!data.overview.hasRealAnalytics && (
                  <p className="text-xs text-zinc-400 mt-2 flex items-center gap-1">
                    <Info size={11} />
                    방문자 데이터는 카페24 analytics 권한 재연결 후 표시됩니다
                  </p>
                )}
              </div>

              {/* 14일 매출 바차트 */}
              <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-6">
                <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-4">
                  최근 14일 일별 매출
                </h3>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={chart14} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#a1a1aa" }} />
                    <YAxis tick={{ fontSize: 11, fill: "#a1a1aa" }} width={40}
                      tickFormatter={(v) => v >= 100 ? v / 100 + "백만" : v + "만"} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="매출(만원)" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* 30일 요약 통계 */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { label: "30일 총 방문자", value: data.overview.totalVisitors > 0 ? fmtNum(data.overview.totalVisitors) : "-", note: data.overview.hasRealAnalytics ? "" : "데이터 없음" },
                  { label: "30일 총 주문", value: data.overview.totalOrders.toLocaleString("ko-KR") + "건", note: "" },
                  { label: "30일 총 매출", value: fmtKRW(data.overview.totalRevenue), note: "" },
                  { label: "평균 이탈률", value: data.overview.avgBounceRate > 0 ? data.overview.avgBounceRate + "%" : "-", note: data.overview.avgBounceRate > 0 ? "" : "데이터 없음" },
                ].map((item) => (
                  <div key={item.label} className="bg-zinc-50 dark:bg-zinc-800/50 rounded-xl p-4">
                    <p className="text-xs text-zinc-500 mb-1">{item.label}</p>
                    <p className="text-xl font-bold text-zinc-800 dark:text-zinc-100">{item.value}</p>
                    {item.note && <p className="text-xs text-zinc-400 mt-0.5">{item.note}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── 유입 분석 ──────────────────────────────────────────────── */}
          {tab === "traffic" && (
            <div className="space-y-6">
              {/* 유입 경로 */}
              <div className="grid sm:grid-cols-2 gap-6">
                <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-6">
                  <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-4">유입 경로 분포</h3>
                  {data.trafficSources.some(s => s.visits > 0) ? (
                    <>
                      <ResponsiveContainer width="100%" height={200}>
                        <PieChart>
                          <Pie
                            data={data.trafficSources}
                            dataKey="visits"
                            nameKey="name"
                            cx="50%" cy="50%"
                            outerRadius={80}
                            label={({ name, payload }: any) => `${name} ${(payload as any)?.pct ?? 0}%`}
                            labelLine={false}
                          >
                            {data.trafficSources.map((_, i) => (
                              <Cell key={i} fill={COLORS[i % COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(v: any) => (Number(v) || 0).toLocaleString("ko-KR") + "회"} />
                        </PieChart>
                      </ResponsiveContainer>
                    </>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-40 text-zinc-400 gap-2">
                      <Info size={20} />
                      <p className="text-sm">analytics 권한 재연결 후 표시됩니다</p>
                    </div>
                  )}
                </div>

                <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-6">
                  <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-4">유입 경로별 방문수</h3>
                  {data.trafficSources.some(s => s.visits > 0) ? (
                    <div className="space-y-3">
                      {data.trafficSources.map((src, i) => (
                        <div key={i}>
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-zinc-600 dark:text-zinc-400">{src.name}</span>
                            <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                              {src.visits.toLocaleString("ko-KR")}회 ({src.pct}%)
                            </span>
                          </div>
                          <div className="h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{ width: `${src.pct}%`, backgroundColor: COLORS[i % COLORS.length] }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-40 text-zinc-400 gap-2">
                      <Info size={20} />
                      <p className="text-sm">analytics 권한 재연결 후 표시됩니다</p>
                    </div>
                  )}
                </div>
              </div>

              {/* 인기 검색 키워드 */}
              <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-6">
                <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-4">인기 검색 키워드 (30일)</h3>
                {data.topKeywords.length > 0 ? (
                  <div className="space-y-2">
                    {data.topKeywords.map((k, i) => (
                      <div key={i} className="flex items-center gap-3">
                        <span className="text-xs font-bold text-zinc-400 w-5">{i + 1}</span>
                        <span className="text-sm text-zinc-700 dark:text-zinc-300 flex-1">"{k.keyword}"</span>
                        <span className="text-xs text-zinc-500">{k.visits.toLocaleString("ko-KR")}회</span>
                        <div className="w-20 h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full bg-violet-500"
                            style={{ width: `${(k.visits / (data.topKeywords[0]?.visits || 1)) * 100}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-20 text-zinc-400 gap-2">
                    <p className="text-sm">analytics 권한 재연결 후 표시됩니다</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── 전환 분석 ──────────────────────────────────────────────── */}
          {tab === "conversion" && (
            <div className="space-y-6">
              {/* 전환 퍼널 */}
              <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-6">
                <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-6">구매 전환 퍼널 (30일)</h3>
                <div className="flex items-end gap-2 justify-center">
                  {[
                    {
                      label: "방문자",
                      value: data.overview.totalVisitors > 0 ? data.overview.totalVisitors : "?",
                      note: data.overview.hasRealAnalytics ? "" : "데이터 없음",
                      color: "bg-violet-500",
                      h: "h-32",
                      pct: 100,
                    },
                    {
                      label: "상품 조회",
                      value: data.overview.totalVisitors > 0 ? Math.round(data.overview.totalVisitors * 0.4) : "?",
                      note: "추정",
                      color: "bg-blue-500",
                      h: "h-24",
                      pct: 40,
                    },
                    {
                      label: "장바구니",
                      value: data.overview.totalOrders > 0 ? Math.round(data.overview.totalOrders * 2.5) : "?",
                      note: "추정",
                      color: "bg-cyan-500",
                      h: "h-16",
                      pct: 15,
                    },
                    {
                      label: "구매 완료",
                      value: data.overview.totalOrders,
                      note: "실제",
                      color: "bg-emerald-500",
                      h: "h-10",
                      pct: data.overview.avgConversionRate || 3,
                    },
                  ].map((step, i) => (
                    <div key={i} className="flex flex-col items-center gap-2 flex-1">
                      <div className="text-center">
                        <p className="text-lg font-bold text-zinc-800 dark:text-zinc-100">
                          {typeof step.value === "number" ? step.value.toLocaleString("ko-KR") : step.value}
                        </p>
                        <p className="text-xs text-zinc-400">{step.note}</p>
                      </div>
                      <div className={`w-full ${step.h} ${step.color} rounded-t-xl opacity-80`} />
                      <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400 text-center">{step.label}</p>
                    </div>
                  ))}
                </div>
                {!data.overview.hasRealAnalytics && (
                  <p className="text-xs text-zinc-400 mt-4 text-center">
                    * 방문자 데이터가 없어 일부 수치는 업계 평균 기반 추정값입니다
                  </p>
                )}
              </div>

              {/* 일별 전환율 차트 */}
              <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-6">
                <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-4">일별 주문 건수 (최근 30일)</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart
                    data={chart30.map(d => ({ ...d, "주문건수": d.주문 }))}
                    margin={{ top: 5, right: 10, bottom: 5, left: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#a1a1aa" }} interval={4} />
                    <YAxis tick={{ fontSize: 11, fill: "#a1a1aa" }} width={25} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="주문건수" fill="#10b981" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* 요일별 분석 */}
              <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-6">
                <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-4">요일별 평균 주문 (30일)</h3>
                {(() => {
                  const DOW = ["일", "월", "화", "수", "목", "금", "토"];
                  const dowMap: Record<string, { orders: number; count: number }> = {};
                  DOW.forEach(d => { dowMap[d] = { orders: 0, count: 0 }; });
                  data.daily.forEach(d => {
                    const dow = DOW[new Date(d.date).getDay()];
                    dowMap[dow].orders += d.orders;
                    dowMap[dow].count += 1;
                  });
                  const dowData = DOW.map(d => ({
                    day: d,
                    "평균 주문": dowMap[d].count > 0
                      ? Math.round((dowMap[d].orders / dowMap[d].count) * 10) / 10
                      : 0,
                  }));
                  return (
                    <ResponsiveContainer width="100%" height={160}>
                      <BarChart data={dowData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                        <XAxis dataKey="day" tick={{ fontSize: 12, fill: "#a1a1aa" }} />
                        <YAxis tick={{ fontSize: 11, fill: "#a1a1aa" }} width={25} />
                        <Tooltip content={<ChartTooltip />} />
                        <Bar dataKey="평균 주문" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  );
                })()}
              </div>
            </div>
          )}

          {/* ── AI 인사이트 ──────────────────────────────────────────────── */}
          {tab === "ai" && (
            <div className="space-y-6">
              {aiError && (
                <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 rounded-2xl p-4 flex gap-3">
                  <AlertCircle size={16} className="text-red-500 mt-0.5 shrink-0" />
                  <p className="text-sm text-red-700">{aiError}</p>
                </div>
              )}

              {!aiResult && !aiLoading && (
                <div className="flex flex-col items-center justify-center py-20 gap-4">
                  <div className="w-16 h-16 bg-violet-50 dark:bg-violet-950/30 rounded-2xl flex items-center justify-center">
                    <Sparkles size={28} className="text-violet-500" />
                  </div>
                  <div className="text-center">
                    <h3 className="text-lg font-bold text-zinc-800 dark:text-zinc-100">AI 인사이트 분석</h3>
                    <p className="text-sm text-zinc-400 mt-1">
                      현재 방문자·매출 데이터를 AI가 분석하여 인사이트와 개선안을 제시합니다
                    </p>
                  </div>
                  <button
                    onClick={runAI}
                    disabled={aiLoading}
                    className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-5 py-2.5 rounded-xl"
                  >
                    <Sparkles size={15} />
                    분석 시작
                  </button>
                </div>
              )}

              {aiLoading && (
                <div className="flex flex-col items-center justify-center py-20 gap-3">
                  <Loader2 size={32} className="animate-spin text-violet-500" />
                  <p className="text-sm text-zinc-400">AI가 데이터를 분석하는 중...</p>
                </div>
              )}

              {aiResult && (
                <>
                  {/* 종합 점수 */}
                  <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-6">
                    <div className="flex items-center gap-6">
                      <ScoreGauge score={aiResult.overallScore} />
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          {aiResult.weeklyTrend === "up" ? (
                            <TrendingUp size={16} className="text-emerald-500" />
                          ) : aiResult.weeklyTrend === "down" ? (
                            <TrendingDown size={16} className="text-red-500" />
                          ) : (
                            <Minus size={16} className="text-zinc-400" />
                          )}
                          <span className={`text-sm font-semibold ${
                            aiResult.weeklyTrend === "up" ? "text-emerald-600" :
                            aiResult.weeklyTrend === "down" ? "text-red-500" : "text-zinc-500"
                          }`}>{aiResult.weeklyTrendComment}</span>
                        </div>
                        <p className="text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed">{aiResult.summary}</p>
                      </div>
                    </div>
                  </div>

                  {/* 핵심 발견사항 */}
                  <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-6">
                    <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-4 flex items-center gap-2">
                      <Zap size={14} className="text-amber-500" />
                      핵심 발견사항
                    </h3>
                    <ul className="space-y-2">
                      {aiResult.keyFindings.map((f, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                          <ChevronRight size={14} className="text-violet-500 mt-0.5 shrink-0" />
                          {f}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-6">
                    {/* 우려 사항 */}
                    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-6">
                      <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-4 flex items-center gap-2">
                        <AlertCircle size={14} className="text-red-500" />
                        우려 사항
                      </h3>
                      <div className="space-y-3">
                        {aiResult.concerns.map((c, i) => (
                          <div key={i} className={`rounded-xl p-3 border ${
                            c.priority === "high"
                              ? "bg-red-50 border-red-100 dark:bg-red-950/20 dark:border-red-900"
                              : c.priority === "medium"
                              ? "bg-amber-50 border-amber-100 dark:bg-amber-950/20 dark:border-amber-900"
                              : "bg-zinc-50 border-zinc-100 dark:bg-zinc-800/50 dark:border-zinc-700"
                          }`}>
                            <div className="flex items-center gap-2 mb-1">
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                                c.priority === "high"
                                  ? "bg-red-500 text-white"
                                  : c.priority === "medium"
                                  ? "bg-amber-500 text-white"
                                  : "bg-zinc-400 text-white"
                              }`}>
                                {c.priority === "high" ? "긴급" : c.priority === "medium" ? "주의" : "참고"}
                              </span>
                              <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">{c.issue}</span>
                            </div>
                            <p className="text-xs text-zinc-500 dark:text-zinc-400">{c.detail}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* 기회 요인 */}
                    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-6">
                      <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-4 flex items-center gap-2">
                        <TrendingUp size={14} className="text-emerald-500" />
                        기회 요인
                      </h3>
                      <div className="space-y-3">
                        {aiResult.opportunities.map((o, i) => (
                          <div key={i} className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900 rounded-xl p-3">
                            <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 mb-1">{o.title}</p>
                            <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-1.5">{o.detail}</p>
                            <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                              <ArrowUpRight size={11} />
                              예상 효과: {o.estimatedImpact}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* 전환율 개선 조언 */}
                  <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-6">
                    <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-4 flex items-center gap-2">
                      <Target size={14} className="text-blue-500" />
                      전환율 개선 조언
                    </h3>
                    <div className="grid sm:grid-cols-2 gap-3">
                      {aiResult.conversionAdvice.map((a, i) => (
                        <div key={i} className="flex items-start gap-2 bg-blue-50 dark:bg-blue-950/20 rounded-xl p-3">
                          <span className="w-5 h-5 rounded-full bg-blue-500 text-white text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                            {i + 1}
                          </span>
                          <p className="text-xs text-zinc-600 dark:text-zinc-300">{a}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 액션 아이템 */}
                  <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-6">
                    <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-4 flex items-center gap-2">
                      <Zap size={14} className="text-violet-500" />
                      즉시 실행 가능한 액션 아이템
                    </h3>
                    <div className="space-y-3">
                      {aiResult.actionItems.map((item, i) => (
                        <div key={i} className="flex gap-4 items-start p-3 bg-violet-50 dark:bg-violet-950/20 rounded-xl border border-violet-100 dark:border-violet-900">
                          <div className="w-6 h-6 rounded-full bg-violet-600 text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                            {i + 1}
                          </div>
                          <div className="flex-1">
                            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">{item.action}</p>
                            <div className="flex items-center gap-3 mt-1.5">
                              <span className="text-xs text-zinc-500">기한: <strong className="text-violet-600">{item.deadline}</strong></span>
                              <span className="text-xs text-zinc-500">효과: {item.expectedEffect}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="text-center">
                    <button
                      onClick={runAI}
                      className="text-xs text-zinc-400 hover:text-violet-600 transition-colors flex items-center gap-1 mx-auto"
                    >
                      <RefreshCw size={12} />
                      다시 분석
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
