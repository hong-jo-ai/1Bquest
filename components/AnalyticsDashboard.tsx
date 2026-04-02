"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Users, Eye, ShoppingCart, TrendingUp, TrendingDown,
  Minus, AlertCircle, Sparkles, LogIn, RefreshCw,
  Loader2, BarChart2, MousePointerClick, Zap, Target,
  ArrowUpRight, ArrowDownRight, ChevronRight, Info,
  MonitorSmartphone, Search, Globe, Settings,
} from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import type { AnalyticsData } from "@/app/api/analytics/visitors/route";
import type { AnalyticsAIResult } from "@/app/api/analytics/ai/route";

// ── 색상 팔레트 ──────────────────────────────────────────────────────────────
const COLORS = ["#8b5cf6", "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#6366f1", "#ec4899"];

type Tab = "overview" | "ga4" | "meta" | "conversion" | "ai";

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "overview",   label: "종합 현황",   icon: BarChart2 },
  { id: "ga4",        label: "방문자 분석", icon: Users },
  { id: "meta",       label: "광고 유입",   icon: MousePointerClick },
  { id: "conversion", label: "전환 분석",   icon: ShoppingCart },
  { id: "ai",         label: "AI 인사이트", icon: Sparkles },
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
function shortDate(ds: string) {
  const [, m, d] = ds.split("-");
  return `${parseInt(m)}/${parseInt(d)}`;
}
function pctDiff(a: number, b: number): number | null {
  return b > 0 ? ((a - b) / b) * 100 : null;
}

// ── KPI 카드 ─────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, icon: Icon, color, trend, badge }:
  { label: string; value: string; sub?: string; icon: React.ElementType;
    color: string; trend?: number | null; badge?: string }) {
  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-5">
      <div className="flex items-start justify-between mb-3">
        <p className="text-xs font-medium text-zinc-500">{label}</p>
        <div className="flex items-center gap-1.5">
          {badge && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500">
              {badge}
            </span>
          )}
          <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${color}`}>
            <Icon size={14} className="text-white" />
          </div>
        </div>
      </div>
      <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 leading-none">{value}</p>
      {sub && <p className="text-xs text-zinc-400 mt-1.5">{sub}</p>}
      {trend != null && (
        <div className={`flex items-center gap-1 mt-2 text-xs font-medium ${
          trend > 0 ? "text-emerald-600" : trend < 0 ? "text-red-500" : "text-zinc-400"
        }`}>
          {trend > 0 ? <ArrowUpRight size={12} /> : trend < 0 ? <ArrowDownRight size={12} /> : <Minus size={12} />}
          {Math.abs(trend).toFixed(1)}% 전주 대비
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
          {p.name}: {p.name?.includes("원") || p.name?.includes("매출") || p.name?.includes("비")
            ? fmtKRW(p.value)
            : (p.value ?? 0).toLocaleString("ko-KR")}
        </p>
      ))}
    </div>
  );
}

// ── Score Gauge ───────────────────────────────────────────────────────────
function ScoreGauge({ score }: { score: number }) {
  const color = score >= 70 ? "#10b981" : score >= 50 ? "#f59e0b" : "#ef4444";
  const label = score >= 70 ? "양호" : score >= 50 ? "보통" : "주의";
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative w-24 h-24">
        <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
          <circle cx="50" cy="50" r="38" fill="none" stroke="#e4e4e7" strokeWidth="10" />
          <circle cx="50" cy="50" r="38" fill="none" stroke={color} strokeWidth="10"
            strokeDasharray={`${(score / 100) * 239} 239`} strokeLinecap="round" />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold text-zinc-800 dark:text-zinc-100">{score}</span>
          <span className="text-[10px] text-zinc-400">/ 100</span>
        </div>
      </div>
      <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
        style={{ backgroundColor: color + "20", color }}>{label}</span>
    </div>
  );
}

// ── GA4 연결 패널 ─────────────────────────────────────────────────────────
function Ga4ConnectPanel({
  hasToken, propertyId, onSaved,
}: { hasToken: boolean; propertyId: string; onSaved: () => void }) {
  const [pid, setPid]     = useState(propertyId);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg]     = useState("");

  const saveProperty = async () => {
    if (!pid.trim()) return;
    setSaving(true);
    const res = await fetch("/api/analytics/ga4-property", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ propertyId: pid.trim() }),
    });
    setSaving(false);
    if (res.ok) { setMsg("저장됨 ✓"); onSaved(); }
    else { const e = await res.json(); setMsg(e.error ?? "오류"); }
  };

  return (
    <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900 rounded-2xl p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 bg-white dark:bg-zinc-900 rounded-xl flex items-center justify-center border border-blue-200 dark:border-blue-900 shrink-0">
          <svg viewBox="0 0 24 24" width="18" height="18">
            <path fill="#E37400" d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/>
            <path fill="#FCC934" d="M12 4.1L5 7.4v4.6c0 4.27 2.96 8.28 7 9.38V4.1z"/>
          </svg>
        </div>
        <div>
          <h4 className="text-sm font-semibold text-blue-800 dark:text-blue-300">Google Analytics 4 연결</h4>
          <p className="text-xs text-blue-600 dark:text-blue-400 mt-0.5">
            실제 방문자 수, 이탈률, 유입경로, 기기 분석 등 상세 트래픽 통계를 확인할 수 있어요
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {!hasToken ? (
          <a href="/api/auth/google/login"
            className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors w-full">
            <LogIn size={14} />
            Google 계정으로 연결하기
          </a>
        ) : (
          <div className="flex items-center gap-2 text-xs text-emerald-600 bg-emerald-50 dark:bg-emerald-950/20 rounded-xl px-3 py-2">
            ✓ Google 계정 연결됨
            <a href="/api/auth/google/logout" className="ml-auto text-zinc-400 hover:text-red-500">연결 해제</a>
          </div>
        )}

        <div>
          <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1 block">
            GA4 Property ID
            <span className="ml-2 text-zinc-400 font-normal">
              (Google Analytics → 관리 → 속성 → 속성 ID)
            </span>
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={pid}
              onChange={(e) => { setPid(e.target.value); setMsg(""); }}
              placeholder="예: 123456789"
              className="flex-1 text-sm border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2 bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <button
              onClick={saveProperty}
              disabled={saving || !pid.trim()}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : "저장"}
            </button>
          </div>
          {msg && <p className="text-xs mt-1 text-emerald-600">{msg}</p>}
        </div>
      </div>
    </div>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────
export default function AnalyticsDashboard({ isAuthenticated, hasGaToken, ga4PropertyId }:
  { isAuthenticated: boolean; hasGaToken: boolean; ga4PropertyId: string }) {

  const [tab, setTab]             = useState<Tab>("overview");
  const [data, setData]           = useState<AnalyticsData | null>(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [aiResult, setAiResult]   = useState<AnalyticsAIResult | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError]     = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [showGa4Setup, setShowGa4Setup] = useState(false);
  const [gaToken, setGaToken]     = useState(hasGaToken);
  const [propId, setPropId]       = useState(ga4PropertyId);

  const loadData = useCallback(async () => {
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
      setLastUpdated(new Date().toLocaleString("ko-KR", {
        timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit"
      }));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

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
      setAiResult(await res.json());
      setTab("ai");
    } catch (e: any) {
      setAiError(e.message);
    } finally {
      setAiLoading(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-24 flex flex-col items-center gap-4">
        <BarChart2 size={40} className="text-violet-400" />
        <h3 className="text-lg font-bold text-zinc-800 dark:text-zinc-100">카페24 연결이 필요합니다</h3>
        <a href="/api/auth/login"
          className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-5 py-2.5 rounded-xl">
          <LogIn size={15} /> 카페24 연결하기
        </a>
      </div>
    );
  }

  // 최근 7일 vs 이전 7일
  const recent7 = data?.daily.slice(-7) ?? [];
  const prev7   = data?.daily.slice(-14, -7) ?? [];
  const r7 = {
    users:    recent7.reduce((s, d) => s + (d.gaUsers || d.reach || 0), 0),
    sessions: recent7.reduce((s, d) => s + d.gaSessions, 0),
    orders:   recent7.reduce((s, d) => s + d.orders, 0),
    revenue:  recent7.reduce((s, d) => s + d.revenue, 0),
    clicks:   recent7.reduce((s, d) => s + d.clicks, 0),
    spend:    recent7.reduce((s, d) => s + d.spend, 0),
  };
  const p7 = {
    users:    prev7.reduce((s, d) => s + (d.gaUsers || d.reach || 0), 0),
    sessions: prev7.reduce((s, d) => s + d.gaSessions, 0),
    orders:   prev7.reduce((s, d) => s + d.orders, 0),
    revenue:  prev7.reduce((s, d) => s + d.revenue, 0),
    clicks:   prev7.reduce((s, d) => s + d.clicks, 0),
    spend:    prev7.reduce((s, d) => s + d.spend, 0),
  };

  const T = data?.totals;
  const ga4 = data?.ga4;

  // 차트 데이터
  const chart30 = data?.daily.map(d => ({
    date: shortDate(d.date),
    방문자: d.gaUsers || d.reach,
    세션: d.gaSessions,
    주문: d.orders,
    "매출(만원)": Math.round(d.revenue / 10000),
    "광고비(만원)": Math.round(d.spend / 10000),
    클릭: d.clicks,
  })) ?? [];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">방문자 분석</h2>
          <p className="text-sm text-zinc-400 mt-0.5">
            최근 30일 · {lastUpdated ? `${lastUpdated} 기준` : "로딩 중"}
            {data && (
              <span className="ml-2">
                {data.hasGa4 && <span className="text-blue-500 text-xs">• GA4</span>}
                {data.hasMeta && <span className="text-violet-500 text-xs"> • Meta</span>}
                {data.hasCafe24 && <span className="text-emerald-500 text-xs"> • 카페24</span>}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowGa4Setup(v => !v)}
            className="flex items-center gap-1.5 text-xs bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 px-3 py-2 rounded-xl transition-colors">
            <Settings size={13} /> GA4 설정
          </button>
          <button onClick={runAI} disabled={!data || aiLoading}
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors">
            {aiLoading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            AI 분석
          </button>
          <button onClick={loadData} disabled={loading}
            className="p-2 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-zinc-500">
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* GA4 설정 패널 */}
      {showGa4Setup && (
        <Ga4ConnectPanel
          hasToken={gaToken || (data?.hasGa4 ?? false)}
          propertyId={propId || data?.ga4PropertyId || ""}
          onSaved={() => { setShowGa4Setup(false); loadData(); }}
        />
      )}

      {/* GA4 연결 안내 (데이터 없을 때) */}
      {data && !data.hasGa4 && !showGa4Setup && (
        <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900 rounded-2xl p-4 flex gap-3 items-center">
          <Info size={15} className="text-blue-500 shrink-0" />
          <p className="text-sm text-blue-700 dark:text-blue-300 flex-1">
            Google Analytics 4를 연결하면 실제 방문자 수, 이탈률, 유입경로 등 상세 통계를 볼 수 있어요
          </p>
          <button onClick={() => setShowGa4Setup(true)}
            className="text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded-lg shrink-0">
            GA4 연결하기
          </button>
        </div>
      )}

      {/* 에러 */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex gap-3">
          <AlertCircle size={16} className="text-red-500 mt-0.5 shrink-0" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {loading && !data && (
        <div className="flex justify-center py-20">
          <div className="flex flex-col items-center gap-3">
            <Loader2 size={32} className="animate-spin text-violet-500" />
            <p className="text-sm text-zinc-400">데이터를 불러오는 중...</p>
          </div>
        </div>
      )}

      {data && T && (
        <>
          {/* KPI 카드 (4개) */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <KpiCard
              label={data.hasGa4 ? "방문자 (7일)" : "광고 도달 (7일)"}
              value={fmtNum(r7.users)}
              sub={data.hasGa4 ? "GA4 활성 사용자" : "Meta 광고 도달"}
              icon={Users}
              color="bg-blue-500"
              trend={pctDiff(r7.users, p7.users)}
              badge={data.hasGa4 ? "GA4" : "Meta"}
            />
            <KpiCard
              label="세션 (7일)"
              value={data.hasGa4 ? r7.sessions.toLocaleString("ko-KR") : r7.clicks.toLocaleString("ko-KR")}
              sub={data.hasGa4 ? "GA4 세션 수" : "Meta 광고 클릭"}
              icon={Globe}
              color="bg-violet-500"
              trend={pctDiff(
                data.hasGa4 ? r7.sessions : r7.clicks,
                data.hasGa4 ? p7.sessions : p7.clicks
              )}
              badge={data.hasGa4 ? "GA4" : "Meta"}
            />
            <KpiCard
              label="주문 (7일)"
              value={r7.orders.toLocaleString("ko-KR") + "건"}
              sub="카페24 실제 주문"
              icon={ShoppingCart}
              color="bg-emerald-500"
              trend={pctDiff(r7.orders, p7.orders)}
              badge="카페24"
            />
            <KpiCard
              label="매출 (7일)"
              value={fmtKRW(r7.revenue)}
              sub="카페24 총 결제금액"
              icon={TrendingUp}
              color="bg-amber-500"
              trend={pctDiff(r7.revenue, p7.revenue)}
              badge="카페24"
            />
          </div>

          {/* 탭 */}
          <div className="flex gap-1 bg-zinc-100 dark:bg-zinc-800 rounded-xl p-1 w-fit flex-wrap">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button key={id} onClick={() => setTab(id)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  tab === id
                    ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm"
                    : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                }`}>
                <Icon size={14} />
                {label}
                {id === "ga4" && !data.hasGa4 && (
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                )}
                {id === "ai" && aiResult && (
                  <span className="w-1.5 h-1.5 rounded-full bg-violet-500" />
                )}
              </button>
            ))}
          </div>

          {/* ─── 탭: 종합 현황 ──────────────────────────────────────────── */}
          {tab === "overview" && (
            <div className="space-y-6">
              {/* 통합 추이 차트 */}
              <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-6">
                <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-4">30일 추이</h3>
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={chart30} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#a1a1aa" }} interval={4} />
                    <YAxis yAxisId="left"  tick={{ fontSize: 11, fill: "#a1a1aa" }} width={35} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: "#a1a1aa" }} width={35} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {data.hasGa4
                      ? <Line yAxisId="left" type="monotone" dataKey="방문자" stroke="#3b82f6" strokeWidth={2} dot={false} />
                      : <Line yAxisId="left" type="monotone" dataKey="클릭"   stroke="#8b5cf6" strokeWidth={2} dot={false} />}
                    <Line yAxisId="right" type="monotone" dataKey="주문" stroke="#10b981" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* 매출 + 광고비 */}
              <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-6">
                <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-4">매출 vs 광고비 (30일)</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={chart30} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#a1a1aa" }} interval={4} />
                    <YAxis tick={{ fontSize: 11, fill: "#a1a1aa" }} width={40}
                      tickFormatter={(v) => v + "만"} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="매출(만원)" fill="#10b981" radius={[3, 3, 0, 0]} />
                    {data.hasMeta && <Bar dataKey="광고비(만원)" fill="#8b5cf6" radius={[3, 3, 0, 0]} />}
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* 30일 종합 지표 */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  {
                    label: data.hasGa4 ? "총 방문자 (30일)" : "총 광고 도달 (30일)",
                    value: fmtNum(data.hasGa4 ? T.gaUsers : T.reach),
                    note:  data.hasGa4 ? "GA4 활성 사용자" : "Meta 광고 도달",
                  },
                  { label: "총 주문 (30일)", value: T.orders.toLocaleString("ko-KR") + "건", note: "카페24 기준" },
                  { label: "총 매출 (30일)", value: fmtKRW(T.revenue), note: "카페24 기준" },
                  {
                    label: "광고 ROAS (30일)",
                    value: T.roas > 0 ? T.roas.toFixed(2) + "x" : "-",
                    note:  T.spend > 0 ? `광고비 ${fmtKRW(T.spend)}` : "Meta 미연결",
                  },
                ].map((item) => (
                  <div key={item.label} className="bg-zinc-50 dark:bg-zinc-800/50 rounded-xl p-4">
                    <p className="text-xs text-zinc-500 mb-1">{item.label}</p>
                    <p className="text-xl font-bold text-zinc-800 dark:text-zinc-100">{item.value}</p>
                    <p className="text-xs text-zinc-400 mt-0.5">{item.note}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ─── 탭: GA4 방문자 분석 ────────────────────────────────────── */}
          {tab === "ga4" && (
            <div className="space-y-6">
              {!data.hasGa4 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-4">
                  <div className="w-16 h-16 bg-blue-50 dark:bg-blue-950/30 rounded-2xl flex items-center justify-center">
                    <Users size={28} className="text-blue-500" />
                  </div>
                  <div className="text-center">
                    <h3 className="text-lg font-bold text-zinc-800 dark:text-zinc-100">Google Analytics 4 연결 필요</h3>
                    <p className="text-sm text-zinc-400 mt-1 max-w-sm">
                      실제 방문자 수, 이탈률, 페이지뷰, 기기별·유입경로별 통계를 보려면 GA4를 연결하세요
                    </p>
                  </div>
                  <button onClick={() => setShowGa4Setup(true)}
                    className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-5 py-2.5 rounded-xl">
                    <Settings size={15} /> GA4 연결 설정
                  </button>
                </div>
              ) : (
                <>
                  {/* GA4 KPI */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
                    {[
                      { label: "총 방문자",    value: fmtNum(T.gaUsers),    note: "활성 사용자" },
                      { label: "신규 방문자",  value: fmtNum(T.gaNewUsers), note: `${T.gaUsers > 0 ? Math.round(T.gaNewUsers / T.gaUsers * 100) : 0}%` },
                      { label: "총 세션",      value: fmtNum(T.gaSessions), note: "방문 횟수" },
                      { label: "총 페이지뷰",  value: fmtNum(T.gaPageviews), note: "전체 조회" },
                      { label: "평균 이탈률",  value: T.gaAvgBounceRate.toFixed(1) + "%", note: "낮을수록 좋음" },
                      { label: "평균 체류시간", value: T.gaAvgSessionMin + "분", note: "세션당" },
                    ].map((item) => (
                      <div key={item.label} className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-100 dark:border-zinc-800 p-4">
                        <p className="text-xs text-zinc-500 mb-1">{item.label}</p>
                        <p className="text-xl font-bold text-zinc-800 dark:text-zinc-100">{item.value}</p>
                        <p className="text-xs text-zinc-400">{item.note}</p>
                      </div>
                    ))}
                  </div>

                  {/* GA4 방문자 추이 */}
                  <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-6">
                    <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-4">방문자·세션 추이 (30일)</h3>
                    <ResponsiveContainer width="100%" height={220}>
                      <LineChart data={chart30} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                        <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#a1a1aa" }} interval={4} />
                        <YAxis tick={{ fontSize: 11, fill: "#a1a1aa" }} width={35} />
                        <Tooltip content={<ChartTooltip />} />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Line type="monotone" dataKey="방문자" stroke="#3b82f6" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="세션" stroke="#8b5cf6" strokeWidth={2} dot={false} strokeDasharray="4 2" />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>

                  {/* 유입경로 + 기기 */}
                  <div className="grid sm:grid-cols-2 gap-6">
                    {/* 유입 채널 */}
                    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-6">
                      <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-4 flex items-center gap-2">
                        <Search size={14} className="text-blue-500" />
                        유입 채널별 세션 (30일)
                      </h3>
                      {ga4 && ga4.trafficSources.length > 0 ? (
                        <div className="space-y-3">
                          {ga4.trafficSources.map((src, i) => (
                            <div key={i}>
                              <div className="flex justify-between text-xs mb-1">
                                <span className="text-zinc-600 dark:text-zinc-400">{src.channel}</span>
                                <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                                  {src.sessions.toLocaleString("ko-KR")} ({src.pct}%)
                                </span>
                              </div>
                              <div className="h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                                <div className="h-full rounded-full"
                                  style={{ width: `${src.pct}%`, backgroundColor: COLORS[i % COLORS.length] }} />
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : <p className="text-sm text-zinc-400 text-center py-8">데이터 없음</p>}
                    </div>

                    {/* 기기 분석 */}
                    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-6">
                      <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-4 flex items-center gap-2">
                        <MonitorSmartphone size={14} className="text-violet-500" />
                        기기 분석 (30일)
                      </h3>
                      {ga4 && ga4.devices.length > 0 ? (
                        <>
                          <ResponsiveContainer width="100%" height={160}>
                            <PieChart>
                              <Pie data={ga4.devices} dataKey="sessions" nameKey="device"
                                cx="50%" cy="50%" outerRadius={65} label={({ device, pct }: any) => `${device} ${pct}%`}>
                                {ga4.devices.map((_, i) => (
                                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                                ))}
                              </Pie>
                              <Tooltip formatter={(v: any) => Number(v).toLocaleString("ko-KR") + "세션"} />
                            </PieChart>
                          </ResponsiveContainer>
                          <div className="flex justify-center gap-4 mt-2">
                            {ga4.devices.map((d, i) => (
                              <div key={i} className="flex items-center gap-1 text-xs text-zinc-600 dark:text-zinc-400">
                                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                                {d.device} {d.pct}%
                              </div>
                            ))}
                          </div>
                        </>
                      ) : <p className="text-sm text-zinc-400 text-center py-8">데이터 없음</p>}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ─── 탭: Meta 광고 유입 ─────────────────────────────────────── */}
          {tab === "meta" && (
            <div className="space-y-6">
              {!data.hasMeta ? (
                <div className="flex flex-col items-center justify-center py-16 gap-4">
                  <BarChart2 size={32} className="text-zinc-300" />
                  <div className="text-center">
                    <h3 className="text-base font-semibold text-zinc-700">Meta 광고 미연결</h3>
                    <p className="text-sm text-zinc-400 mt-1">광고 페이지에서 Meta 계정을 연결하세요</p>
                  </div>
                  <a href="/ads" className="text-sm text-violet-600 hover:underline flex items-center gap-1">
                    광고 페이지로 이동 <ChevronRight size={14} />
                  </a>
                </div>
              ) : (
                <>
                  {/* Meta KPI */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    {[
                      { label: "노출 (30일)",     value: fmtNum(T.impressions), note: "광고 노출 횟수" },
                      { label: "도달 (30일)",     value: fmtNum(T.reach),       note: "순 도달 인원" },
                      { label: "클릭 (30일)",     value: fmtNum(T.clicks),      note: `CTR ${T.ctr.toFixed(2)}%` },
                      { label: "랜딩뷰 (30일)",   value: fmtNum(T.landingViews), note: "실제 방문 도달" },
                    ].map((item) => (
                      <div key={item.label} className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-100 dark:border-zinc-800 p-4">
                        <p className="text-xs text-zinc-500 mb-1">{item.label}</p>
                        <p className="text-xl font-bold text-zinc-800 dark:text-zinc-100">{item.value}</p>
                        <p className="text-xs text-zinc-400">{item.note}</p>
                      </div>
                    ))}
                  </div>

                  {/* Meta 퍼널 */}
                  <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-6">
                    <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-6">Meta 광고 퍼널 (30일)</h3>
                    <div className="flex items-end gap-3 justify-center">
                      {[
                        { label: "노출", value: T.impressions, color: "bg-violet-400", h: 140 },
                        { label: "도달", value: T.reach,       color: "bg-violet-500", h: 110 },
                        { label: "클릭", value: T.clicks,      color: "bg-blue-500",   h: 80 },
                        { label: "랜딩뷰", value: T.landingViews, color: "bg-cyan-500", h: 60 },
                        { label: "주문", value: T.orders,      color: "bg-emerald-500", h: 40 },
                      ].map((step, i) => (
                        <div key={i} className="flex flex-col items-center gap-2 flex-1">
                          <div className="text-center">
                            <p className="text-sm font-bold text-zinc-700 dark:text-zinc-200">{fmtNum(step.value)}</p>
                          </div>
                          <div className={`w-full ${step.color} rounded-t-xl`} style={{ height: step.h }} />
                          <p className="text-xs font-medium text-zinc-500">{step.label}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Meta 일별 클릭·노출 차트 */}
                  <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-6">
                    <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-4">광고 클릭 추이 (30일)</h3>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={chart30} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                        <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#a1a1aa" }} interval={4} />
                        <YAxis tick={{ fontSize: 11, fill: "#a1a1aa" }} width={35} />
                        <Tooltip content={<ChartTooltip />} />
                        <Bar dataKey="클릭" fill="#8b5cf6" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* 주요 Meta 액션 */}
                  {data.topMetaActions.length > 0 && (
                    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-6">
                      <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-4">Meta 전환 이벤트 (30일)</h3>
                      <div className="grid sm:grid-cols-2 gap-2">
                        {data.topMetaActions.map((a, i) => {
                          const labels: Record<string, string> = {
                            link_click:              "링크 클릭",
                            landing_page_view:       "랜딩 페이지 뷰",
                            add_to_cart:             "장바구니 담기",
                            purchase:                "구매",
                            initiate_checkout:       "결제 시작",
                            view_content:            "콘텐츠 조회",
                            search:                  "검색",
                            complete_registration:   "회원가입",
                            "post_engagement":       "게시물 참여",
                            "page_engagement":       "페이지 참여",
                            video_view:              "동영상 조회",
                            omni_complete_registration: "회원가입",
                            omni_purchase:           "구매",
                            omni_view_content:       "콘텐츠 조회",
                          };
                          return (
                            <div key={i} className="flex items-center justify-between px-3 py-2 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl">
                              <span className="text-xs text-zinc-600 dark:text-zinc-400">
                                {labels[a.type] ?? a.type}
                              </span>
                              <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200">
                                {Math.round(a.value).toLocaleString("ko-KR")}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ─── 탭: 전환 분석 ──────────────────────────────────────────── */}
          {tab === "conversion" && (
            <div className="space-y-6">
              {/* 전환 지표 카드 */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  {
                    label: "클릭→주문 전환율",
                    value: T.metaCvr > 0 ? T.metaCvr.toFixed(2) + "%" : "-",
                    note: "Meta 클릭 기준",
                    ok: T.metaCvr >= 1,
                  },
                  {
                    label: "세션→주문 전환율",
                    value: T.gaCvr > 0 ? T.gaCvr.toFixed(2) + "%" : "-",
                    note: "GA4 세션 기준",
                    ok: T.gaCvr >= 2,
                  },
                  {
                    label: "주문당 광고비(CPO)",
                    value: T.cpo > 0 ? fmtKRW(Math.round(T.cpo)) : "-",
                    note: "낮을수록 좋음",
                    ok: null,
                  },
                  {
                    label: "광고 ROAS",
                    value: T.roas > 0 ? T.roas.toFixed(2) + "x" : "-",
                    note: "매출 ÷ 광고비",
                    ok: T.roas >= 2,
                  },
                ].map((item) => (
                  <div key={item.label} className={`rounded-2xl border p-5 ${
                    item.ok === true  ? "bg-emerald-50 border-emerald-100 dark:bg-emerald-950/20 dark:border-emerald-900" :
                    item.ok === false ? "bg-red-50 border-red-100 dark:bg-red-950/20 dark:border-red-900" :
                    "bg-white border-zinc-100 dark:bg-zinc-900 dark:border-zinc-800"
                  }`}>
                    <p className="text-xs text-zinc-500 mb-2">{item.label}</p>
                    <p className={`text-2xl font-bold leading-none ${
                      item.ok === true ? "text-emerald-700" : item.ok === false ? "text-red-600" : "text-zinc-800 dark:text-zinc-100"
                    }`}>{item.value}</p>
                    <p className="text-xs text-zinc-400 mt-1">{item.note}</p>
                  </div>
                ))}
              </div>

              {/* 일별 주문 + 매출 */}
              <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-6">
                <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-4">일별 주문 (30일)</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={chart30} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#a1a1aa" }} interval={4} />
                    <YAxis tick={{ fontSize: 11, fill: "#a1a1aa" }} width={25} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="주문" fill="#10b981" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* 요일별 평균 주문 */}
              <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-6">
                <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-4">요일별 평균 주문</h3>
                {(() => {
                  const DOW = ["일", "월", "화", "수", "목", "금", "토"];
                  const m: Record<string, { o: number; c: number }> = {};
                  DOW.forEach(d => { m[d] = { o: 0, c: 0 }; });
                  (data?.daily ?? []).forEach(d => {
                    const dow = DOW[new Date(d.date).getDay()];
                    m[dow].o += d.orders; m[dow].c += 1;
                  });
                  const dowData = DOW.map(d => ({
                    day: d,
                    "평균 주문": m[d].c > 0 ? Math.round((m[d].o / m[d].c) * 10) / 10 : 0,
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

          {/* ─── 탭: AI 인사이트 ────────────────────────────────────────── */}
          {tab === "ai" && (
            <div className="space-y-6">
              {aiError && (
                <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex gap-3">
                  <AlertCircle size={16} className="text-red-500 mt-0.5 shrink-0" />
                  <p className="text-sm text-red-700">{aiError}</p>
                </div>
              )}

              {!aiResult && !aiLoading && (
                <div className="flex flex-col items-center justify-center py-20 gap-4">
                  <Sparkles size={36} className="text-violet-400" />
                  <div className="text-center">
                    <h3 className="text-lg font-bold text-zinc-800 dark:text-zinc-100">AI 인사이트 분석</h3>
                    <p className="text-sm text-zinc-400 mt-1">
                      {data.hasGa4 ? "GA4 + " : ""}{data.hasMeta ? "Meta + " : ""}카페24 데이터를 통합 분석합니다
                    </p>
                  </div>
                  <button onClick={runAI}
                    className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-5 py-2.5 rounded-xl">
                    <Sparkles size={15} /> 분석 시작
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
                          {aiResult.weeklyTrend === "up"
                            ? <TrendingUp size={16} className="text-emerald-500" />
                            : aiResult.weeklyTrend === "down"
                            ? <TrendingDown size={16} className="text-red-500" />
                            : <Minus size={16} className="text-zinc-400" />}
                          <span className={`text-sm font-semibold ${
                            aiResult.weeklyTrend === "up" ? "text-emerald-600"
                            : aiResult.weeklyTrend === "down" ? "text-red-500"
                            : "text-zinc-500"
                          }`}>{aiResult.weeklyTrendComment}</span>
                        </div>
                        <p className="text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed">{aiResult.summary}</p>
                      </div>
                    </div>
                  </div>

                  {/* 핵심 발견사항 */}
                  <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-6">
                    <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-4 flex items-center gap-2">
                      <Zap size={14} className="text-amber-500" /> 핵심 발견사항
                    </h3>
                    <ul className="space-y-2">
                      {aiResult.keyFindings.map((f, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                          <ChevronRight size={14} className="text-violet-500 mt-0.5 shrink-0" />{f}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-6">
                    {/* 우려 사항 */}
                    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-6">
                      <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-4 flex items-center gap-2">
                        <AlertCircle size={14} className="text-red-500" /> 우려 사항
                      </h3>
                      <div className="space-y-3">
                        {aiResult.concerns.map((c, i) => (
                          <div key={i} className={`rounded-xl p-3 border ${
                            c.priority === "high" ? "bg-red-50 border-red-100 dark:bg-red-950/20 dark:border-red-900"
                            : c.priority === "medium" ? "bg-amber-50 border-amber-100 dark:bg-amber-950/20 dark:border-amber-900"
                            : "bg-zinc-50 border-zinc-100 dark:bg-zinc-800/50 dark:border-zinc-700"
                          }`}>
                            <div className="flex items-center gap-2 mb-1">
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                                c.priority === "high" ? "bg-red-500 text-white"
                                : c.priority === "medium" ? "bg-amber-500 text-white"
                                : "bg-zinc-400 text-white"
                              }`}>
                                {c.priority === "high" ? "긴급" : c.priority === "medium" ? "주의" : "참고"}
                              </span>
                              <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">{c.issue}</span>
                            </div>
                            <p className="text-xs text-zinc-500">{c.detail}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                    {/* 기회 요인 */}
                    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-6">
                      <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-4 flex items-center gap-2">
                        <TrendingUp size={14} className="text-emerald-500" /> 기회 요인
                      </h3>
                      <div className="space-y-3">
                        {aiResult.opportunities.map((o, i) => (
                          <div key={i} className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900 rounded-xl p-3">
                            <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 mb-1">{o.title}</p>
                            <p className="text-xs text-zinc-500 mb-1.5">{o.detail}</p>
                            <p className="text-xs text-emerald-600 flex items-center gap-1">
                              <ArrowUpRight size={11} /> {o.estimatedImpact}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* 액션 아이템 */}
                  <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-6">
                    <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-4 flex items-center gap-2">
                      <Zap size={14} className="text-violet-500" /> 즉시 실행 액션 아이템
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
                    <button onClick={runAI}
                      className="text-xs text-zinc-400 hover:text-violet-600 transition-colors flex items-center gap-1 mx-auto">
                      <RefreshCw size={12} /> 다시 분석
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
