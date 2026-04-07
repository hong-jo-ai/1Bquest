"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Gem, Play, TrendingDown, TrendingUp, Minus, Clock,
  ArrowDown, ArrowUp, BarChart3, DollarSign, Eye, ShoppingCart,
  Megaphone, MousePointerClick, Users, Zap,
} from "lucide-react";

// ── 타입 (서버 응답) ──────────────────────────────────────────────────────

interface ClearanceProduct {
  sku: string;
  name: string;
  image: string;
  currentPrice: number;
  originalPrice: number;
  floorPrice: number;
  hits: number;
  sales: number;
  conversionRate: number;
  velocity: number;
  elasticity: "responsive" | "neutral" | "unresponsive" | "no_data";
  adjustmentPct: number;
  newPrice: number;
  displayOrder: number;
}

interface ClearanceHistoryEntry {
  date: string;
  sku: string;
  name: string;
  prevPrice: number;
  newPrice: number;
  adjustmentPct: number;
  velocity: number;
  conversionRate: number;
  elasticity: string;
  displayOrder: number;
}

interface AdStatus {
  hasCampaign: boolean;
  campaignId: string | null;
  campaignName: string | null;
  campaignStatus: string | null;
  adSetsCount: number;
  activeAdsCount: number;
  totalSpend: number;
  totalRevenue: number;
  roas: number;
  totalImpressions: number;
  totalClicks: number;
  ctr: number;
}

interface BudgetAdjustment {
  adSetId: string;
  adSetName: string;
  previousBudget: number;
  newBudget: number;
  roas: number;
  changePct: number;
}

interface AdResult {
  campaignId?: string | null;
  campaignName?: string | null;
  adjustments?: BudgetAdjustment[];
  errors?: string[];
  error?: string;
  skipped?: boolean;
  reason?: string;
}

interface StatusResponse {
  lastRun: string | null;
  recentHistory: ClearanceHistoryEntry[];
  originalPrices: Record<string, number>;
  totalProducts: number;
  totalDiscount: number;
  adStatus: AdStatus | null;
}

interface RunResult {
  executedAt: string;
  products: ClearanceProduct[];
  priceChanges: number;
  displayChanges: number;
  totalDiscountAmount: number;
  debug?: {
    totalProducts: number;
    allCategories: string[];
    jewelryKeywords: string[];
  };
  adResult?: AdResult | null;
}

// ── 유틸 ──────────────────────────────────────────────────────────────────

const ELASTICITY_LABELS: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  responsive:   { label: "반응 좋음",  color: "text-emerald-600", icon: TrendingUp },
  neutral:      { label: "변화 없음",  color: "text-yellow-600",  icon: Minus },
  unresponsive: { label: "반응 없음",  color: "text-red-500",     icon: TrendingDown },
  no_data:      { label: "데이터 수집중", color: "text-zinc-400", icon: Clock },
};

function formatPrice(n: number) {
  return n.toLocaleString("ko-KR") + "원";
}

function formatPct(n: number) {
  return n > 0 ? `-${n}%` : n === 0 ? "유지" : `+${Math.abs(n)}%`;
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────

export default function JewelryClearance() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [lastResult, setLastResult] = useState<RunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "ads" | "history">("overview");

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/cafe24/jewelry-clearance");
      if (res.ok) setStatus(await res.json());
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const handleRun = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/cafe24/jewelry-clearance", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? `실행 실패 (${res.status})`);
      }
      if (data.products?.length === 0) {
        setError("주얼리 카테고리 상품을 찾지 못했습니다. 카테고리 이름을 확인해주세요.");
      } else if (data.errors?.length > 0) {
        setError(`실행 완료 (일부 오류 ${data.errors.length}건):\n${data.errors.slice(0, 3).join("\n")}`);
      }
      // 광고 결과 표시
      if (data.adResult?.errors?.length > 0) {
        setError(prev => {
          const adErrors = `광고 오류: ${data.adResult.errors.slice(0, 2).join("; ")}`;
          return prev ? `${prev}\n${adErrors}` : adErrors;
        });
      }
      setLastResult(data);
      fetchStatus();
    } catch (e: any) {
      setError(e.message ?? "알 수 없는 오류가 발생했습니다");
    } finally {
      setRunning(false);
    }
  };

  const handleRestore = async () => {
    if (!confirm("모든 주얼리 상품을 원래 가격으로 복구합니다. 진행할까요?")) return;
    setRestoring(true);
    setError(null);
    try {
      const res = await fetch("/api/cafe24/jewelry-clearance/restore", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setError(`복구 완료: ${data.restored}개 상품 원래 가격으로 복구됨${data.errors?.length > 0 ? ` (오류 ${data.errors.length}건)` : ""}`);
      setLastResult(null);
      fetchStatus();
    } catch (e: any) {
      setError(`복구 실패: ${e.message}`);
    } finally {
      setRestoring(false);
    }
  };

  // 이력에서 일별 요약 계산
  const dailySummary = status?.recentHistory
    ? Object.entries(
        status.recentHistory.reduce<Record<string, { count: number; totalDiscount: number }>>((acc, e) => {
          if (!acc[e.date]) acc[e.date] = { count: 0, totalDiscount: 0 };
          acc[e.date].count++;
          acc[e.date].totalDiscount += e.prevPrice - e.newPrice;
          return acc;
        }, {})
      ).sort(([a], [b]) => b.localeCompare(a))
    : [];

  return (
    <div className="space-y-6">
      {/* 헤더 + 실행 버튼 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-gradient-to-br from-pink-500 to-rose-600 rounded-xl p-2.5">
            <Gem size={20} className="text-white" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">주얼리 악성재고 청산</h2>
            <p className="text-xs text-zinc-400">
              아마존식 다이나믹 프라이싱 · 매일 오전 7시 자동 실행
              {status?.lastRun && <span> · 마지막 실행: {status.lastRun}</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRestore}
            disabled={restoring || running}
            className="flex items-center gap-2 bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-700 dark:hover:bg-zinc-600 disabled:opacity-50 text-zinc-700 dark:text-zinc-300 font-medium rounded-xl px-4 py-2.5 transition-colors text-sm"
          >
            {restoring ? "복구 중..." : "가격 복구"}
          </button>
          <button
            onClick={handleRun}
            disabled={running || restoring}
            className="flex items-center gap-2 bg-rose-600 hover:bg-rose-700 disabled:bg-rose-400 text-white font-semibold rounded-xl px-5 py-2.5 transition-colors text-sm"
          >
            {running ? (
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
            ) : (
              <Play size={15} />
            )}
            {running ? "분석 중... (최대 30초 소요)" : "지금 실행"}
          </button>
        </div>
      </div>

      {/* 에러 */}
      {error && (
        <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-xl px-4 py-3 text-sm text-red-700 dark:text-red-300">
          <p className="whitespace-pre-wrap">{error}</p>
          {lastResult?.debug && lastResult.products.length === 0 && (
            <div className="mt-2 text-xs text-red-500 dark:text-red-400">
              <p>전체 상품: {lastResult.debug.totalProducts}개</p>
              <p>검색 키워드: {lastResult.debug.jewelryKeywords.join(", ")}</p>
              <p>발견된 카테고리: {lastResult.debug.allCategories.length > 0 ? lastResult.debug.allCategories.join(", ") : "(없음)"}</p>
            </div>
          )}
        </div>
      )}

      {/* 통계 카드 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { icon: Gem,          label: "대상 상품",     value: status?.totalProducts ?? 0, color: "text-rose-500",    bg: "bg-rose-50",    suffix: "개" },
          { icon: DollarSign,   label: "총 할인액 (7일)", value: status?.totalDiscount ?? 0, color: "text-violet-500", bg: "bg-violet-50",  suffix: "원", isPrice: true },
          { icon: BarChart3,    label: "가격 변경",     value: lastResult?.priceChanges ?? "-", color: "text-blue-500", bg: "bg-blue-50",    suffix: "건" },
          { icon: Eye,          label: "진열 변경",     value: lastResult?.displayChanges ?? "-", color: "text-emerald-500", bg: "bg-emerald-50", suffix: "건" },
        ].map(({ icon: Icon, label, value, color, bg, suffix, isPrice }) => (
          <div key={label} className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className={`${bg} rounded-lg p-1.5`}>
                <Icon size={14} className={color} />
              </div>
              <span className="text-xs text-zinc-400">{label}</span>
            </div>
            <p className="text-xl font-bold text-zinc-800 dark:text-zinc-100">
              {isPrice && typeof value === "number" ? value.toLocaleString("ko-KR") : value}
              <span className="text-sm font-normal text-zinc-400 ml-1">{suffix}</span>
            </p>
          </div>
        ))}
      </div>

      {/* Meta 광고 상태 배너 */}
      {status?.adStatus?.hasCampaign && (
        <div className="flex items-center justify-between bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 border border-blue-200 dark:border-blue-800 rounded-xl px-4 py-3">
          <div className="flex items-center gap-2">
            <Megaphone size={16} className="text-blue-600" />
            <span className="text-sm text-blue-700 dark:text-blue-300">
              Meta 광고 운영 중 — 활성 광고 <b>{status.adStatus.activeAdsCount}개</b>
              {status.adStatus.totalSpend > 0 && (
                <span className="ml-2">
                  · 지출 {status.adStatus.totalSpend.toLocaleString("ko-KR")}원
                  · 클릭 {status.adStatus.totalClicks.toLocaleString()}회
                  · CTR {status.adStatus.ctr.toFixed(2)}%
                </span>
              )}
            </span>
          </div>
          <span className={`text-xs font-medium px-2 py-1 rounded-full ${
            status.adStatus.campaignStatus === "ACTIVE"
              ? "bg-emerald-100 text-emerald-700"
              : "bg-yellow-100 text-yellow-700"
          }`}>
            {status.adStatus.campaignStatus === "ACTIVE" ? "활성" : "일시중지"}
          </span>
        </div>
      )}

      {!status?.adStatus?.hasCampaign && (
        <div className="flex items-center flex-wrap gap-2 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-3 text-sm text-zinc-500">
          <Megaphone size={15} className="text-zinc-400 shrink-0" />
          {(status as any)?._meta?.hasMetaToken ? (
            <span>Meta 연결됨 (캠페인 없음{(status as any)?._meta?.metaError ? ` · 오류: ${(status as any)._meta.metaError}` : ""}) — "지금 실행"으로 캠페인을 생성하세요</span>
          ) : (
            <>
              <span>Meta 연결 후 "지금 실행"하면 자동으로 광고가 생성됩니다.</span>
              <a href="/api/meta/auth/login?returnTo=/jewelry-clearance" className="ml-auto shrink-0 font-semibold text-blue-600 hover:text-blue-700 underline underline-offset-2">
                Meta 연결 →
              </a>
            </>
          )}
        </div>
      )}

      {/* 실행 후 광고 결과 배너 */}
      {lastResult?.adResult && !lastResult.adResult.error && !lastResult.adResult.skipped && lastResult.adResult.adjustments && lastResult.adResult.adjustments.length > 0 && (
        <div className="flex items-center bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-xl px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
          <Zap size={15} className="mr-2" />
          광고 예산 ROAS 기반 조정 완료 · {lastResult.adResult.adjustments.length}개 광고 세트
          <span className="ml-1">— "광고 현황" 탭에서 확인하세요</span>
        </div>
      )}

      {lastResult?.adResult?.error && (
        <div className="flex items-center bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
          <Megaphone size={15} className="mr-2" />
          광고 예산 조정 실패: {lastResult.adResult.error}
        </div>
      )}

      {lastResult?.adResult?.skipped && (
        <div className="flex items-center bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-3 text-sm text-zinc-500">
          <Megaphone size={15} className="mr-2 text-zinc-400" />
          {lastResult.adResult.reason}
        </div>
      )}

      {/* 탭 */}
      <div className="flex gap-2 border-b border-zinc-200 dark:border-zinc-700">
        {(["overview", "ads", "history"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab
                ? "border-rose-500 text-rose-600"
                : "border-transparent text-zinc-400 hover:text-zinc-600"
            }`}
          >
            {tab === "overview" ? "실행 결과" : tab === "ads" ? "광고 현황" : "변경 이력"}
          </button>
        ))}
      </div>

      {/* 실행 결과 탭 */}
      {activeTab === "overview" && (
        lastResult ? (
          <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50">
                    <th className="text-left px-4 py-3 font-medium text-zinc-500">순위</th>
                    <th className="text-left px-4 py-3 font-medium text-zinc-500">상품</th>
                    <th className="text-right px-4 py-3 font-medium text-zinc-500">현재가</th>
                    <th className="text-right px-4 py-3 font-medium text-zinc-500">변경가</th>
                    <th className="text-right px-4 py-3 font-medium text-zinc-500">할인율</th>
                    <th className="text-right px-4 py-3 font-medium text-zinc-500">하한가</th>
                    <th className="text-right px-4 py-3 font-medium text-zinc-500">조회수</th>
                    <th className="text-right px-4 py-3 font-medium text-zinc-500">판매(7일)</th>
                    <th className="text-center px-4 py-3 font-medium text-zinc-500">탄력성</th>
                  </tr>
                </thead>
                <tbody>
                  {lastResult.products.map((p) => {
                    const el = ELASTICITY_LABELS[p.elasticity];
                    const ElIcon = el.icon;
                    return (
                      <tr key={p.sku} className="border-b border-zinc-50 dark:border-zinc-800/50 hover:bg-zinc-50 dark:hover:bg-zinc-800/30">
                        <td className="px-4 py-3 text-zinc-400 font-mono">{p.displayOrder}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            {p.image && (
                              <img src={p.image} alt="" className="w-8 h-8 rounded-lg object-cover" />
                            )}
                            <div>
                              <p className="font-medium text-zinc-800 dark:text-zinc-200 truncate max-w-[200px]">{p.name}</p>
                              <p className="text-xs text-zinc-400">{p.sku}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right text-zinc-600 dark:text-zinc-400">{formatPrice(p.currentPrice)}</td>
                        <td className="px-4 py-3 text-right font-semibold text-zinc-800 dark:text-zinc-200">
                          {p.newPrice !== p.currentPrice ? (
                            <span className="text-rose-600">{formatPrice(p.newPrice)}</span>
                          ) : (
                            formatPrice(p.newPrice)
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {p.adjustmentPct > 0 ? (
                            <span className="inline-flex items-center gap-0.5 text-rose-600 font-medium">
                              <ArrowDown size={12} />
                              {p.adjustmentPct}%
                            </span>
                          ) : (
                            <span className="text-zinc-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-xs text-zinc-400">{formatPrice(p.floorPrice)}</td>
                        <td className="px-4 py-3 text-right text-zinc-600 dark:text-zinc-400">{p.hits.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right text-zinc-600 dark:text-zinc-400">{p.sales}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-flex items-center gap-1 text-xs font-medium ${el.color}`}>
                            <ElIcon size={12} />
                            {el.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {lastResult.products.length === 0 && (
              <div className="text-center py-12 text-zinc-400">
                <Gem size={32} className="mx-auto mb-2 opacity-30" />
                <p>주얼리 카테고리 상품이 없습니다</p>
              </div>
            )}
          </div>
        ) : (
          <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 text-center py-16">
            <Gem size={40} className="mx-auto mb-3 text-zinc-200 dark:text-zinc-700" />
            <p className="text-zinc-400 mb-1">"지금 실행" 버튼을 눌러 청산 엔진을 실행하세요</p>
            <p className="text-xs text-zinc-300 dark:text-zinc-600">
              매일 오전 7시에 자동으로 실행됩니다
            </p>
          </div>
        )
      )}

      {/* 광고 현황 탭 */}
      {activeTab === "ads" && (
        <div className="space-y-4">
          {status?.adStatus?.hasCampaign ? (
            <>
              {/* 캠페인 이름 */}
              {status.adStatus.campaignName && (
                <div className="text-sm text-zinc-500 dark:text-zinc-400">
                  캠페인: <span className="font-medium text-zinc-700 dark:text-zinc-300">{status.adStatus.campaignName}</span>
                </div>
              )}

              {/* 광고 지표 카드 */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                {[
                  { icon: BarChart3,         label: "ROAS (7일)",   value: status.adStatus.roas.toFixed(2), suffix: "",   color: status.adStatus.roas > 3 ? "text-emerald-500" : "text-rose-500", bg: status.adStatus.roas > 3 ? "bg-emerald-50" : "bg-rose-50" },
                  { icon: DollarSign,        label: "매출 (7일)",   value: status.adStatus.totalRevenue, suffix: "원", color: "text-blue-500",    bg: "bg-blue-50", isNum: true },
                  { icon: DollarSign,        label: "광고비 (7일)", value: status.adStatus.totalSpend,   suffix: "원", color: "text-rose-500",    bg: "bg-rose-50", isNum: true },
                  { icon: Eye,               label: "노출수 (7일)", value: status.adStatus.totalImpressions, suffix: "회", color: "text-violet-500", bg: "bg-violet-50", isNum: true },
                  { icon: MousePointerClick, label: "클릭수 (7일)", value: status.adStatus.totalClicks,  suffix: "회", color: "text-emerald-500", bg: "bg-emerald-50", isNum: true },
                ].map(({ icon: Icon, label, value, suffix, color, bg, isNum }) => (
                  <div key={label} className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <div className={`${bg} rounded-lg p-1.5`}><Icon size={14} className={color} /></div>
                      <span className="text-xs text-zinc-400">{label}</span>
                    </div>
                    <p className="text-xl font-bold text-zinc-800 dark:text-zinc-100">
                      {isNum ? (value as number).toLocaleString("ko-KR") : value}
                      {suffix && <span className="text-sm font-normal text-zinc-400 ml-1">{suffix}</span>}
                    </p>
                  </div>
                ))}
              </div>

              {/* 예산 조정 내역 */}
              {lastResult?.adResult?.adjustments && lastResult.adResult.adjustments.length > 0 && (
                <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 overflow-hidden">
                  <div className="px-4 py-3 bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-100 dark:border-zinc-800">
                    <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">예산 조정 내역</h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50">
                          <th className="text-left px-4 py-3 font-medium text-zinc-500">광고 세트</th>
                          <th className="text-right px-4 py-3 font-medium text-zinc-500">ROAS</th>
                          <th className="text-right px-4 py-3 font-medium text-zinc-500">이전 예산</th>
                          <th className="text-right px-4 py-3 font-medium text-zinc-500">변경 예산</th>
                          <th className="text-right px-4 py-3 font-medium text-zinc-500">변동</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lastResult.adResult.adjustments.map((adj) => (
                          <tr key={adj.adSetId} className="border-b border-zinc-50 dark:border-zinc-800/50">
                            <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">{adj.adSetName}</td>
                            <td className={`px-4 py-3 text-right font-semibold ${adj.roas > 3 ? "text-emerald-600" : "text-rose-500"}`}>
                              {adj.roas.toFixed(2)}
                            </td>
                            <td className="px-4 py-3 text-right text-zinc-500">{formatPrice(adj.previousBudget)}</td>
                            <td className="px-4 py-3 text-right font-semibold text-zinc-800 dark:text-zinc-200">{formatPrice(adj.newBudget)}</td>
                            <td className={`px-4 py-3 text-right font-medium ${adj.changePct > 0 ? "text-emerald-600" : adj.changePct < 0 ? "text-rose-500" : "text-zinc-400"}`}>
                              {adj.changePct > 0 ? `+${adj.changePct}%` : adj.changePct < 0 ? `${adj.changePct}%` : "유지"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* 안내 */}
              <div className="bg-zinc-50 dark:bg-zinc-800/30 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-5">
                <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-3">예산 자동 조정 규칙</h3>
                <div className="space-y-3 text-xs text-zinc-500 dark:text-zinc-400">
                  <div className="flex items-start gap-2">
                    <TrendingUp size={14} className="text-emerald-500 mt-0.5 shrink-0" />
                    <span>ROAS &gt; 3 → 일예산 <b className="text-emerald-600">25% 증가</b></span>
                  </div>
                  <div className="flex items-start gap-2">
                    <TrendingDown size={14} className="text-rose-500 mt-0.5 shrink-0" />
                    <span>ROAS ≤ 3 → 일예산 <b className="text-rose-500">20% 감소</b></span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Zap size={14} className="text-blue-500 mt-0.5 shrink-0" />
                    <span>이름에 "주얼리"가 포함된 캠페인의 활성 광고 세트만 대상</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Clock size={14} className="text-zinc-400 mt-0.5 shrink-0" />
                    <span>매일 오전 7시 청산 엔진과 함께 자동 실행</span>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 text-center py-16">
              <Megaphone size={40} className="mx-auto mb-3 text-zinc-200 dark:text-zinc-700" />
              <p className="text-zinc-400 mb-2">Meta 광고 계정을 연결하면 예산 자동 조정이 활성화됩니다</p>
              <a
                href="/api/meta/auth/login?returnTo=/jewelry-clearance"
                className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl px-5 py-2.5 transition-colors text-sm"
              >
                <Megaphone size={15} />
                Meta 연결하기
              </a>
            </div>
          )}
        </div>
      )}

      {/* 변경 이력 탭 */}
      {activeTab === "history" && (
        <div className="space-y-4">
          {dailySummary.length > 0 ? (
            dailySummary.map(([date, { count, totalDiscount }]) => {
              const dayEntries = status!.recentHistory.filter(e => e.date === date);
              return (
                <div key={date} className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-100 dark:border-zinc-800">
                    <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{date}</span>
                    <div className="flex items-center gap-4 text-xs text-zinc-400">
                      <span>{count}개 상품</span>
                      <span className="text-rose-500 font-medium">
                        총 {totalDiscount.toLocaleString("ko-KR")}원 할인
                      </span>
                    </div>
                  </div>
                  <div className="divide-y divide-zinc-50 dark:divide-zinc-800/50">
                    {dayEntries.map((e, i) => {
                      const el = ELASTICITY_LABELS[e.elasticity] ?? ELASTICITY_LABELS.no_data;
                      const ElIcon = el.icon;
                      return (
                        <div key={`${e.sku}-${i}`} className="flex items-center justify-between px-4 py-2.5 text-sm">
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="text-zinc-400 font-mono text-xs w-5 text-right shrink-0">#{e.displayOrder}</span>
                            <span className="truncate text-zinc-700 dark:text-zinc-300 max-w-[200px]">{e.name}</span>
                          </div>
                          <div className="flex items-center gap-4 shrink-0">
                            <span className={`inline-flex items-center gap-1 text-xs ${el.color}`}>
                              <ElIcon size={11} />
                              {el.label}
                            </span>
                            <span className="text-zinc-400 text-xs">{formatPrice(e.prevPrice)}</span>
                            <span className="text-zinc-300">→</span>
                            <span className="font-medium text-zinc-800 dark:text-zinc-200 text-xs">
                              {e.newPrice !== e.prevPrice ? (
                                <span className="text-rose-600">{formatPrice(e.newPrice)}</span>
                              ) : (
                                formatPrice(e.newPrice)
                              )}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 text-center py-12">
              <Clock size={32} className="mx-auto mb-2 text-zinc-200 dark:text-zinc-700" />
              <p className="text-zinc-400">아직 변경 이력이 없습니다</p>
            </div>
          )}
        </div>
      )}

      {/* 알고리즘 설명 */}
      <div className="bg-zinc-50 dark:bg-zinc-800/30 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-5">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-3">알고리즘 동작 원리</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-zinc-500 dark:text-zinc-400">
          <div className="flex items-start gap-2">
            <TrendingUp size={14} className="text-emerald-500 mt-0.5 shrink-0" />
            <span><b className="text-zinc-600 dark:text-zinc-300">반응 좋음</b> — 가격 인하 후 판매 증가 → 현재가 유지 또는 1% 추가 할인</span>
          </div>
          <div className="flex items-start gap-2">
            <Minus size={14} className="text-yellow-500 mt-0.5 shrink-0" />
            <span><b className="text-zinc-600 dark:text-zinc-300">변화 없음</b> — 반응 없음 → 3~5% 공격적 할인</span>
          </div>
          <div className="flex items-start gap-2">
            <TrendingDown size={14} className="text-red-500 mt-0.5 shrink-0" />
            <span><b className="text-zinc-600 dark:text-zinc-300">반응 없음</b> — 가격 문제가 아님 → 1% 소폭 + 진열 위치 변경</span>
          </div>
          <div className="flex items-start gap-2">
            <Clock size={14} className="text-zinc-400 mt-0.5 shrink-0" />
            <span><b className="text-zinc-600 dark:text-zinc-300">데이터 수집중</b> — 첫 실행 → 탐색적 2% 할인</span>
          </div>
        </div>
        <p className="text-xs text-zinc-400 mt-3">
          하한가: 최초 판매가의 30% · 매일 오전 7시 자동 실행 · 90일간 이력 보관
        </p>
      </div>
    </div>
  );
}
