"use client";

import { useState, useCallback, useRef } from "react";
import {
  TrendingUp, MousePointerClick, Eye, DollarSign,
  BarChart2, Target, AlertCircle, LogIn, LogOut,
  Play, Pause, RefreshCw, ExternalLink, Loader2,
  Layers, Image,
} from "lucide-react";
import type {
  MetaAdsData, MetaPeriodInsights, MetaCampaign, Period,
} from "@/lib/metaData";
import { OBJECTIVE_KO, PERIOD_LABEL } from "@/lib/metaData";
import type { MetaAdSet } from "@/app/api/meta/adsets/route";
import type { MetaAd } from "@/app/api/meta/ads/route";

const ALL_PERIODS: Period[] = ["today", "yesterday", "last3d", "last7d", "week", "month"];

type DashTab = "campaigns" | "adsets" | "ads";

interface Props {
  metaData:    MetaAdsData | null;
  isConnected: boolean;
  error:       string | null;
}

// ── 수 포매터 ─────────────────────────────────────────────────────────────

function fmtKRW(n: number) {
  if (n >= 100_000_000) return (n / 100_000_000).toFixed(1) + "억원";
  if (n >= 10_000)      return (n / 10_000).toFixed(1) + "만원";
  return n.toLocaleString("ko-KR") + "원";
}
function fmtCount(n: number) {
  if (n >= 100_000_000) return (n / 100_000_000).toFixed(1) + "억";
  if (n >= 10_000)      return (n / 10_000).toFixed(1) + "만";
  return n.toLocaleString("ko-KR");
}
function fmtPct(n: number) { return n.toFixed(2) + "%"; }
function fmtRoas(n: number) { return n > 0 ? n.toFixed(2) + "x" : "-"; }

// ── 메타 로고 SVG ─────────────────────────────────────────────────────────

function MetaLogo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M6.915 4.03c-1.968 0-3.683 1.28-4.871 3.113C.704 9.208 0 11.883 0 14.449c0 .706.07 1.369.21 1.973a6.624 6.624 0 0 0 .265.86 5.297 5.297 0 0 0 .371.761c.696 1.159 1.818 1.927 3.593 1.927 1.497 0 2.633-.671 3.965-2.444.76-1.012 1.144-1.626 2.663-4.32l.756-1.339.186-.325c.061.1.121.196.183.3l2.152 3.595c.724 1.21 1.665 2.556 2.47 3.314 1.046.985 1.992 1.22 3.06 1.22 1.075 0 2.036-.257 2.865-.933.599-.49 1.084-1.146 1.38-1.982A7.959 7.959 0 0 0 24 14.449c0-2.57-.718-5.27-2.067-7.345-1.267-1.938-2.982-3.073-4.927-3.073-1.138 0-2.233.386-3.052.956-.524.36-1.04.888-1.553 1.57-.141-.18-.284-.343-.427-.492C10.978 4.768 9.535 4.03 7.92 4.03H6.915zm.058 2.744h.957c.891 0 1.663.57 2.39 1.952.493.929.926 2.078 1.437 3.438l.684 1.837c-1.228 2.028-2.112 3.131-3.038 3.74-.766.5-1.378.617-2.02.617-.98 0-1.61-.44-2.013-1.16a4.61 4.61 0 0 1-.263-.67 6.135 6.135 0 0 1-.163-1.476c0-2.249.598-4.609 1.728-6.238.667-.96 1.38-2.04 2.301-2.04zm10.09.205c1.286 0 2.35.946 3.179 2.426 1.074 1.914 1.657 4.411 1.657 6.627 0 .867-.124 1.548-.374 2.02-.178.337-.41.566-.718.7l-.129.052c-.198.073-.42.11-.666.11-.65 0-1.201-.303-1.956-1.189a22.985 22.985 0 0 1-1.82-2.962l-1.372-2.455-.317-.565c.42-.727.842-1.357 1.256-1.85.79-.944 1.514-1.491 2.26-1.914z"/>
    </svg>
  );
}

// ── KPI 카드 ──────────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, icon: Icon, color,
}: {
  label: string; value: string; sub?: string;
  icon: React.ElementType; color: string;
}) {
  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-5">
      <div className="flex items-start justify-between mb-3">
        <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</p>
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${color}`}>
          <Icon size={15} className="text-white" />
        </div>
      </div>
      <p className="text-2xl font-bold text-zinc-800 dark:text-zinc-100 leading-none">{value}</p>
      {sub && <p className="text-xs text-zinc-400 mt-1.5">{sub}</p>}
    </div>
  );
}

// ── 캠페인 행 ─────────────────────────────────────────────────────────────

function CampaignRow({ c }: { c: MetaCampaign }) {
  const isActive = c.status === "ACTIVE";
  return (
    <div className="py-3 px-3 sm:px-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 rounded-xl transition-colors">
      <div className="flex items-start sm:items-center gap-3">
        <div className="shrink-0 mt-0.5 sm:mt-0">
          {isActive ? (
            <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-400 px-2 py-0.5 rounded-full">
              <Play size={8} fill="currentColor" /> 진행
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[10px] font-semibold text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded-full">
              <Pause size={8} fill="currentColor" /> 중지
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100 truncate">{c.name}</p>
          <p className="text-[11px] text-zinc-400 mt-0.5">{OBJECTIVE_KO[c.objective] ?? c.objective}</p>
        </div>
        <div className="hidden sm:grid grid-cols-4 gap-4 text-right shrink-0">
          <div>
            <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">{fmtKRW(c.spend)}</p>
            <p className="text-[10px] text-zinc-400">지출</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">{fmtCount(c.impressions)}</p>
            <p className="text-[10px] text-zinc-400">노출</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">{fmtPct(c.ctr)}</p>
            <p className="text-[10px] text-zinc-400">CTR</p>
          </div>
          <div>
            <p className={`text-xs font-semibold ${c.roas > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-400"}`}>
              {fmtRoas(c.roas)}
            </p>
            <p className="text-[10px] text-zinc-400">ROAS</p>
          </div>
        </div>
      </div>

      {/* 모바일: 4지표 2x2 그리드 (캠페인 이름 아래) */}
      <div className="grid grid-cols-4 gap-2 mt-2.5 sm:hidden">
        <div>
          <p className="text-[10px] text-zinc-400 leading-none">지출</p>
          <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-200 mt-1 tabular-nums">{fmtKRW(c.spend)}</p>
        </div>
        <div>
          <p className="text-[10px] text-zinc-400 leading-none">노출</p>
          <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-200 mt-1 tabular-nums">{fmtCount(c.impressions)}</p>
        </div>
        <div>
          <p className="text-[10px] text-zinc-400 leading-none">CTR</p>
          <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-200 mt-1 tabular-nums">{fmtPct(c.ctr)}</p>
        </div>
        <div>
          <p className="text-[10px] text-zinc-400 leading-none">ROAS</p>
          <p className={`text-xs font-semibold mt-1 tabular-nums ${c.roas > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-400"}`}>
            {fmtRoas(c.roas)}
          </p>
        </div>
      </div>
    </div>
  );
}

// ── 상태 배지 ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const isActive = status === "ACTIVE";
  return isActive ? (
    <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-400 px-2 py-0.5 rounded-full">
      <Play size={8} fill="currentColor" /> 진행
    </span>
  ) : (
    <span className="flex items-center gap-1 text-[10px] font-semibold text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded-full">
      <Pause size={8} fill="currentColor" /> 중지
    </span>
  );
}

// ── 광고 세트 탭 ──────────────────────────────────────────────────────────

function AdSetsTab({ accountId, period }: { accountId: string; period: Period }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adsets, setAdsets] = useState<MetaAdSet[] | null>(null);
  const cache = useRef<Partial<Record<Period, MetaAdSet[]>>>({});
  const loadedPeriod = useRef<Period | null>(null);

  const load = useCallback(async (p: Period) => {
    if (cache.current[p]) { setAdsets(cache.current[p]!); return; }
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/meta/adsets?accountId=${encodeURIComponent(accountId)}&period=${p}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `서버 오류 (${res.status})`);
      cache.current[p] = data.adsets;
      setAdsets(data.adsets);
    } catch (e: any) {
      setError(e.message ?? "광고 세트 조회 실패");
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  // 탭이 활성화될 때 또는 period가 바뀔 때 로드
  if (loadedPeriod.current !== period) {
    loadedPeriod.current = period;
    // useEffect 없이 직접 호출하면 렌더 중 setState가 되므로
    // 첫 렌더나 period 변경 시 setTimeout 0으로 처리
    setTimeout(() => load(period), 0);
  }

  if (loading || adsets === null) {
    return (
      <div className="flex items-center justify-center py-16 gap-2 text-zinc-400">
        <Loader2 size={18} className="animate-spin" />
        <span className="text-sm">광고 세트 데이터 로딩 중...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-start gap-2 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-xl px-4 py-3 text-sm m-4">
        <AlertCircle size={16} className="shrink-0 mt-0.5" />
        <div><p className="font-medium">광고 세트 조회 실패</p><p className="text-xs mt-0.5 opacity-80">{error}</p></div>
      </div>
    );
  }

  if (adsets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-zinc-400 gap-2">
        <Layers size={32} className="opacity-20" />
        <p className="text-sm">{PERIOD_LABEL[period]} 집행된 광고 세트가 없습니다</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-100 dark:border-zinc-800">
            <th className="text-left px-5 py-3 text-[11px] font-medium text-zinc-400 uppercase tracking-wider">광고 세트</th>
            <th className="text-left px-3 py-3 text-[11px] font-medium text-zinc-400 uppercase tracking-wider hidden sm:table-cell">캠페인</th>
            <th className="text-right px-3 py-3 text-[11px] font-medium text-zinc-400 uppercase tracking-wider">일예산</th>
            <th className="text-right px-3 py-3 text-[11px] font-medium text-zinc-400 uppercase tracking-wider">지출</th>
            <th className="text-right px-3 py-3 text-[11px] font-medium text-zinc-400 uppercase tracking-wider hidden md:table-cell">CTR</th>
            <th className="text-right px-5 py-3 text-[11px] font-medium text-zinc-400 uppercase tracking-wider">ROAS</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-50 dark:divide-zinc-800/50">
          {adsets.map((s) => (
            <tr key={s.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors">
              <td className="px-5 py-3.5">
                <div className="flex items-center gap-2">
                  <StatusBadge status={s.status} />
                  <span className="font-medium text-zinc-800 dark:text-zinc-100 truncate max-w-[160px]">{s.name}</span>
                </div>
              </td>
              <td className="px-3 py-3.5 text-zinc-500 dark:text-zinc-400 text-xs truncate max-w-[140px] hidden sm:table-cell">{s.campaignName}</td>
              <td className="px-3 py-3.5 text-right text-zinc-600 dark:text-zinc-300 text-xs">{s.dailyBudget > 0 ? fmtKRW(s.dailyBudget) : "-"}</td>
              <td className="px-3 py-3.5 text-right font-medium text-zinc-700 dark:text-zinc-200 text-xs">{fmtKRW(s.spend)}</td>
              <td className="px-3 py-3.5 text-right text-zinc-600 dark:text-zinc-300 text-xs hidden md:table-cell">{fmtPct(s.ctr)}</td>
              <td className="px-5 py-3.5 text-right">
                <span className={`text-xs font-semibold ${s.roas > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-400"}`}>
                  {fmtRoas(s.roas)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── 광고 소재 탭 ──────────────────────────────────────────────────────────

function AdsTab({ accountId, period }: { accountId: string; period: Period }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ads, setAds] = useState<MetaAd[] | null>(null);
  const cache = useRef<Partial<Record<Period, MetaAd[]>>>({});
  const loadedPeriod = useRef<Period | null>(null);

  const load = useCallback(async (p: Period) => {
    if (cache.current[p]) { setAds(cache.current[p]!); return; }
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/meta/ads?accountId=${encodeURIComponent(accountId)}&period=${p}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `서버 오류 (${res.status})`);
      cache.current[p] = data.ads;
      setAds(data.ads);
    } catch (e: any) {
      setError(e.message ?? "광고 조회 실패");
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  if (loadedPeriod.current !== period) {
    loadedPeriod.current = period;
    setTimeout(() => load(period), 0);
  }

  if (loading || ads === null) {
    return (
      <div className="flex items-center justify-center py-16 gap-2 text-zinc-400">
        <Loader2 size={18} className="animate-spin" />
        <span className="text-sm">광고 소재 데이터 로딩 중...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-start gap-2 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-xl px-4 py-3 text-sm m-4">
        <AlertCircle size={16} className="shrink-0 mt-0.5" />
        <div><p className="font-medium">광고 소재 조회 실패</p><p className="text-xs mt-0.5 opacity-80">{error}</p></div>
      </div>
    );
  }

  if (ads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-zinc-400 gap-2">
        <Image size={32} className="opacity-20" />
        <p className="text-sm">{PERIOD_LABEL[period]} 집행된 광고가 없습니다</p>
      </div>
    );
  }

  const rankColors = ["bg-amber-400", "bg-zinc-400", "bg-orange-600"];
  const rankLabels = ["1위", "2위", "3위"];

  return (
    <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {ads.map((ad, idx) => (
        <div key={ad.id} className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 overflow-hidden">
          {/* 썸네일 */}
          <div className="relative bg-zinc-100 dark:bg-zinc-800 h-40 flex items-center justify-center">
            {ad.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={ad.thumbnailUrl} alt={ad.name} className="w-full h-full object-cover" />
            ) : (
              <Image size={32} className="text-zinc-300 dark:text-zinc-600" />
            )}
            {idx < 3 && (
              <div className={`absolute top-2 left-2 w-8 h-8 rounded-full ${rankColors[idx]} flex items-center justify-center`}>
                <span className="text-[10px] font-bold text-white">{rankLabels[idx]}</span>
              </div>
            )}
            <div className="absolute top-2 right-2">
              <StatusBadge status={ad.status} />
            </div>
          </div>

          {/* 정보 */}
          <div className="p-4 space-y-3">
            <div>
              <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 leading-snug line-clamp-2">{ad.name}</p>
              {ad.title && <p className="text-xs text-zinc-400 mt-0.5 truncate">{ad.title}</p>}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-xl px-3 py-2">
                <p className="text-[10px] text-zinc-400">지출</p>
                <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">{fmtKRW(ad.spend)}</p>
              </div>
              <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-xl px-3 py-2">
                <p className="text-[10px] text-zinc-400">ROAS</p>
                <p className={`text-sm font-semibold ${ad.roas > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-400"}`}>{fmtRoas(ad.roas)}</p>
              </div>
              <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-xl px-3 py-2">
                <p className="text-[10px] text-zinc-400">CTR</p>
                <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">{fmtPct(ad.ctr)}</p>
              </div>
              <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-xl px-3 py-2">
                <p className="text-[10px] text-zinc-400">빈도</p>
                <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">{ad.frequency.toFixed(1)}회</p>
              </div>
            </div>

            <p className="text-[11px] text-zinc-400 truncate">{ad.adsetName || ad.campaignName}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────

export default function MetaAdsDashboard({ metaData, isConnected, error }: Props) {
  const [period, setPeriod] = useState<Period>("month");
  const [dashTab, setDashTab] = useState<DashTab>("campaigns");

  // 캠페인 캐시: period → campaigns (month는 SSR 데이터 사용)
  const campaignCache = useRef<Partial<Record<Period, MetaCampaign[]>>>({});
  const [campaignLoading, setCampaignLoading] = useState(false);
  const [campaignError,   setCampaignError]   = useState<string | null>(null);
  const [displayCampaigns, setDisplayCampaigns] = useState<MetaCampaign[] | null>(null);

  const handlePeriodChange = useCallback(async (p: Period) => {
    setPeriod(p);
    setCampaignError(null);

    // 이번 달: SSR 데이터 그대로 사용
    if (p === "month") {
      setDisplayCampaigns(null); // null → metaData.campaigns 사용
      return;
    }

    // 캐시 hit
    if (campaignCache.current[p]) {
      setDisplayCampaigns(campaignCache.current[p]!);
      return;
    }

    // API fetch
    if (!metaData) return;
    setCampaignLoading(true);
    try {
      const res  = await fetch(`/api/meta/campaigns?accountId=${encodeURIComponent(metaData.adAccountId)}&period=${p}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `서버 오류 (${res.status})`);
      campaignCache.current[p] = data.campaigns;
      setDisplayCampaigns(data.campaigns);
    } catch (e: any) {
      setCampaignError(e.message ?? "캠페인 조회 실패");
    } finally {
      setCampaignLoading(false);
    }
  }, [metaData]);

  const campaigns = displayCampaigns ?? metaData?.campaigns ?? [];
  const activeCampaigns = campaigns.filter((c) => c.status === "ACTIVE");
  const pausedCampaigns = campaigns.filter((c) => c.status !== "ACTIVE");

  // 기간별 계정 KPI 매핑
  const insights: MetaPeriodInsights | null = metaData
    ? period === "today"     ? metaData.today
    : period === "yesterday" ? metaData.yesterday
    : period === "last3d"    ? metaData.last3d
    : period === "last7d"    ? metaData.last7d
    : period === "week"      ? metaData.week
    : metaData.month
    : null;

  const DASH_TABS: { id: DashTab; label: string; icon: React.ElementType }[] = [
    { id: "campaigns", label: "캠페인", icon: Target },
    { id: "adsets",    label: "광고 세트", icon: Layers },
    { id: "ads",       label: "광고 소재", icon: Image },
  ];

  return (
    <main className="w-full min-w-0 max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-6">

      {/* ── 헤더 카드 ── */}
      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 px-6 py-5">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-700 rounded-xl flex items-center justify-center text-white shrink-0">
              <MetaLogo size={22} />
            </div>
            <div>
              <h1 className="text-lg font-bold text-zinc-800 dark:text-zinc-100">Meta 광고 성과</h1>
              {metaData ? (
                <p className="text-xs text-zinc-400 mt-0.5">
                  {metaData.adAccountName}
                  <span className="ml-2 text-zinc-300 dark:text-zinc-600">|</span>
                  <span className="ml-2">{metaData.adAccountId}</span>
                </p>
              ) : (
                <p className="text-xs text-zinc-400 mt-0.5">Facebook · Instagram 광고</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isConnected ? (
              <>
                <span className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 px-3 py-1.5 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  연결됨
                </span>
                <a
                  href="/api/meta/auth/logout"
                  className="flex items-center gap-1.5 text-xs font-medium bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 px-3 py-1.5 rounded-full transition-colors"
                >
                  <LogOut size={13} />
                  연결 해제
                </a>
              </>
            ) : (
              <a
                href="/api/meta/auth/login"
                className="flex items-center gap-1.5 text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl transition-colors"
              >
                <LogIn size={15} />
                Meta 광고 연결
              </a>
            )}
            {isConnected && (
              <a
                href="/ads"
                className="p-2 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-zinc-500"
                title="새로고침"
              >
                <RefreshCw size={15} />
              </a>
            )}
          </div>
        </div>
      </div>

      {/* ── 에러 배너 ── */}
      {error && (
        <div className="flex items-start gap-2 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-xl px-4 py-3 text-sm">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">데이터 조회 실패</p>
            <p className="text-xs mt-0.5 opacity-80">{error}</p>
            <a href="/api/meta/auth/login" className="text-xs underline mt-1 inline-block">
              재연결하기 →
            </a>
          </div>
        </div>
      )}

      {/* ── 미연결 안내 ── */}
      {!isConnected && !error && (
        <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-2xl p-10 text-center space-y-5">
          <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-blue-700 rounded-2xl flex items-center justify-center text-white mx-auto">
            <MetaLogo size={32} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-zinc-800 dark:text-zinc-100">Meta 광고 계정을 연결하세요</h2>
            <p className="text-sm text-zinc-500 mt-2 max-w-md mx-auto leading-relaxed">
              Facebook · Instagram 광고 성과를 한눈에 확인할 수 있습니다.
              캠페인별 지출, 노출, 클릭, CTR, ROAS를 실시간으로 모니터링하세요.
            </p>
          </div>
          <a
            href="/api/meta/auth/login"
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-8 py-3 rounded-xl transition-colors text-sm"
          >
            <LogIn size={16} />
            Meta Ads 연결하기
          </a>
        </div>
      )}

      {/* ── 연결됐으나 데이터 없음 ── */}
      {isConnected && !metaData && !error && (
        <div className="flex items-center justify-center py-16 text-zinc-400">
          <RefreshCw size={20} className="animate-spin mr-2" />
          데이터 로딩 중...
        </div>
      )}

      {/* ── 메인 대시보드 ── */}
      {metaData && insights && (
        <>
          {/* 기간 탭 (6개) */}
          <div className="flex bg-zinc-100 dark:bg-zinc-800 rounded-2xl p-1.5 gap-1 overflow-x-auto">
            {ALL_PERIODS.map((p) => (
              <button
                key={p}
                onClick={() => handlePeriodChange(p)}
                className={`flex-1 min-w-max py-2 px-3 text-sm font-medium rounded-xl transition-all whitespace-nowrap ${
                  period === p
                    ? "bg-white dark:bg-zinc-700 text-blue-600 dark:text-blue-400 shadow-sm"
                    : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                }`}
              >
                {PERIOD_LABEL[p]}
              </button>
            ))}
          </div>

          {/* KPI 카드 6개 */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <KpiCard
              label="광고 지출"
              value={fmtKRW(insights.spend)}
              icon={DollarSign}
              color="bg-blue-500"
            />
            <KpiCard
              label="노출"
              value={fmtCount(insights.impressions)}
              sub="회"
              icon={Eye}
              color="bg-violet-500"
            />
            <KpiCard
              label="클릭"
              value={fmtCount(insights.clicks)}
              sub="회"
              icon={MousePointerClick}
              color="bg-sky-500"
            />
            <KpiCard
              label="CTR"
              value={fmtPct(insights.ctr)}
              sub="클릭률"
              icon={TrendingUp}
              color="bg-indigo-500"
            />
            <KpiCard
              label="CPM"
              value={fmtKRW(insights.cpm)}
              sub="1,000회 노출당"
              icon={BarChart2}
              color="bg-cyan-500"
            />
            <KpiCard
              label="ROAS"
              value={fmtRoas(insights.roas)}
              sub={insights.roas > 0 ? `${(insights.roas * 100).toFixed(0)}% 수익률` : "전환 데이터 없음"}
              icon={Target}
              color={insights.roas >= 2 ? "bg-emerald-500" : "bg-rose-500"}
            />
          </div>

          {/* 도달 + 광고 계정 링크 */}
          <div className="flex items-center gap-4 flex-wrap">
            <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 px-5 py-4 flex items-center gap-4">
              <div>
                <p className="text-xs text-zinc-400">도달 (Reach)</p>
                <p className="text-xl font-bold text-zinc-800 dark:text-zinc-100 mt-0.5">{fmtCount(insights.reach)}명</p>
              </div>
              <div className="w-px h-8 bg-zinc-100 dark:bg-zinc-700" />
              <div>
                <p className="text-xs text-zinc-400">집행 기간</p>
                <p className="text-sm font-semibold text-zinc-600 dark:text-zinc-300 mt-0.5">{PERIOD_LABEL[period]}</p>
              </div>
            </div>
            <a
              href={`https://business.facebook.com/adsmanager/manage/campaigns?act=${metaData.adAccountId.replace("act_", "")}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 font-medium bg-blue-50 dark:bg-blue-900/30 px-4 py-2.5 rounded-xl transition-colors"
            >
              <ExternalLink size={13} />
              광고 관리자에서 보기
            </a>
          </div>

          {/* 소재 피로도 알림 */}

          {/* 대시보드 탭 네비게이션 */}
          <div className="flex bg-zinc-100 dark:bg-zinc-800 rounded-2xl p-1.5 gap-1 overflow-x-auto">
            {DASH_TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setDashTab(id)}
                className={`flex-1 min-w-max flex items-center justify-center gap-1.5 py-2 px-3 text-sm font-medium rounded-xl transition-all whitespace-nowrap ${
                  dashTab === id
                    ? "bg-white dark:bg-zinc-700 text-violet-600 dark:text-violet-400 shadow-sm"
                    : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                }`}
              >
                <Icon size={13} />
                {label}
              </button>
            ))}
          </div>

          {/* 탭 콘텐츠 */}
          <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 overflow-hidden">

            {/* 캠페인 탭 */}
            {dashTab === "campaigns" && (
              <>
                <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-3">
                    <h2 className="text-base font-semibold text-zinc-800 dark:text-zinc-100">캠페인 현황</h2>
                    {!campaignLoading && (
                      <>
                        {activeCampaigns.length > 0 && (
                          <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-400 px-2 py-0.5 rounded-full">
                            진행 {activeCampaigns.length}개
                          </span>
                        )}
                        {pausedCampaigns.length > 0 && (
                          <span className="text-xs text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded-full">
                            중지 {pausedCampaigns.length}개
                          </span>
                        )}
                      </>
                    )}
                  </div>
                  <p className="text-xs text-zinc-400">{PERIOD_LABEL[period]} 기준</p>
                </div>

                {/* 로딩 */}
                {campaignLoading && (
                  <div className="flex items-center justify-center py-12 gap-2 text-zinc-400">
                    <Loader2 size={18} className="animate-spin" />
                    <span className="text-sm">캠페인 데이터 로딩 중...</span>
                  </div>
                )}

                {/* 캠페인 fetch 오류 */}
                {!campaignLoading && campaignError && (
                  <div className="flex items-center gap-2 mx-4 my-4 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-xl px-4 py-3 text-sm">
                    <AlertCircle size={14} className="shrink-0" />
                    {campaignError}
                  </div>
                )}

                {/* 캠페인 목록 */}
                {!campaignLoading && !campaignError && (
                  campaigns.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-zinc-400 gap-2">
                      <Target size={32} className="opacity-20" />
                      <p className="text-sm">{PERIOD_LABEL[period]} 집행된 캠페인이 없습니다</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-zinc-50 dark:divide-zinc-800/50">
                      {/* 진행 중 */}
                      {activeCampaigns.length > 0 && (
                        <div className="px-2 py-2">
                          {activeCampaigns.map((c) => (
                            <CampaignRow key={c.id} c={c} />
                          ))}
                        </div>
                      )}

                      {/* 중지 */}
                      {pausedCampaigns.length > 0 && (
                        <>
                          <div className="px-6 py-2 bg-zinc-50 dark:bg-zinc-800/30">
                            <p className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">중지된 캠페인</p>
                          </div>
                          <div className="px-2 py-2">
                            {pausedCampaigns.map((c) => (
                              <CampaignRow key={c.id} c={c} />
                            ))}
                          </div>
                        </>
                      )}

                      {/* 컬럼 헤더 */}
                      <div className="hidden sm:flex items-center gap-3 px-4 py-2 bg-zinc-50 dark:bg-zinc-800/30">
                        <div className="shrink-0 w-14" />
                        <div className="flex-1" />
                        <div className="grid grid-cols-4 gap-4 text-right shrink-0 text-[10px] font-medium text-zinc-400 uppercase tracking-wider">
                          <div>지출</div><div>노출</div><div>CTR</div><div>ROAS</div>
                        </div>
                      </div>
                    </div>
                  )
                )}
              </>
            )}

            {/* 광고 세트 탭 */}
            {dashTab === "adsets" && (
              <>
                <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                  <h2 className="text-base font-semibold text-zinc-800 dark:text-zinc-100">광고 세트 현황</h2>
                  <p className="text-xs text-zinc-400">{PERIOD_LABEL[period]} 기준 · ROAS 내림차순</p>
                </div>
                <AdSetsTab accountId={metaData.adAccountId} period={period} />
              </>
            )}

            {/* 광고 소재 탭 */}
            {dashTab === "ads" && (
              <>
                <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                  <h2 className="text-base font-semibold text-zinc-800 dark:text-zinc-100">광고 소재 성과</h2>
                  <p className="text-xs text-zinc-400">{PERIOD_LABEL[period]} 기준 · ROAS 내림차순</p>
                </div>
                <AdsTab accountId={metaData.adAccountId} period={period} />
              </>
            )}

          </div>
        </>
      )}
    </main>
  );
}
