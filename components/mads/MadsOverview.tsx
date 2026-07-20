"use client";

/**
 * MADS 광고 현황판 — Ads Manager 안 들어가도 되는 계층 뷰.
 * 계정 → 광고세트(캠페인 라벨) → 개별 광고(소재 썸네일) 드릴다운.
 * 지표: 오늘/7일 지출, 7일 ROAS(BE 대비 색), 전환, CTR, CPM, 빈도, 7일 스파크라인, 소재 피로.
 */
import { useCallback, useEffect, useState } from "react";
import { AlertCircle, ChevronDown, ChevronRight, ImageIcon, Loader2, Video } from "lucide-react";

interface DayPoint { date: string; spend: number; revenue: number; conversions: number; ctr: number | null; cpm: number | null; frequency: number | null }
interface AdRow {
  metaAdId: string; name: string; effectiveStatus: string; creativeFormat: string;
  thumbnailUrl: string | null; spend7d: number; revenue7d: number; roas7d: number;
  conversions7d: number; spendToday: number; ctrRecent: number | null;
  frequency: number | null; fatigued: boolean; days: DayPoint[];
}
interface AdsetRow {
  metaAdsetId: string; name: string; status: string; funnelStage: string;
  dailyBudget: number | null; campaignName: string | null;
  spendToday: number; spend7d: number; revenue7d: number; roas7d: number;
  conversions7d: number; ctr7d: number | null; cpmLatest: number | null; frequencyLatest: number | null;
  days: DayPoint[]; ads: AdRow[];
}
interface AccountBlock {
  accountId: string; accountName: string; adsets: AdsetRow[];
  totals: { spendToday: number; spend7d: number; revenue7d: number; roas7d: number; activeAdsets: number };
}

const won = (n: number) =>
  n >= 10000 ? `${(n / 10000).toFixed(n >= 100000 ? 0 : 1)}만` : Math.round(n).toLocaleString("ko-KR");

function roasColor(roas: number, be: number, spend: number): string {
  if (spend <= 0) return "text-zinc-400";
  if (roas >= be * 1.3) return "text-emerald-600 dark:text-emerald-400 font-bold";
  if (roas >= be) return "text-emerald-600/80 dark:text-emerald-400/80";
  if (roas >= be * 0.7) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400 font-bold";
}

function Spark({ days, be }: { days: DayPoint[]; be: number }) {
  const max = Math.max(...days.map((d) => d.spend), 1);
  return (
    <div className="flex items-end gap-[2px] h-7" title="일별 지출 (색=그날 ROAS)">
      {days.map((d) => {
        const roas = d.spend > 0 ? d.revenue / d.spend : 0;
        const h = Math.max(2, Math.round((d.spend / max) * 26));
        const color = d.spend <= 0 ? "bg-zinc-200 dark:bg-zinc-700"
          : roas >= be ? "bg-emerald-400" : roas >= be * 0.7 ? "bg-amber-400" : "bg-red-400";
        return <div key={d.date} className={`w-[7px] rounded-sm ${color}`} style={{ height: h }} title={`${d.date.slice(5)} · ₩${won(d.spend)} · ROAS ${roas.toFixed(2)}`} />;
      })}
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    ACTIVE: ["bg-emerald-500", "활성"],
    PAUSED: ["bg-zinc-300 dark:bg-zinc-600", "중지"],
    ADSET_PAUSED: ["bg-zinc-300 dark:bg-zinc-600", "세트중지"],
    CAMPAIGN_PAUSED: ["bg-zinc-300 dark:bg-zinc-600", "캠페인중지"],
    PENDING_REVIEW: ["bg-amber-400", "검토중"],
    DISAPPROVED: ["bg-red-500", "거부됨"],
    WITH_ISSUES: ["bg-red-400", "문제"],
  };
  const [cls, label] = map[status] ?? ["bg-zinc-300", status];
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
      <span className={`w-2 h-2 rounded-full ${cls}`} />{label}
    </span>
  );
}

function AdLine({ ad, be }: { ad: AdRow; be: number }) {
  return (
    <div className="flex items-center gap-3 py-2 pl-2 pr-3 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
      <div className="w-11 h-11 rounded-lg bg-zinc-100 dark:bg-zinc-800 overflow-hidden shrink-0 flex items-center justify-center">
        {ad.thumbnailUrl
          ? <img src={ad.thumbnailUrl} alt="" className="w-full h-full object-cover" />
          : ad.creativeFormat === "video" ? <Video size={16} className="text-zinc-400" /> : <ImageIcon size={16} className="text-zinc-400" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200 truncate">{ad.name}</span>
          {ad.creativeFormat === "video" && <Video size={11} className="text-zinc-400 shrink-0" />}
          {ad.fatigued && (
            <span className="text-[10px] bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded shrink-0">소재 피로</span>
          )}
        </div>
        <div className="text-[11px] text-zinc-400 mt-0.5">
          <StatusDot status={ad.effectiveStatus} />
        </div>
      </div>
      <div className="text-right shrink-0 tabular-nums">
        <div className="text-xs text-zinc-600 dark:text-zinc-300">₩{won(ad.spend7d)}<span className="text-zinc-400">/7일</span></div>
        <div className={`text-xs ${roasColor(ad.roas7d, be, ad.spend7d)}`}>ROAS {ad.spend7d > 0 ? ad.roas7d.toFixed(2) : "-"}</div>
      </div>
      <div className="text-right shrink-0 tabular-nums hidden sm:block w-20">
        <div className="text-[11px] text-zinc-500">CTR {ad.ctrRecent !== null ? ad.ctrRecent.toFixed(2) + "%" : "-"}</div>
        <div className="text-[11px] text-zinc-500">빈도 {ad.frequency !== null ? ad.frequency.toFixed(1) : "-"}</div>
      </div>
    </div>
  );
}

function AdsetBlock({ a, be }: { a: AdsetRow; be: number }) {
  const [open, setOpen] = useState(false);
  const funnel = a.funnelStage === "retargeting" ? "리타겟" : a.funnelStage === "prospecting" ? "신규" : null;
  return (
    <div className="border border-zinc-100 dark:border-zinc-800 rounded-xl overflow-hidden">
      <button onClick={() => setOpen((v) => !v)} className="w-full text-left px-3 py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors">
        <div className="flex items-center gap-2 flex-wrap">
          {open ? <ChevronDown size={13} className="text-zinc-400 shrink-0" /> : <ChevronRight size={13} className="text-zinc-400 shrink-0" />}
          <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 truncate max-w-[46vw] sm:max-w-xs">{a.name}</span>
          {funnel && <span className="text-[10px] bg-zinc-100 dark:bg-zinc-800 text-zinc-500 px-1.5 py-0.5 rounded">{funnel}</span>}
          <StatusDot status={a.status} />
          {a.ads.length > 0 && <span className="text-[10px] text-zinc-400">광고 {a.ads.length}</span>}
          <span className="ml-auto"><Spark days={a.days} be={be} /></span>
        </div>
        {a.campaignName && <div className="text-[10px] text-zinc-400 mt-0.5 ml-5 truncate">{a.campaignName}</div>}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-x-3 gap-y-1 mt-2 ml-5 tabular-nums">
          <div><div className="text-[10px] text-zinc-400">오늘 지출</div><div className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">₩{won(a.spendToday)}{a.dailyBudget ? <span className="text-zinc-400 font-normal">/{won(a.dailyBudget)}</span> : ""}</div></div>
          <div><div className="text-[10px] text-zinc-400">7일 지출</div><div className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">₩{won(a.spend7d)}</div></div>
          <div><div className="text-[10px] text-zinc-400">7일 ROAS</div><div className={`text-xs ${roasColor(a.roas7d, be, a.spend7d)}`}>{a.spend7d > 0 ? a.roas7d.toFixed(2) : "-"}</div></div>
          <div><div className="text-[10px] text-zinc-400">전환 7일</div><div className="text-xs text-zinc-700 dark:text-zinc-200">{a.conversions7d}</div></div>
          <div><div className="text-[10px] text-zinc-400">CTR 7일</div><div className="text-xs text-zinc-700 dark:text-zinc-200">{a.ctr7d !== null ? a.ctr7d.toFixed(2) + "%" : "-"}</div></div>
          <div><div className="text-[10px] text-zinc-400">CPM·빈도</div><div className="text-xs text-zinc-700 dark:text-zinc-200">{a.cpmLatest !== null ? "₩" + won(a.cpmLatest) : "-"} · {a.frequencyLatest !== null ? a.frequencyLatest.toFixed(1) : "-"}</div></div>
        </div>
      </button>
      {open && a.ads.length > 0 && (
        <div className="border-t border-zinc-100 dark:border-zinc-800 px-2 py-1.5 space-y-0.5 bg-zinc-50/50 dark:bg-zinc-900/40">
          {a.ads.map((ad) => <AdLine key={ad.metaAdId} ad={ad} be={be} />)}
        </div>
      )}
      {open && a.ads.length === 0 && (
        <div className="border-t border-zinc-100 dark:border-zinc-800 px-4 py-3 text-[11px] text-zinc-400">개별 광고 데이터 없음 — 상단 &lsquo;지금 평가&rsquo; 실행 시 수집됩니다</div>
      )}
    </div>
  );
}

export default function MadsOverview() {
  const [data, setData] = useState<{ accounts: AccountBlock[]; beRoas: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/mads/overview");
      const j = await res.json();
      if (!j.ok) throw new Error(j.error ?? "조회 실패");
      setData({ accounts: j.accounts, beRoas: j.beRoas });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "조회 실패");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading && !data) {
    return <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 px-6 py-8 flex items-center justify-center text-zinc-400 text-sm"><Loader2 size={15} className="animate-spin mr-2" />현황판 로딩...</div>;
  }
  if (error) {
    return <div className="flex items-center gap-2 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-xl px-4 py-3 text-sm"><AlertCircle size={14} />{error}</div>;
  }
  if (!data || data.accounts.length === 0) {
    return <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 px-6 py-6 text-sm text-zinc-400">아직 수집된 광고 데이터가 없습니다 — &lsquo;지금 평가&rsquo;를 한 번 실행해주세요.</div>;
  }

  return (
    <div className="space-y-4">
      {data.accounts.map((acc) => (
        <section key={acc.accountId} className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 px-4 sm:px-5 py-4">
          <div className="flex items-baseline justify-between flex-wrap gap-2 mb-3">
            <h3 className="text-sm font-bold text-zinc-800 dark:text-zinc-100">
              {acc.accountName}
              <span className="ml-2 text-[11px] font-normal text-zinc-400">활성 세트 {acc.totals.activeAdsets}</span>
            </h3>
            <div className="flex items-center gap-4 tabular-nums text-xs">
              <span className="text-zinc-500">오늘 <strong className="text-zinc-800 dark:text-zinc-100">₩{won(acc.totals.spendToday)}</strong></span>
              <span className="text-zinc-500">7일 <strong className="text-zinc-800 dark:text-zinc-100">₩{won(acc.totals.spend7d)}</strong> → ₩{won(acc.totals.revenue7d)}</span>
              <span className={roasColor(acc.totals.roas7d, data.beRoas, acc.totals.spend7d)}>ROAS {acc.totals.spend7d > 0 ? acc.totals.roas7d.toFixed(2) : "-"}</span>
            </div>
          </div>
          <div className="space-y-2">
            {acc.adsets.map((a) => <AdsetBlock key={a.metaAdsetId} a={a} be={data.beRoas} />)}
          </div>
        </section>
      ))}
      <p className="text-[11px] text-zinc-400 px-1">손익분기 ROAS {data.beRoas.toFixed(2)} 기준 색상 · 데이터는 매일 09:00 자동 수집(또는 &lsquo;지금 평가&rsquo;)</p>
    </div>
  );
}
