"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Megaphone, Plus, Loader2, AlertCircle, Pencil, Copy, Check,
  Download, RefreshCw, ExternalLink,
} from "lucide-react";
import CampaignEditModal from "./CampaignEditModal";
import type { Campaign, CampaignBrand, CampaignMetrics } from "@/lib/campaigns/types";

function fmtKRW(n: number) {
  if (n >= 100_000_000) return (n / 100_000_000).toFixed(1) + "억원";
  if (n >= 10_000)      return (n / 10_000).toFixed(0) + "만원";
  return n.toLocaleString("ko-KR") + "원";
}

function todayKst(): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  const ax = Date.UTC(+a.slice(0,4), +a.slice(5,7) - 1, +a.slice(8,10));
  const bx = Date.UTC(+b.slice(0,4), +b.slice(5,7) - 1, +b.slice(8,10));
  return Math.round((bx - ax) / 86400000);
}

interface StatusInfo {
  label: string;
  color: string; // tailwind text color
  bg: string;
}

function statusFor(c: Campaign): StatusInfo {
  const today = todayKst();
  if (c.startDate > today) {
    const d = daysBetween(today, c.startDate);
    return { label: `D-${d} 시작 예정`, color: "text-violet-700 dark:text-violet-300", bg: "bg-violet-100 dark:bg-violet-900/40" };
  }
  if (c.endDate && c.endDate < today) {
    const d = daysBetween(c.endDate, today);
    return { label: `${d}일 전 종료`, color: "text-zinc-600 dark:text-zinc-300", bg: "bg-zinc-100 dark:bg-zinc-800" };
  }
  const elapsed = daysBetween(c.startDate, today);
  return { label: `진행중 ${elapsed + 1}일째`, color: "text-emerald-700 dark:text-emerald-300", bg: "bg-emerald-100 dark:bg-emerald-900/40" };
}

function buildShareUrl(c: Campaign): string {
  try {
    const url = new URL(c.landingUrl);
    if (c.utmSource)   url.searchParams.set("utm_source",   c.utmSource);
    if (c.utmCampaign) url.searchParams.set("utm_campaign", c.utmCampaign);
    url.searchParams.set("utm_medium", "influencer");
    return url.toString();
  } catch {
    return c.landingUrl;
  }
}

interface Props {
  brand: CampaignBrand;
}

export default function CampaignTracker({ brand }: Props) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [editing,   setEditing]   = useState<Campaign | null>(null);
  const [creating,  setCreating]  = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns?brand=${brand}`, { cache: "no-store" });
      const j   = await res.json();
      if (!j.ok) throw new Error(j.error ?? "조회 실패");
      setCampaigns(j.campaigns as Campaign[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [brand]);

  useEffect(() => { load(); }, [load]);

  // 종료일 지난 → 진행중 → 예정 순으로 정렬: 진행중을 가장 위로
  const sorted = [...campaigns].sort((a, b) => {
    const today = todayKst();
    const score = (c: Campaign) => {
      if (c.startDate <= today && (!c.endDate || c.endDate >= today)) return 0;
      if (c.startDate > today) return 1;
      return 2;
    };
    return score(a) - score(b);
  });

  const onSaved = () => {
    setEditing(null);
    setCreating(false);
    load();
  };

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 overflow-hidden">
      <div className="px-5 sm:px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-gradient-to-br from-fuchsia-500 to-pink-600 rounded-lg flex items-center justify-center text-white shrink-0">
            <Megaphone size={15} />
          </div>
          <div>
            <h2 className="text-base font-semibold text-zinc-800 dark:text-zinc-100">캠페인 트래킹</h2>
            <p className="text-[11px] text-zinc-400 leading-none mt-0.5">인플루언서 컬랩 · 쿠폰 코드 매칭</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 disabled:opacity-50"
            aria-label="새로고침"
            title="새로고침"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
          <button
            onClick={() => setCreating(true)}
            className="text-xs font-semibold bg-violet-600 hover:bg-violet-700 text-white px-3 py-1.5 rounded-full flex items-center gap-1 transition"
          >
            <Plus size={12} /> 새 캠페인
          </button>
        </div>
      </div>

      <div className="px-5 sm:px-6 py-4 space-y-3">
        {loading && campaigns.length === 0 && (
          <div className="flex items-center justify-center py-6 gap-2 text-zinc-400">
            <Loader2 size={14} className="animate-spin" />
            <span className="text-xs">불러오는 중...</span>
          </div>
        )}

        {!loading && error && (
          <div className="flex items-center gap-2 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-xl px-4 py-3 text-sm">
            <AlertCircle size={14} className="shrink-0" />
            {error}
          </div>
        )}

        {!loading && !error && campaigns.length === 0 && (
          <p className="text-xs text-zinc-400 text-center py-6">
            등록된 캠페인이 없습니다 — 인플루언서 컬랩이나 프로모션 시작 전 추가하세요.
          </p>
        )}

        {sorted.map((c) => (
          <CampaignCard key={c.id} campaign={c} brand={brand} onEdit={() => setEditing(c)} />
        ))}
      </div>

      {(editing || creating) && (
        <CampaignEditModal
          campaign={editing}
          brand={brand}
          onClose={() => { setEditing(null); setCreating(false); }}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// 캠페인 카드
// ────────────────────────────────────────────────────────────────────

function CampaignCard({
  campaign, brand, onEdit,
}: {
  campaign: Campaign;
  brand: CampaignBrand;
  onEdit: () => void;
}) {
  const status = statusFor(campaign);
  const shareUrl = buildShareUrl(campaign);

  const [metrics, setMetrics] = useState<CampaignMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr]         = useState<string | null>(null);
  const [copied, setCopied]   = useState(false);

  const loadMetrics = useCallback(async () => {
    if (campaign.startDate > todayKst()) return; // 시작 전엔 호출 안 함
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/campaigns/metrics?brand=${brand}&id=${campaign.id}`, { cache: "no-store" });
      const j   = await res.json();
      if (!j.ok) throw new Error(j.error ?? "조회 실패");
      setMetrics(j.metrics as CampaignMetrics);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [brand, campaign.id, campaign.startDate]);

  useEffect(() => { loadMetrics(); }, [loadMetrics]);

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  const exportUrl = `/api/campaigns/export?brand=${brand}&id=${campaign.id}`;
  const isLive = campaign.startDate <= todayKst() && (!campaign.endDate || campaign.endDate >= todayKst());

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/40 p-4 space-y-3">
      {/* 헤더 */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-bold text-zinc-800 dark:text-zinc-100">{campaign.name}</h3>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${status.bg} ${status.color}`}>
              {status.label}
            </span>
          </div>
          <p className="text-[11px] text-zinc-400 mt-0.5 tabular-nums">
            {campaign.startDate} ~ {campaign.endDate ?? "미정"}
            {campaign.couponCode && <span className="ml-2">· 쿠폰 <code className="text-zinc-600 dark:text-zinc-300">{campaign.couponCode}</code></span>}
          </p>
        </div>
        <button
          onClick={onEdit}
          className="text-xs font-medium text-zinc-500 hover:text-violet-600 dark:hover:text-violet-400 px-2 py-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center gap-1 shrink-0"
          aria-label="편집"
        >
          <Pencil size={11} /> 편집
        </button>
      </div>

      {/* 메트릭 */}
      {!isLive && campaign.startDate > todayKst() ? (
        <p className="text-[11px] text-zinc-500 italic">캠페인 시작 후 자동 집계됩니다.</p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          <Metric label="주문"    value={loading ? "…" : (metrics?.ordersCount ?? 0).toLocaleString("ko-KR") + "건"} />
          <Metric label="매출"    value={loading ? "…" : fmtKRW(metrics?.revenue ?? 0)} accent />
          <Metric label="평균 주문" value={loading ? "…" : fmtKRW(metrics?.avgOrder ?? 0)} />
        </div>
      )}

      {err && (
        <p className="text-[11px] text-red-600 dark:text-red-400 flex items-center gap-1">
          <AlertCircle size={11} /> {err}
        </p>
      )}
      {metrics?.warning && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1">
          <AlertCircle size={11} /> {metrics.warning}
        </p>
      )}

      {/* 공유 URL */}
      <div className="flex items-center gap-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg px-2.5 py-1.5">
        <span className="text-[10px] font-semibold text-zinc-400 shrink-0">공유 URL</span>
        <code className="text-[11px] text-zinc-700 dark:text-zinc-300 truncate flex-1 min-w-0">{shareUrl}</code>
        <button
          onClick={copyUrl}
          className="text-zinc-400 hover:text-emerald-600 shrink-0"
          aria-label="URL 복사"
          title="URL 복사"
        >
          {copied ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
        </button>
        <a
          href={shareUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-zinc-400 hover:text-violet-600 shrink-0"
          aria-label="새 탭에서 열기"
          title="새 탭에서 열기"
        >
          <ExternalLink size={12} />
        </a>
      </div>

      {/* 액션: 명단 다운로드 */}
      {(metrics?.buyers.length ?? 0) > 0 && (
        <a
          href={exportUrl}
          className="text-[11px] font-medium text-violet-600 dark:text-violet-400 hover:underline inline-flex items-center gap-1"
        >
          <Download size={11} /> 구매자 명단 CSV ({metrics?.buyers.length}건)
        </a>
      )}
    </div>
  );
}

function Metric({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-white dark:bg-zinc-900 rounded-lg p-2.5">
      <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mb-0.5">{label}</p>
      <p className={`text-sm font-bold tabular-nums ${
        accent ? "text-emerald-700 dark:text-emerald-400" : "text-zinc-800 dark:text-zinc-100"
      }`}>
        {value}
      </p>
    </div>
  );
}
