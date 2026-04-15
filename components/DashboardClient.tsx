"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { AlertCircle, UploadCloud } from "lucide-react";

import ChannelTabs from "@/components/ChannelTabs";
import ChannelComparisonChart from "@/components/ChannelComparisonChart";
import SalesSummary from "@/components/SalesSummary";
import HourlyChart from "@/components/HourlyChart";
import WeeklyChart from "@/components/WeeklyChart";
import TopProducts from "@/components/TopProducts";
import InventoryStatus from "@/components/InventoryStatus";
import ExcelUploadPanel from "@/components/ExcelUploadPanel";

import {
  wconceptDummy,
  musinsaDummy,
  mergeChannelData,
  CHANNELS,
  type ChannelId,
  type MultiChannelData,
} from "@/lib/multiChannelData";
import {
  salesSummary as dummySales,
  topProducts as dummyProducts,
  hourlyOrders as dummyHourly,
  weeklyRevenue as dummyWeekly,
  inventory as dummyInventory,
} from "@/lib/dummyData";
import type { DashboardData } from "@/lib/cafe24Data";

// ── localStorage 키 ────────────────────────────────────────────────────────
const LS_KEY = {
  wconcept: { data: "wconcept_excel_data", meta: "wconcept_excel_meta" },
  musinsa:  { data: "musinsa_excel_data",  meta: "musinsa_excel_meta"  },
} as const;

interface UploadMeta {
  fileName: string;
  rowCount: number;
  period: { start: string; end: string };
  uploadedAt: string;
}

// ── Props ─────────────────────────────────────────────────────────────────
interface Props {
  cafe24Data: DashboardData | null;
  isAuthenticated: boolean;
  apiError: string | null;
  now: string;
}

export default function DashboardClient({ cafe24Data, isAuthenticated, apiError, now }: Props) {
  const [activeChannel, setActiveChannel] = useState<ChannelId>("all");
  const [showUpload, setShowUpload]       = useState(false);

  // 업로드된 데이터 상태
  const [wconceptUpload, setWconceptUpload] = useState<MultiChannelData | null>(null);
  const [wconceptMeta,   setWconceptMeta]   = useState<UploadMeta | null>(null);
  const [musinsaUpload,  setMusinsaUpload]  = useState<MultiChannelData | null>(null);
  const [musinsaMeta,    setMusinsaMeta]    = useState<UploadMeta | null>(null);

  // localStorage에서 복원
  useEffect(() => {
    try {
      const wd = localStorage.getItem(LS_KEY.wconcept.data);
      const wm = localStorage.getItem(LS_KEY.wconcept.meta);
      if (wd && wm) { setWconceptUpload(JSON.parse(wd)); setWconceptMeta(JSON.parse(wm)); }

      const md = localStorage.getItem(LS_KEY.musinsa.data);
      const mm = localStorage.getItem(LS_KEY.musinsa.meta);
      if (md && mm) { setMusinsaUpload(JSON.parse(md)); setMusinsaMeta(JSON.parse(mm)); }
    } catch { /* localStorage 접근 불가 시 무시 */ }
  }, []);

  // 업로드 데이터 저장
  const handleDataLoaded = useCallback((ch: "wconcept" | "musinsa") => (data: MultiChannelData, meta: UploadMeta) => {
    try {
      localStorage.setItem(LS_KEY[ch].data, JSON.stringify(data));
      localStorage.setItem(LS_KEY[ch].meta, JSON.stringify(meta));
    } catch { /* 용량 초과 등 무시 */ }
    if (ch === "wconcept") { setWconceptUpload(data); setWconceptMeta(meta); }
    else                   { setMusinsaUpload(data);  setMusinsaMeta(meta);  }
    setShowUpload(false);
  }, []);

  // 업로드 데이터 삭제
  const handleClear = useCallback((ch: "wconcept" | "musinsa") => () => {
    localStorage.removeItem(LS_KEY[ch].data);
    localStorage.removeItem(LS_KEY[ch].meta);
    if (ch === "wconcept") { setWconceptUpload(null); setWconceptMeta(null); }
    else                   { setMusinsaUpload(null);  setMusinsaMeta(null);  }
  }, []);

  // 카페24 데이터를 MultiChannelData 형태로 변환
  const cafe24Channel: MultiChannelData = useMemo(() => ({
    salesSummary: cafe24Data?.salesSummary ?? dummySales,
    topProducts:  (cafe24Data?.topProducts?.length ?? 0) > 0 ? cafe24Data!.topProducts : dummyProducts,
    hourlyOrders: cafe24Data?.hourlyOrders ?? dummyHourly,
    weeklyRevenue: cafe24Data?.weeklyRevenue ?? dummyWeekly,
    inventory:    (cafe24Data?.inventory?.length ?? 0) > 0 ? cafe24Data!.inventory : dummyInventory,
  }), [cafe24Data]);

  // 실제 표시 데이터 (업로드 > 더미)
  const wconceptData = wconceptUpload ?? wconceptDummy;
  const musinsaData  = musinsaUpload  ?? musinsaDummy;

  const displayData: MultiChannelData = useMemo(() => {
    switch (activeChannel) {
      case "cafe24":   return cafe24Channel;
      case "wconcept": return wconceptData;
      case "musinsa":  return musinsaData;
      case "all":
      default:         return mergeChannelData([cafe24Channel, wconceptData, musinsaData]);
    }
  }, [activeChannel, cafe24Channel, wconceptData, musinsaData]);

  const cafe24IsReal     = cafe24Data?.isReal === true;
  const activeIsWconcept = activeChannel === "wconcept";
  const activeIsMusinsa  = activeChannel === "musinsa";
  const isSampleChannel  = activeIsWconcept || activeIsMusinsa;

  const activeHasUpload  = activeIsWconcept ? !!wconceptUpload : activeIsMusinsa ? !!musinsaUpload : false;
  const activeMeta       = activeIsWconcept ? wconceptMeta     : activeIsMusinsa ? musinsaMeta     : null;
  const activeChannelMeta = CHANNELS.find(c => c.id === activeChannel);

  // ChannelComparisonChart 에 넘길 3개 채널 고정 데이터
  const comparisonChannels = [
    { channelId: "cafe24",   name: "카페24", color: CHANNELS[1].color, data: cafe24Channel },
    { channelId: "wconcept", name: "W컨셉",  color: CHANNELS[2].color, data: wconceptData  },
    { channelId: "musinsa",  name: "무신사", color: CHANNELS[3].color, data: musinsaData   },
  ];

  return (
    <>
      {/* API 오류 배너 */}
      {apiError && (
        <div className="max-w-7xl mx-auto px-3 sm:px-6 pt-4">
          <div className="flex items-center gap-2 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-xl px-4 py-3 text-sm">
            <AlertCircle size={16} className="shrink-0" />
            카페24 API 오류: {apiError} — 더미 데이터를 표시합니다.
          </div>
        </div>
      )}

      {/* 미연결 배너 */}
      {!isAuthenticated && (
        <div className="max-w-7xl mx-auto px-3 sm:px-6 pt-4">
          <div className="flex items-center justify-between bg-violet-50 dark:bg-violet-950/40 border border-violet-200 dark:border-violet-800 text-violet-700 dark:text-violet-300 rounded-xl px-4 py-3 text-sm">
            <span>카페24가 연결되지 않았습니다. 현재 더미 데이터를 표시 중입니다.</span>
            <a href="/api/auth/login" className="ml-4 shrink-0 font-semibold underline underline-offset-2 hover:opacity-70">
              지금 연결하기 →
            </a>
          </div>
        </div>
      )}

      {/* W컨셉 / 무신사 배너 */}
      {isSampleChannel && (
        <div className="max-w-7xl mx-auto px-3 sm:px-6 pt-4">
          {activeHasUpload ? (
            /* 실 데이터 사용 중 */
            <div className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 rounded-xl px-4 py-3 text-sm">
              <AlertCircle size={16} className="shrink-0" />
              <span className="flex-1">
                {activeIsWconcept ? "W컨셉" : "무신사"} 실 데이터 사용 중 —{" "}
                {activeMeta?.fileName} ({activeMeta?.period.start} ~ {activeMeta?.period.end})
              </span>
              <button
                onClick={() => setShowUpload(v => !v)}
                className="shrink-0 underline font-medium hover:opacity-70"
              >
                {showUpload ? "닫기" : "재업로드"}
              </button>
            </div>
          ) : (
            /* 샘플 데이터 */
            <div className="flex items-center justify-between bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 rounded-xl px-4 py-3 text-sm">
              <div className="flex items-center gap-2">
                <AlertCircle size={16} className="shrink-0" />
                <span>{activeIsWconcept ? "W컨셉" : "무신사"} 샘플 데이터 표시 중 — 엑셀을 업로드해 실 데이터를 볼 수 있습니다.</span>
              </div>
              <button
                onClick={() => setShowUpload(v => !v)}
                className="shrink-0 ml-4 flex items-center gap-1 font-semibold underline underline-offset-2 hover:opacity-70"
              >
                <UploadCloud size={14} />
                {showUpload ? "닫기" : "엑셀 업로드"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* 메인 */}
      <main className="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6">

        {/* 채널 탭 */}
        <div className="bg-zinc-100/70 dark:bg-zinc-800/50 rounded-2xl p-2">
          <ChannelTabs
            activeChannel={activeChannel}
            onChange={ch => { setActiveChannel(ch); setShowUpload(false); }}
            cafe24IsReal={cafe24IsReal}
            wconceptHasUpload={!!wconceptUpload}
            musinsaHasUpload={!!musinsaUpload}
          />
        </div>

        {/* 엑셀 업로드 패널 (W컨셉/무신사만) */}
        {isSampleChannel && showUpload && activeChannelMeta && (
          <ExcelUploadPanel
            channel={activeChannel as "wconcept" | "musinsa"}
            channelName={activeChannelMeta.name}
            channelColor={activeChannelMeta.color}
            onDataLoaded={handleDataLoaded(activeChannel as "wconcept" | "musinsa")}
            onClear={handleClear(activeChannel as "wconcept" | "musinsa")}
            currentMeta={activeMeta}
          />
        )}

        {/* 매출 요약 */}
        <SalesSummary data={displayData.salesSummary} />

        {/* 채널 비교 + 주문 차트 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ChannelComparisonChart channels={comparisonChannels} />
          <HourlyChart data={displayData.hourlyOrders} />
        </div>

        {/* 주간 매출 + 상품 순위 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <WeeklyChart data={displayData.weeklyRevenue} />
          <TopProducts
            today={
              !isSampleChannel && cafe24IsReal
                ? (cafe24Data?.topProductsToday ?? displayData.topProducts)
                : displayData.topProducts
            }
            week={
              !isSampleChannel && cafe24IsReal
                ? (cafe24Data?.topProductsWeek ?? displayData.topProducts)
                : displayData.topProducts
            }
            month={displayData.topProducts}
            isReal={cafe24IsReal && !isSampleChannel || activeHasUpload}
          />
        </div>

        {/* 재고 현황 (전체 or 카페24만 표시) */}
        {(activeChannel === "all" || activeChannel === "cafe24") && (
          <InventoryStatus items={displayData.inventory} />
        )}
        {isSampleChannel && (
          <div className="bg-zinc-50 dark:bg-zinc-800/50 border border-dashed border-zinc-200 dark:border-zinc-700 rounded-2xl p-8 text-center text-zinc-400 text-sm">
            재고 현황은 카페24 연동 데이터만 표시됩니다
          </div>
        )}
      </main>

      {/* 푸터 */}
      <footer className="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-6 text-center text-xs text-zinc-300 dark:text-zinc-600">
        Harriot Watches · 멀티 브랜드 통합 현황
      </footer>
    </>
  );
}
