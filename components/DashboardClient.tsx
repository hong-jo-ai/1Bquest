"use client";

import { useState, useMemo } from "react";
import { LogIn, LogOut, AlertCircle, RefreshCw } from "lucide-react";

import ChannelTabs from "@/components/ChannelTabs";
import ChannelComparisonChart from "@/components/ChannelComparisonChart";
import SalesSummary from "@/components/SalesSummary";
import HourlyChart from "@/components/HourlyChart";
import WeeklyChart from "@/components/WeeklyChart";
import TopProducts from "@/components/TopProducts";
import InventoryStatus from "@/components/InventoryStatus";

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

interface Props {
  cafe24Data: DashboardData | null;
  isAuthenticated: boolean;
  apiError: string | null;
  now: string;
}

export default function DashboardClient({ cafe24Data, isAuthenticated, apiError, now }: Props) {
  const [activeChannel, setActiveChannel] = useState<ChannelId>("all");

  // 카페24 데이터를 MultiChannelData 형태로 변환
  const cafe24Channel: MultiChannelData = useMemo(() => ({
    salesSummary: cafe24Data?.salesSummary ?? dummySales,
    topProducts:  (cafe24Data?.topProducts?.length ?? 0) > 0 ? cafe24Data!.topProducts : dummyProducts,
    hourlyOrders: cafe24Data?.hourlyOrders ?? dummyHourly,
    weeklyRevenue: cafe24Data?.weeklyRevenue ?? dummyWeekly,
    inventory:    (cafe24Data?.inventory?.length ?? 0) > 0 ? cafe24Data!.inventory : dummyInventory,
  }), [cafe24Data]);

  // 선택한 채널에 따라 표시 데이터 결정
  const displayData: MultiChannelData = useMemo(() => {
    switch (activeChannel) {
      case "cafe24":   return cafe24Channel;
      case "wconcept": return wconceptDummy;
      case "musinsa":  return musinsaDummy;
      case "all":
      default:
        return mergeChannelData([cafe24Channel, wconceptDummy, musinsaDummy]);
    }
  }, [activeChannel, cafe24Channel]);

  const cafe24IsReal = cafe24Data?.isReal === true;
  const isSampleChannel = activeChannel === "wconcept" || activeChannel === "musinsa";

  // ChannelComparisonChart 에 넘길 3개 채널 고정 데이터
  const comparisonChannels = [
    { channelId: "cafe24",   name: "카페24", color: CHANNELS[1].color, data: cafe24Channel },
    { channelId: "wconcept", name: "W컨셉",  color: CHANNELS[2].color, data: wconceptDummy },
    { channelId: "musinsa",  name: "무신사", color: CHANNELS[3].color, data: musinsaDummy  },
  ];

  return (
    <>
      {/* API 오류 배너 */}
      {apiError && (
        <div className="max-w-7xl mx-auto px-6 pt-4">
          <div className="flex items-center gap-2 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-xl px-4 py-3 text-sm">
            <AlertCircle size={16} className="shrink-0" />
            카페24 API 오류: {apiError} — 더미 데이터를 표시합니다.
          </div>
        </div>
      )}

      {/* 미연결 배너 */}
      {!isAuthenticated && (
        <div className="max-w-7xl mx-auto px-6 pt-4">
          <div className="flex items-center justify-between bg-violet-50 dark:bg-violet-950/40 border border-violet-200 dark:border-violet-800 text-violet-700 dark:text-violet-300 rounded-xl px-4 py-3 text-sm">
            <span>카페24가 연결되지 않았습니다. 현재 더미 데이터를 표시 중입니다.</span>
            <a href="/api/auth/login" className="ml-4 shrink-0 font-semibold underline underline-offset-2 hover:opacity-70">
              지금 연결하기 →
            </a>
          </div>
        </div>
      )}

      {/* 샘플 데이터 배너 (W컨셉 / 무신사) */}
      {isSampleChannel && (
        <div className="max-w-7xl mx-auto px-6 pt-4">
          <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 rounded-xl px-4 py-3 text-sm">
            <AlertCircle size={16} className="shrink-0" />
            {activeChannel === "wconcept" ? "W컨셉" : "무신사"} 데이터는 현재 샘플 데이터입니다. 실데이터 연동은 준비 중입니다.
          </div>
        </div>
      )}

      {/* 메인 */}
      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">

        {/* 채널 탭 */}
        <div className="bg-zinc-100/70 dark:bg-zinc-800/50 rounded-2xl p-2">
          <ChannelTabs
            activeChannel={activeChannel}
            onChange={setActiveChannel}
            cafe24IsReal={cafe24IsReal}
          />
        </div>

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
            isReal={cafe24IsReal && !isSampleChannel}
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
      <footer className="max-w-7xl mx-auto px-6 py-6 text-center text-xs text-zinc-300 dark:text-zinc-600">
        PAULVICE Dashboard · 카페24 icaruse2000 · W컨셉 · 무신사 통합 현황
      </footer>
    </>
  );
}
