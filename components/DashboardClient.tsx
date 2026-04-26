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
import ProfitDashboard, { type ProfitChannel } from "@/components/ProfitDashboard";
import ExcelUploadPanel from "@/components/ExcelUploadPanel";

import {
  UPLOADABLE_CHANNELS,
  UPLOADABLE_DUMMIES,
  mergeChannelData,
  CHANNELS,
  BRANDS,
  BRAND_CHANNELS,
  type ChannelId,
  type MultiChannelData,
  type UploadableChannel,
  type Brand,
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
const LS_KEY: Record<UploadableChannel, { data: string; meta: string }> = {
  wconcept:         { data: "wconcept_excel_data",         meta: "wconcept_excel_meta"         },
  musinsa:          { data: "musinsa_excel_data",          meta: "musinsa_excel_meta"          },
  "29cm":           { data: "29cm_excel_data",             meta: "29cm_excel_meta"             },
  groupbuy:         { data: "groupbuy_excel_data",         meta: "groupbuy_excel_meta"         },
  sixshop:          { data: "sixshop_excel_data",          meta: "sixshop_excel_meta"          },
  naver_smartstore: { data: "naver_smartstore_excel_data", meta: "naver_smartstore_excel_meta" },
  sixshop_global:   { data: "sixshop_global_excel_data",   meta: "sixshop_global_excel_meta"   },
};

interface UploadMeta {
  fileName: string;
  rowCount: number;
  period: { start: string; end: string };
  uploadedAt: string;
}

type ChannelUploads = Record<UploadableChannel, MultiChannelData | null>;
type ChannelMetas = Record<UploadableChannel, UploadMeta | null>;
const EMPTY_UPLOADS: ChannelUploads = {
  wconcept: null, musinsa: null, "29cm": null, groupbuy: null,
  sixshop: null, naver_smartstore: null, sixshop_global: null,
};
const EMPTY_METAS: ChannelMetas = {
  wconcept: null, musinsa: null, "29cm": null, groupbuy: null,
  sixshop: null, naver_smartstore: null, sixshop_global: null,
};

// ── Props ─────────────────────────────────────────────────────────────────
interface Props {
  brand: Brand;
  cafe24Data: DashboardData | null;
  isAuthenticated: boolean;
  apiError: string | null;
  now: string;
}

export default function DashboardClient({ brand, cafe24Data, isAuthenticated, apiError, now }: Props) {
  const [activeChannel, setActiveChannel] = useState<ChannelId>("all");
  const [showUpload, setShowUpload]       = useState(false);

  // 브랜드 변경 시 채널 선택 초기화
  useEffect(() => {
    setActiveChannel("all");
    setShowUpload(false);
  }, [brand]);

  // 현재 브랜드의 채널 ID 목록
  const brandChannelIds = BRAND_CHANNELS[brand];

  // 업로드된 데이터 상태 (4개 채널 통합 관리)
  const [uploads, setUploads] = useState<ChannelUploads>(EMPTY_UPLOADS);
  const [metas, setMetas]     = useState<ChannelMetas>(EMPTY_METAS);

  // localStorage에서 복원
  useEffect(() => {
    try {
      const restoredUploads: Partial<ChannelUploads> = {};
      const restoredMetas: Partial<ChannelMetas> = {};
      for (const ch of UPLOADABLE_CHANNELS) {
        const d = localStorage.getItem(LS_KEY[ch].data);
        const m = localStorage.getItem(LS_KEY[ch].meta);
        if (d && m) {
          restoredUploads[ch] = JSON.parse(d);
          restoredMetas[ch] = JSON.parse(m);
        }
      }
      setUploads((prev) => ({ ...prev, ...restoredUploads }));
      setMetas((prev) => ({ ...prev, ...restoredMetas }));
    } catch { /* localStorage 접근 불가 시 무시 */ }
  }, []);

  // 업로드 데이터 저장
  const handleDataLoaded = useCallback(
    (ch: UploadableChannel) => (data: MultiChannelData, meta: UploadMeta) => {
      try {
        localStorage.setItem(LS_KEY[ch].data, JSON.stringify(data));
        localStorage.setItem(LS_KEY[ch].meta, JSON.stringify(meta));
      } catch { /* 용량 초과 등 무시 */ }
      setUploads((prev) => ({ ...prev, [ch]: data }));
      setMetas((prev) => ({ ...prev, [ch]: meta }));
      setShowUpload(false);
    },
    []
  );

  // 업로드 데이터 삭제
  const handleClear = useCallback(
    (ch: UploadableChannel) => () => {
      localStorage.removeItem(LS_KEY[ch].data);
      localStorage.removeItem(LS_KEY[ch].meta);
      setUploads((prev) => ({ ...prev, [ch]: null }));
      setMetas((prev) => ({ ...prev, [ch]: null }));
    },
    []
  );

  // 카페24 데이터를 MultiChannelData 형태로 변환
  const cafe24Channel: MultiChannelData = useMemo(() => ({
    salesSummary: cafe24Data?.salesSummary ?? dummySales,
    topProducts:  (cafe24Data?.topProducts?.length ?? 0) > 0 ? cafe24Data!.topProducts : dummyProducts,
    hourlyOrders: cafe24Data?.hourlyOrders ?? dummyHourly,
    weeklyRevenue: cafe24Data?.weeklyRevenue ?? dummyWeekly,
    dailyRevenue: cafe24Data?.dailyRevenue ?? [],
    dailyCogs:    cafe24Data?.dailyCogs ?? [],
    inventory:    (cafe24Data?.inventory?.length ?? 0) > 0 ? cafe24Data!.inventory : dummyInventory,
  }), [cafe24Data]);

  // 실제 표시 데이터 (업로드 > 더미)
  const channelDataMap = useMemo<Record<UploadableChannel, MultiChannelData>>(() => ({
    wconcept:         uploads.wconcept         ?? UPLOADABLE_DUMMIES.wconcept,
    musinsa:          uploads.musinsa          ?? UPLOADABLE_DUMMIES.musinsa,
    "29cm":           uploads["29cm"]          ?? UPLOADABLE_DUMMIES["29cm"],
    groupbuy:         uploads.groupbuy         ?? UPLOADABLE_DUMMIES.groupbuy,
    sixshop:          uploads.sixshop          ?? UPLOADABLE_DUMMIES.sixshop,
    naver_smartstore: uploads.naver_smartstore ?? UPLOADABLE_DUMMIES.naver_smartstore,
    sixshop_global:   uploads.sixshop_global   ?? UPLOADABLE_DUMMIES.sixshop_global,
  }), [uploads]);

  const displayData: MultiChannelData = useMemo(() => {
    if (activeChannel === "cafe24") return cafe24Channel;
    if (activeChannel === "all") {
      // 현재 브랜드의 채널만 합산
      const list: MultiChannelData[] = [];
      for (const id of brandChannelIds) {
        if (id === "all") continue;
        if (id === "cafe24") list.push(cafe24Channel);
        else list.push(channelDataMap[id as UploadableChannel]);
      }
      return mergeChannelData(list);
    }
    // 업로드 가능 채널
    return channelDataMap[activeChannel as UploadableChannel];
  }, [activeChannel, cafe24Channel, channelDataMap, brandChannelIds]);

  const cafe24IsReal       = cafe24Data?.isReal === true;
  const isUploadableActive = UPLOADABLE_CHANNELS.includes(activeChannel as UploadableChannel);
  const activeUploadable   = isUploadableActive ? (activeChannel as UploadableChannel) : null;
  const activeHasUpload    = activeUploadable ? !!uploads[activeUploadable] : false;
  const activeMeta         = activeUploadable ? metas[activeUploadable] : null;
  const activeChannelMeta  = CHANNELS.find(c => c.id === activeChannel);

  // ChannelComparisonChart에 넘길 채널 데이터 (브랜드 채널만)
  const comparisonChannels = useMemo(() => {
    const list: { channelId: string; name: string; color: string; data: MultiChannelData }[] = [];
    for (const id of brandChannelIds) {
      if (id === "all") continue;
      const meta = CHANNELS.find(c => c.id === id);
      if (!meta) continue;
      const data = id === "cafe24" ? cafe24Channel : channelDataMap[id as UploadableChannel];
      list.push({ channelId: id, name: meta.name, color: meta.color, data });
    }
    return list;
  }, [cafe24Channel, channelDataMap, brandChannelIds]);

  return (
    <>
      {/* API 오류 배너 (폴바이스 카페24만) */}
      {apiError && brand === "paulvice" && (
        <div className="max-w-7xl mx-auto px-3 sm:px-6 pt-4">
          <div className="flex items-center gap-2 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-xl px-4 py-3 text-sm">
            <AlertCircle size={16} className="shrink-0" />
            카페24 API 오류: {apiError} — 더미 데이터를 표시합니다.
          </div>
        </div>
      )}

      {/* 미연결 배너 (폴바이스만) */}
      {!isAuthenticated && brand === "paulvice" && (
        <div className="max-w-7xl mx-auto px-3 sm:px-6 pt-4">
          <div className="flex items-center justify-between bg-violet-50 dark:bg-violet-950/40 border border-violet-200 dark:border-violet-800 text-violet-700 dark:text-violet-300 rounded-xl px-4 py-3 text-sm">
            <span>카페24가 연결되지 않았습니다. 현재 더미 데이터를 표시 중입니다.</span>
            <a href="/api/auth/login" className="ml-4 shrink-0 font-semibold underline underline-offset-2 hover:opacity-70">
              지금 연결하기 →
            </a>
          </div>
        </div>
      )}

      {/* 업로드 가능 채널 배너 */}
      {isUploadableActive && activeChannelMeta && (
        <div className="max-w-7xl mx-auto px-3 sm:px-6 pt-4">
          {activeHasUpload ? (
            /* 실 데이터 사용 중 */
            <div className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 rounded-xl px-4 py-3 text-sm">
              <AlertCircle size={16} className="shrink-0" />
              <span className="flex-1">
                {activeChannelMeta.name} 실 데이터 사용 중 —{" "}
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
            /* 데이터 없음 — 업로드 유도 */
            <div className="flex items-center justify-between bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 rounded-xl px-4 py-3 text-sm">
              <div className="flex items-center gap-2">
                <AlertCircle size={16} className="shrink-0" />
                <span>{activeChannelMeta.name} 데이터가 없습니다 — 엑셀을 업로드해 매출을 확인하세요.</span>
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

        {/* 브랜드 스위처 */}
        <BrandSwitcher current={brand} />

        {/* 채널 탭 */}
        <div className="bg-zinc-100/70 dark:bg-zinc-800/50 rounded-2xl p-2">
          <ChannelTabs
            activeChannel={activeChannel}
            onChange={ch => { setActiveChannel(ch); setShowUpload(false); }}
            cafe24IsReal={cafe24IsReal}
            visibleChannels={brandChannelIds}
            uploadStatus={{
              wconcept: !!uploads.wconcept,
              musinsa:  !!uploads.musinsa,
              "29cm":   !!uploads["29cm"],
              groupbuy: !!uploads.groupbuy,
              sixshop:  !!uploads.sixshop,
              naver_smartstore: !!uploads.naver_smartstore,
              sixshop_global:   !!uploads.sixshop_global,
            }}
          />
        </div>

        {/* 엑셀 업로드 패널 (업로드 가능 채널) */}
        {isUploadableActive && showUpload && activeChannelMeta && activeUploadable && (
          <ExcelUploadPanel
            channel={activeUploadable}
            channelName={activeChannelMeta.name}
            channelColor={activeChannelMeta.color}
            onDataLoaded={handleDataLoaded(activeUploadable)}
            onClear={handleClear(activeUploadable)}
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
              !isUploadableActive && cafe24IsReal
                ? (cafe24Data?.topProductsToday ?? displayData.topProducts)
                : displayData.topProducts
            }
            week={
              !isUploadableActive && cafe24IsReal
                ? (cafe24Data?.topProductsWeek ?? displayData.topProducts)
                : displayData.topProducts
            }
            month={displayData.topProducts}
            isReal={cafe24IsReal && !isUploadableActive || activeHasUpload}
          />
        </div>

        {/* 손익 분석 (P&L) — 매출, 수수료, 부가세, 매입원가, 고정비 → 영업이익 */}
        <ProfitDashboard
          channels={
            comparisonChannels.map<ProfitChannel>((c) => ({
              id: c.channelId,
              name: c.name,
              color: c.color,
              daily: c.data.dailyRevenue ?? [],
              cogs: c.data.dailyCogs ?? [],
            }))
          }
          unmatchedSkus={cafe24Data?.unmatchedSkus ?? []}
        />
      </main>

      {/* 푸터 */}
      <footer className="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-6 text-center text-xs text-zinc-300 dark:text-zinc-600">
        Harriot Watches · 멀티 브랜드 통합 현황
      </footer>
    </>
  );
}

// ────────────────────────────────────────────────────────────────────
// 브랜드 스위처
// ────────────────────────────────────────────────────────────────────
function BrandSwitcher({ current }: { current: Brand }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mr-1">
        브랜드
      </span>
      <div className="inline-flex items-center bg-zinc-100 dark:bg-zinc-800 rounded-full p-1">
        {BRANDS.map((b) => {
          const active = current === b.id;
          return (
            <a
              key={b.id}
              href={`/?brand=${b.id}`}
              className={`px-4 sm:px-5 h-9 inline-flex items-center gap-2 rounded-full text-sm font-semibold transition ${
                active
                  ? `text-white bg-gradient-to-br ${b.gradient} shadow-sm`
                  : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/50 dark:hover:bg-zinc-700/50"
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  active ? "bg-white" : "opacity-50"
                }`}
                style={!active ? { backgroundColor: b.accent } : undefined}
              />
              {b.name}
            </a>
          );
        })}
      </div>
    </div>
  );
}
