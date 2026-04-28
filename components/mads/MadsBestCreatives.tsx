"use client";

import { useState } from "react";
import { Loader2, Trophy, Sparkles, AlertTriangle, ExternalLink, RefreshCw, Check } from "lucide-react";

interface BestCreative {
  adId:           string;
  adName:         string;
  adsetId:        string;
  adsetName:      string;
  campaignId:     string;
  campaignName:   string;
  accountId:      string;
  accountName:    string;
  spend90d:       number;
  revenue90d:     number;
  adjustedRevenue90d: number;
  conversions90d: number;
  roas90d:        number;
  adjustedRoas90d: number;
  spend30d:       number;
  conversions30d: number;
  roas30d:        number;
  largestRevenueShare: number;
  thumbnailUrl:   string | null;
  status:         string;
}

const DEFAULT_BUDGET_KRW = 150_000;

function fmtKRW(n: number) {
  if (n >= 100_000_000) return (n / 100_000_000).toFixed(1) + "억";
  if (n >= 10_000) return (n / 10_000).toFixed(1) + "만";
  return n.toLocaleString("ko-KR");
}

export default function MadsBestCreatives() {
  const [creatives, setCreatives] = useState<BestCreative[] | null>(null);
  const [errors,    setErrors]    = useState<Array<{ scope: string; error: string }>>([]);
  const [loading,   setLoading]   = useState(false);
  const [analyzed,  setAnalyzed]  = useState(false);
  const [budgetKrw, setBudgetKrw] = useState(DEFAULT_BUDGET_KRW);
  const [building,  setBuilding]  = useState<string | null>(null);
  const [buildResult, setBuildResult] = useState<Record<string, { ok: boolean; msg: string }>>({});

  const analyze = async () => {
    setLoading(true);
    setErrors([]);
    try {
      const res = await fetch("/api/mads/best-creatives");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "분석 실패");
      setCreatives(data.top ?? []);
      setErrors(data.errors ?? []);
      setAnalyzed(true);
    } catch (e) {
      setErrors([{ scope: "fetch", error: e instanceof Error ? e.message : "분석 실패" }]);
    } finally {
      setLoading(false);
    }
  };

  const build = async (c: BestCreative) => {
    if (!confirm(
      `"${c.adName}" 광고로 새 광고세트를 생성합니다.\n\n` +
      `- 일예산: ${fmtKRW(budgetKrw)}원\n` +
      `- 원본 세트(${c.adsetName})를 deep copy\n` +
      `- 새 세트 안의 다른 광고는 일시중지\n` +
      `- 새 세트 자체는 PAUSED — Meta UI에서 검토 후 활성화\n\n` +
      `진행할까요?`,
    )) return;

    setBuilding(c.adId);
    try {
      const res = await fetch("/api/mads/build-best-adset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originalAdsetId: c.adsetId,
          bestAdId:        c.adId,
          bestAdName:      c.adName,
          dailyBudgetKrw:  budgetKrw,
        }),
      });
      const data = await res.json();
      const baseMsg = data.ok
        ? `생성됨: ${data.newName} (다른 광고 ${data.pausedAdIds?.length ?? 0}개 중지). Meta UI에서 활성화하세요.`
        : `실패: ${data.errors?.join(" / ") ?? data.error ?? "알 수 없는 오류"}`;
      setBuildResult((prev) => ({ ...prev, [c.adId]: { ok: !!data.ok, msg: baseMsg } }));
    } catch (e) {
      setBuildResult((prev) => ({
        ...prev,
        [c.adId]: { ok: false, msg: e instanceof Error ? e.message : "오류" },
      }));
    } finally {
      setBuilding(null);
    }
  };

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 overflow-hidden">
      <div className="px-5 py-4 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Trophy size={16} className="text-amber-500" />
          <h3 className="text-base font-semibold text-zinc-800 dark:text-zinc-100">
            베스트 소재 자동 추천
          </h3>
          <span className="text-[11px] text-zinc-400">최근 90일</span>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-[11px] text-zinc-500 flex items-center gap-1.5">
            일예산:
            <input
              type="number"
              step={5000}
              min={5000}
              max={5_000_000}
              value={budgetKrw}
              onChange={(e) => setBudgetKrw(Number(e.target.value))}
              className="w-24 px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs tabular-nums text-zinc-800 dark:text-zinc-200"
            />
            <span className="text-zinc-400">원</span>
          </label>
          <button
            onClick={analyze}
            disabled={loading}
            className="text-xs bg-zinc-900 hover:bg-zinc-700 dark:bg-zinc-100 dark:hover:bg-zinc-300 dark:text-zinc-900 text-white px-3 py-2 rounded-xl flex items-center gap-1.5 disabled:opacity-50"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            {analyzed ? "다시 분석" : "베스트 분석"}
          </button>
        </div>
      </div>

      <div className="p-4 sm:p-5">
        {!analyzed && !loading && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400 text-center py-8">
            &lsquo;베스트 분석&rsquo; 버튼을 눌러 최근 90일간 가장 효과 좋았던 광고를 찾으세요.<br/>
            (지출 ≥ 30만원 또는 전환 ≥ 25건 + 큰 주문 보정 ROAS + decay 제외)
          </p>
        )}

        {loading && (
          <div className="flex items-center justify-center gap-2 py-8 text-zinc-400">
            <Loader2 size={16} className="animate-spin" />
            <span className="text-xs">90일치 광고 인사이트 분석 중... (1~2분 걸릴 수 있음)</span>
          </div>
        )}

        {errors.length > 0 && (
          <div className="mb-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-xl px-3 py-2 text-xs text-red-700 dark:text-red-300">
            {errors.map((e, i) => <p key={i}>⚠ {e.scope}: {e.error}</p>)}
          </div>
        )}

        {analyzed && creatives && creatives.length === 0 && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400 text-center py-8">
            조건을 만족하는 베스트 소재가 없습니다. 표본 충분한 광고(지출 ≥ 30만원 또는 전환 ≥ 25건)가 더 필요해요.
          </p>
        )}

        {analyzed && creatives && creatives.length > 0 && (
          <div className="space-y-3">
            {creatives.map((c, idx) => {
              const result = buildResult[c.adId];
              const distorted = c.largestRevenueShare >= 0.4;
              return (
                <div
                  key={c.adId}
                  className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/40 overflow-hidden"
                >
                  <div className="p-3 sm:p-4 flex gap-3">
                    {/* Thumbnail */}
                    <div className="w-16 h-16 rounded-lg bg-zinc-200 dark:bg-zinc-800 overflow-hidden shrink-0 flex items-center justify-center">
                      {c.thumbnailUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={c.thumbnailUrl} alt={c.adName} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-2xl">📷</span>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">#{idx + 1}</span>
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${c.status === "ACTIVE" ? "bg-emerald-100 text-emerald-700" : "bg-zinc-200 text-zinc-600"}`}>
                          {c.status}
                        </span>
                        {distorted && (
                          <span className="text-[10px] font-semibold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded flex items-center gap-1">
                            <AlertTriangle size={9} /> 큰 주문 왜곡
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate mt-1">{c.adName}</p>
                      <p className="text-[11px] text-zinc-500 truncate">{c.campaignName} · {c.adsetName}</p>

                      <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                        <Cell label="90d ROAS" value={`${c.adjustedRoas90d.toFixed(2)}x`} sub={`raw ${c.roas90d.toFixed(2)}`} highlight />
                        <Cell label="30d ROAS" value={c.roas30d > 0 ? `${c.roas30d.toFixed(2)}x` : "-"} sub={c.conversions30d > 0 ? `${c.conversions30d}전환` : "데이터 없음"} />
                        <Cell label="90d 지출" value={`${fmtKRW(c.spend90d)}원`} sub={`${c.conversions90d}전환`} />
                        <Cell label="평균 객단가" value={c.conversions90d > 0 ? `${fmtKRW(Math.round(c.revenue90d / c.conversions90d))}원` : "-"} />
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-zinc-200 dark:border-zinc-800 px-3 sm:px-4 py-2.5 bg-white/40 dark:bg-zinc-900/30 flex items-center justify-between flex-wrap gap-2">
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                      이 광고로 새 세트 (일예산 {fmtKRW(budgetKrw)}원, PAUSED) 생성. 다른 광고는 자동 일시중지.
                    </p>
                    <button
                      onClick={() => build(c)}
                      disabled={building !== null}
                      className="text-xs font-semibold bg-violet-600 hover:bg-violet-700 text-white px-3 py-2 rounded-xl flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {building === c.adId ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                      새 세트 만들기
                    </button>
                  </div>

                  {result && (
                    <div className={`px-3 sm:px-4 py-2 text-xs ${result.ok ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300" : "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300"} flex items-start gap-2`}>
                      {result.ok ? <Check size={12} className="mt-0.5 shrink-0" /> : <AlertTriangle size={12} className="mt-0.5 shrink-0" />}
                      <span className="flex-1">{result.msg}</span>
                      {result.ok && (
                        <a
                          href="https://business.facebook.com/adsmanager/manage/adsets"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-[11px] font-medium underline"
                        >
                          Meta 열기 <ExternalLink size={9} />
                        </a>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Cell({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg px-2 py-1.5 ${highlight ? "bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50" : "bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800"}`}>
      <p className="text-[10px] text-zinc-400">{label}</p>
      <p className={`text-xs font-bold tabular-nums ${highlight ? "text-amber-700 dark:text-amber-400" : "text-zinc-800 dark:text-zinc-200"}`}>
        {value}
      </p>
      {sub && <p className="text-[10px] text-zinc-400 mt-0.5">{sub}</p>}
    </div>
  );
}
