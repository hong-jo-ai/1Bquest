"use client";

import { useState, useMemo, useEffect, useCallback, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  UploadCloud,
  ChevronDown,
  ChevronUp,
  BarChart3,
  CheckCircle2,
  Database,
  Layers3,
  RefreshCw,
} from "lucide-react";

import ChannelTabs from "@/components/ChannelTabs";
import ChannelComparisonChart from "@/components/ChannelComparisonChart";
import DashboardAdsKpi from "@/components/DashboardAdsKpi";
import SalesSummary from "@/components/SalesSummary";
import TopProducts from "@/components/TopProducts";
import ProfitDashboard, { type ProfitChannel } from "@/components/ProfitDashboard";
import ExcelUploadPanel from "@/components/ExcelUploadPanel";
import KakaoGiftSyncPanel from "@/components/KakaoGiftSyncPanel";
import TodayHubSection from "@/app/_components/today-hub/TodayHubSection";
import CrmSection from "@/components/dashboard/CrmSection";
import ReviewSection from "@/components/dashboard/ReviewSection";
import CreativeSection from "@/components/dashboard/CreativeSection";
import CampaignTracker from "@/components/CampaignTracker";

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
import type { DashboardData } from "@/lib/cafe24Data";

// ── localStorage 키 ────────────────────────────────────────────────────────
// 데이터/메타에 더해 업로드 이력(history)도 캐시 — 누적 파일 목록 표시용.
const LS_KEY: Record<UploadableChannel, { data: string; meta: string; history: string }> = {
  wconcept:         { data: "wconcept_excel_data",         meta: "wconcept_excel_meta",         history: "wconcept_excel_history"         },
  musinsa:          { data: "musinsa_excel_data",          meta: "musinsa_excel_meta",          history: "musinsa_excel_history"          },
  "29cm":           { data: "29cm_excel_data",             meta: "29cm_excel_meta",             history: "29cm_excel_history"             },
  groupbuy:         { data: "groupbuy_excel_data",         meta: "groupbuy_excel_meta",         history: "groupbuy_excel_history"         },
  kakao_gift:       { data: "kakao_gift_excel_data",       meta: "kakao_gift_excel_meta",       history: "kakao_gift_excel_history"       },
  lotte_dutyfree:     { data: "lotte_dutyfree_excel_data",     meta: "lotte_dutyfree_excel_meta",     history: "lotte_dutyfree_excel_history"     },
  shinsegae_dutyfree: { data: "shinsegae_dutyfree_excel_data", meta: "shinsegae_dutyfree_excel_meta", history: "shinsegae_dutyfree_excel_history" },
  naver_smartstore: { data: "naver_smartstore_excel_data", meta: "naver_smartstore_excel_meta", history: "naver_smartstore_excel_history" },
  chosunmall:       { data: "chosunmall_excel_data",       meta: "chosunmall_excel_meta",       history: "chosunmall_excel_history"       },
  direct_paulvice:  { data: "direct_paulvice_data",        meta: "direct_paulvice_meta",        history: "direct_paulvice_history"        },
  direct_harriot:   { data: "direct_harriot_data",         meta: "direct_harriot_meta",         history: "direct_harriot_history"         },
  b2b_harriot:      { data: "b2b_harriot_data",            meta: "b2b_harriot_meta",            history: "b2b_harriot_history"            },
};

interface UploadMeta {
  fileName: string;
  rowCount: number;
  period: { start: string; end: string };
  uploadedAt: string;
}

type ChannelUploads  = Record<UploadableChannel, MultiChannelData | null>;
type ChannelMetas    = Record<UploadableChannel, UploadMeta | null>;
type ChannelHistories = Record<UploadableChannel, UploadMeta[]>;
const EMPTY_UPLOADS: ChannelUploads = {
  wconcept: null, musinsa: null, "29cm": null, groupbuy: null, kakao_gift: null,
  lotte_dutyfree: null, shinsegae_dutyfree: null,
  naver_smartstore: null, chosunmall: null, direct_paulvice: null, direct_harriot: null, b2b_harriot: null,
};
const EMPTY_METAS: ChannelMetas = {
  wconcept: null, musinsa: null, "29cm": null, groupbuy: null, kakao_gift: null,
  lotte_dutyfree: null, shinsegae_dutyfree: null,
  naver_smartstore: null, chosunmall: null, direct_paulvice: null, direct_harriot: null, b2b_harriot: null,
};
const EMPTY_HISTORIES: ChannelHistories = {
  wconcept: [], musinsa: [], "29cm": [], groupbuy: [], kakao_gift: [],
  lotte_dutyfree: [], shinsegae_dutyfree: [],
  naver_smartstore: [], chosunmall: [], direct_paulvice: [], direct_harriot: [], b2b_harriot: [],
};
const EMPTY_PERIOD = { revenue: 0, orders: 0, avgOrder: 0 };
const EMPTY_CHANNEL_DATA: MultiChannelData = {
  salesSummary: {
    today: EMPTY_PERIOD,
    week: EMPTY_PERIOD,
    month: EMPTY_PERIOD,
    prevMonth: EMPTY_PERIOD,
  },
  topProducts: [],
  hourlyOrders: Array.from({ length: 24 }, (_, h) => ({
    hour: `${String(h).padStart(2, "0")}시`,
    orders: 0,
    revenue: 0,
  })),
  weeklyRevenue: ["월", "화", "수", "목", "금", "토", "일"].map((day) => ({
    day,
    revenue: 0,
    orders: 0,
  })),
  dailyRevenue: [],
  dailyCogs: [],
  inventory: [],
};
const PULL_REFRESH_TRIGGER = 82;
const PULL_REFRESH_MAX = 116;

function fmtKrwCompact(n: number): string {
  const rounded = Math.round(n);
  if (rounded >= 100_000_000) return `${(rounded / 100_000_000).toFixed(1)}억`;
  if (rounded >= 10_000) return `${Math.round(rounded / 10_000).toLocaleString("ko-KR")}만`;
  return rounded.toLocaleString("ko-KR");
}

// ── Props ─────────────────────────────────────────────────────────────────
interface Props {
  brand: Brand;
  cafe24Data: DashboardData | null;
  harriotCafe24Data?: DashboardData | null;
  harriotGlobalCafe24Data?: MultiChannelData | null;
  paulviceGlobalCafe24Data?: MultiChannelData | null;
  isAuthenticated: boolean;
  apiError: string | null;
  now: string;
}

export default function DashboardClient({ brand, cafe24Data, harriotCafe24Data = null, harriotGlobalCafe24Data = null, paulviceGlobalCafe24Data = null, isAuthenticated, apiError, now }: Props) {
  const router = useRouter();
  const [activeChannel, setActiveChannel] = useState<ChannelId>("all");
  const [showUpload, setShowUpload]       = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [pulling, setPulling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [, startRefreshTransition] = useTransition();
  const touchStartYRef = useRef(0);
  const pullActiveRef = useRef(false);
  const pullDistanceRef = useRef(0);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 현재 브랜드의 채널 ID 목록
  const brandChannelIds = BRAND_CHANNELS[brand];

  // 업로드된 데이터 상태 (8개 채널 통합 관리). data/meta 는 누적 머지 결과.
  const [uploads, setUploads]     = useState<ChannelUploads>(EMPTY_UPLOADS);
  const [metas, setMetas]         = useState<ChannelMetas>(EMPTY_METAS);
  const [histories, setHistories] = useState<ChannelHistories>(EMPTY_HISTORIES);

  // 서버 응답을 state + localStorage 양쪽에 반영하는 헬퍼
  const applyChannelEntry = useCallback(
    (ch: UploadableChannel, entry: { data: MultiChannelData; meta: UploadMeta; history?: UploadMeta[] } | null) => {
      if (entry) {
        setUploads((prev) => ({ ...prev, [ch]: entry.data }));
        setMetas((prev) => ({ ...prev, [ch]: entry.meta }));
        setHistories((prev) => ({ ...prev, [ch]: entry.history ?? [] }));
        try {
          localStorage.setItem(LS_KEY[ch].data, JSON.stringify(entry.data));
          localStorage.setItem(LS_KEY[ch].meta, JSON.stringify(entry.meta));
          localStorage.setItem(LS_KEY[ch].history, JSON.stringify(entry.history ?? []));
        } catch { /* 용량 초과 등 무시 */ }
      } else {
        setUploads((prev) => ({ ...prev, [ch]: null }));
        setMetas((prev) => ({ ...prev, [ch]: null }));
        setHistories((prev) => ({ ...prev, [ch]: [] }));
        try {
          localStorage.removeItem(LS_KEY[ch].data);
          localStorage.removeItem(LS_KEY[ch].meta);
          localStorage.removeItem(LS_KEY[ch].history);
        } catch { /* ignore */ }
      }
    },
    []
  );

  const syncChannelUploads = useCallback(async () => {
    try {
      const r = await fetch("/api/profit/channel-uploads", { cache: "no-store" });
      const j = await r.json();
      if (!j.ok) return;
      for (const ch of UPLOADABLE_CHANNELS) {
        const entry = j.uploads?.[ch];
        if (entry?.data && entry?.meta) {
          applyChannelEntry(ch, entry);
        }
      }
    } catch {
      /* 서버 fetch 실패 시 로컬 캐시만 사용 */
    }
  }, [applyChannelEntry]);

  const refreshDashboard = useCallback(async () => {
    if (refreshing) return;

    setRefreshing(true);
    setPulling(false);
    pullDistanceRef.current = PULL_REFRESH_TRIGGER;
    setPullDistance(PULL_REFRESH_TRIGGER);

    await syncChannelUploads();
    startRefreshTransition(() => {
      router.refresh();
    });

    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      setRefreshing(false);
      pullDistanceRef.current = 0;
      setPullDistance(0);
      refreshTimerRef.current = null;
    }, 700);
  }, [refreshing, router, syncChannelUploads, startRefreshTransition]);

  // 1) localStorage에서 즉시 복원 (서버 응답 전 빠른 표시)
  // 2) 서버 동기화 (다른 기기에서 업로드한 데이터 가져오기 — SSOT)
  useEffect(() => {
    // 1단계: 로컬 캐시
    try {
      const restoredUploads: Partial<ChannelUploads> = {};
      const restoredMetas: Partial<ChannelMetas> = {};
      const restoredHistories: Partial<ChannelHistories> = {};
      for (const ch of UPLOADABLE_CHANNELS) {
        const d = localStorage.getItem(LS_KEY[ch].data);
        const m = localStorage.getItem(LS_KEY[ch].meta);
        const h = localStorage.getItem(LS_KEY[ch].history);
        if (d && m) {
          restoredUploads[ch] = JSON.parse(d);
          restoredMetas[ch] = JSON.parse(m);
          restoredHistories[ch] = h ? JSON.parse(h) : [JSON.parse(m)];
        }
      }
      queueMicrotask(() => {
        setUploads((prev) => ({ ...prev, ...restoredUploads }));
        setMetas((prev) => ({ ...prev, ...restoredMetas }));
        setHistories((prev) => ({ ...prev, ...restoredHistories }));
      });
    } catch { /* localStorage 접근 불가 시 무시 */ }

    queueMicrotask(() => {
      void syncChannelUploads();
    });
  }, [syncChannelUploads]);

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, []);

  const handleTouchStart = useCallback((event: React.TouchEvent) => {
    if (refreshing || window.scrollY > 0 || document.documentElement.scrollTop > 0) return;

    touchStartYRef.current = event.touches[0]?.clientY ?? 0;
    pullActiveRef.current = true;
  }, [refreshing]);

  const handleTouchMove = useCallback((event: React.TouchEvent) => {
    if (!pullActiveRef.current || refreshing) return;
    if (window.scrollY > 0 || document.documentElement.scrollTop > 0) {
      pullActiveRef.current = false;
      setPulling(false);
      pullDistanceRef.current = 0;
      setPullDistance(0);
      return;
    }

    const currentY = event.touches[0]?.clientY ?? 0;
    const delta = currentY - touchStartYRef.current;
    if (delta <= 0) {
      pullDistanceRef.current = 0;
      setPullDistance(0);
      setPulling(false);
      return;
    }

    event.preventDefault();
    const nextPullDistance = Math.min(PULL_REFRESH_MAX, delta * 0.56);
    pullDistanceRef.current = nextPullDistance;
    setPulling(true);
    setPullDistance(nextPullDistance);
  }, [refreshing]);

  const handleTouchEnd = useCallback(() => {
    if (!pullActiveRef.current) return;

    pullActiveRef.current = false;
    setPulling(false);

    if (pullDistanceRef.current >= PULL_REFRESH_TRIGGER) {
      void refreshDashboard();
    } else {
      pullDistanceRef.current = 0;
      setPullDistance(0);
    }
  }, [refreshDashboard]);

  // 업로드 데이터 저장 — 서버에서 누적 머지 후 응답으로 받은 결과를 그대로 사용
  const handleDataLoaded = useCallback(
    (ch: UploadableChannel) => (data: MultiChannelData, meta: UploadMeta) => {
      // 낙관적 업데이트: 일단 새 파일 데이터로 즉시 표시 (서버 응답으로 곧 머지된 결과로 갱신)
      setUploads((prev) => ({ ...prev, [ch]: data }));
      setMetas((prev) => ({ ...prev, [ch]: meta }));
      setShowUpload(false);

      fetch("/api/profit/channel-uploads", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: ch, data, meta }),
      })
        .then((r) => r.json())
        .then((j) => {
          if (j.ok && j.upload) {
            applyChannelEntry(ch, j.upload);
          } else if (!j.ok) {
            console.error(`[upload] 서버 저장 실패 (${ch}):`, j.error);
          }
        })
        .catch((e) => console.error(`[upload] 서버 저장 실패 (${ch}):`, e));
    },
    [applyChannelEntry]
  );

  // 채널 전체 삭제 (모든 누적 업로드 제거)
  const handleClear = useCallback(
    (ch: UploadableChannel) => () => {
      applyChannelEntry(ch, null);
      fetch("/api/profit/channel-uploads", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: ch, clear: true }),
      }).catch((e) => console.error(`[upload] 서버 삭제 실패 (${ch}):`, e));
    },
    [applyChannelEntry]
  );

  // 누적 업로드 중 1건만 삭제
  const handleRemoveOne = useCallback(
    (ch: UploadableChannel) => (uploadedAt: string) => {
      fetch("/api/profit/channel-uploads", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: ch, removeUploadedAt: uploadedAt }),
      })
        .then((r) => r.json())
        .then((j) => {
          if (j.ok) {
            applyChannelEntry(ch, j.upload ?? null);
          } else {
            console.error(`[upload] 단건 삭제 실패 (${ch}):`, j.error);
          }
        })
        .catch((e) => console.error(`[upload] 단건 삭제 실패 (${ch}):`, e));
    },
    [applyChannelEntry]
  );

  // 카페24 데이터를 MultiChannelData 형태로 변환
  const cafe24Channel: MultiChannelData = useMemo(() => ({
    salesSummary: cafe24Data?.salesSummary ?? EMPTY_CHANNEL_DATA.salesSummary,
    topProducts: cafe24Data?.topProducts ?? [],
    hourlyOrders: cafe24Data?.hourlyOrders ?? EMPTY_CHANNEL_DATA.hourlyOrders,
    weeklyRevenue: cafe24Data?.weeklyRevenue ?? EMPTY_CHANNEL_DATA.weeklyRevenue,
    dailyRevenue: cafe24Data?.dailyRevenue ?? [],
    dailyCogs:    cafe24Data?.dailyCogs ?? [],
    inventory: cafe24Data?.inventory ?? [],
  }), [cafe24Data]);

  // 해리엇 카페24 국내몰(shop_no=1) — 해리엇 브랜드 채널 + 전사 합산에 사용
  const harriotCafe24Channel: MultiChannelData = useMemo(() => ({
    salesSummary: harriotCafe24Data?.salesSummary ?? EMPTY_CHANNEL_DATA.salesSummary,
    topProducts: harriotCafe24Data?.topProducts ?? [],
    hourlyOrders: harriotCafe24Data?.hourlyOrders ?? EMPTY_CHANNEL_DATA.hourlyOrders,
    weeklyRevenue: harriotCafe24Data?.weeklyRevenue ?? EMPTY_CHANNEL_DATA.weeklyRevenue,
    dailyRevenue: harriotCafe24Data?.dailyRevenue ?? [],
    dailyCogs:    harriotCafe24Data?.dailyCogs ?? [],
    inventory: harriotCafe24Data?.inventory ?? [],
  }), [harriotCafe24Data]);

  // 해리엇 카페24 글로벌 영문몰(shop_no=2, USD→KRW) — 식스샵 글로벌 대체. 이미 MultiChannelData.
  const harriotGlobalChannel: MultiChannelData = useMemo(
    () => harriotGlobalCafe24Data ?? EMPTY_CHANNEL_DATA,
    [harriotGlobalCafe24Data],
  );

  // 폴바이스 카페24 영문몰(shop_no=2, paulvice.kr, USD→KRW)
  const paulviceGlobalChannel: MultiChannelData = useMemo(
    () => paulviceGlobalCafe24Data ?? EMPTY_CHANNEL_DATA,
    [paulviceGlobalCafe24Data],
  );

  // 실제 표시 데이터 (업로드 데이터가 없으면 0/빈 상태)
  const channelDataMap = useMemo<Record<UploadableChannel, MultiChannelData>>(() => {
    // 공동구매 = 엑셀 업로드(과거) + 카페24 라이브 공구 상품(226 등) 합산
    const gbParts = [uploads.groupbuy, cafe24Data?.groupBuyLive].filter(Boolean) as MultiChannelData[];
    const groupbuy = gbParts.length ? mergeChannelData(gbParts) : UPLOADABLE_DUMMIES.groupbuy;
    return {
      wconcept:         uploads.wconcept         ?? UPLOADABLE_DUMMIES.wconcept,
      musinsa:          uploads.musinsa          ?? UPLOADABLE_DUMMIES.musinsa,
      "29cm":           uploads["29cm"]          ?? UPLOADABLE_DUMMIES["29cm"],
      groupbuy,
      kakao_gift:       uploads.kakao_gift       ?? UPLOADABLE_DUMMIES.kakao_gift,
      lotte_dutyfree:     uploads.lotte_dutyfree     ?? UPLOADABLE_DUMMIES.lotte_dutyfree,
      shinsegae_dutyfree: uploads.shinsegae_dutyfree ?? UPLOADABLE_DUMMIES.shinsegae_dutyfree,
      naver_smartstore: uploads.naver_smartstore ?? UPLOADABLE_DUMMIES.naver_smartstore,
      chosunmall:       uploads.chosunmall       ?? UPLOADABLE_DUMMIES.chosunmall,
      direct_paulvice:  uploads.direct_paulvice  ?? UPLOADABLE_DUMMIES.direct_paulvice,
      direct_harriot:   uploads.direct_harriot   ?? UPLOADABLE_DUMMIES.direct_harriot,
      b2b_harriot:      uploads.b2b_harriot      ?? UPLOADABLE_DUMMIES.b2b_harriot,
    };
  }, [uploads, cafe24Data]);

  // 채널 id → 표시 데이터 (cafe24/해리엇 cafe24 국내·글로벌은 라이브, 나머지는 업로드맵)
  const resolveChannel = (id: ChannelId): MultiChannelData =>
    id === "cafe24" ? cafe24Channel
    : id === "cafe24_global" ? paulviceGlobalChannel
    : id === "cafe24_harriot" ? harriotCafe24Channel
    : id === "cafe24_harriot_global" ? harriotGlobalChannel
    : channelDataMap[id as UploadableChannel];

  const displayData: MultiChannelData = useMemo(() => {
    if (activeChannel === "cafe24") return cafe24Channel;
    if (activeChannel === "cafe24_global") return paulviceGlobalChannel;
    if (activeChannel === "cafe24_harriot") return harriotCafe24Channel;
    if (activeChannel === "cafe24_harriot_global") return harriotGlobalChannel;
    if (activeChannel === "all") {
      // 현재 브랜드의 채널만 합산
      const list: MultiChannelData[] = [];
      for (const id of brandChannelIds) {
        if (id === "all") continue;
        list.push(resolveChannel(id));
      }
      return mergeChannelData(list);
    }
    // 업로드 가능 채널
    return channelDataMap[activeChannel as UploadableChannel];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChannel, cafe24Channel, paulviceGlobalChannel, harriotCafe24Channel, harriotGlobalChannel, channelDataMap, brandChannelIds]);

  const companyChannels = useMemo(() => {
    const ids = Array.from(new Set(BRANDS.flatMap((b) => BRAND_CHANNELS[b.id]).filter((id) => id !== "all")));
    return ids.map((id) => {
      const meta = CHANNELS.find((c) => c.id === id);
      const data = resolveChannel(id);
      return { channelId: id, name: meta?.name ?? id, color: meta?.color ?? "#71717a", data };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cafe24Channel, paulviceGlobalChannel, harriotCafe24Channel, harriotGlobalChannel, channelDataMap]);

  const companyData = useMemo(() => {
    return mergeChannelData(companyChannels.map((ch) => ch.data));
  }, [companyChannels]);

  const cafe24IsReal       = cafe24Data?.isReal === true;
  // 활성 탭/브랜드에 맞는 cafe24 데이터(폴바이스 vs 해리엇) — 인기상품·실시간 판정에 사용
  const activeCafe24Data =
    activeChannel === "cafe24_harriot" ? harriotCafe24Data
    : activeChannel === "cafe24" ? cafe24Data
    : brand === "harriot" ? harriotCafe24Data
    : cafe24Data;
  const activeCafe24IsReal = activeCafe24Data?.isReal === true;
  const isUploadableActive = UPLOADABLE_CHANNELS.includes(activeChannel as UploadableChannel);
  const activeUploadable   = isUploadableActive ? (activeChannel as UploadableChannel) : null;
  const activeHasUpload    = activeUploadable ? !!uploads[activeUploadable] : false;
  const activeMeta         = activeUploadable ? metas[activeUploadable] : null;
  const activeHistory      = activeUploadable ? histories[activeUploadable] : [];
  const activeChannelMeta  = CHANNELS.find(c => c.id === activeChannel);
  // ChannelComparisonChart에 넘길 채널 데이터 (브랜드 채널만)
  const comparisonChannels = useMemo(() => {
    const list: { channelId: string; name: string; color: string; data: MultiChannelData }[] = [];
    for (const id of brandChannelIds) {
      if (id === "all") continue;
      const meta = CHANNELS.find(c => c.id === id);
      if (!meta) continue;
      const data = resolveChannel(id);
      list.push({ channelId: id, name: meta.name, color: meta.color, data });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cafe24Channel, harriotCafe24Channel, channelDataMap, brandChannelIds]);

  // 이번 달(KST) prefix — 마운트 시점 한 번 결정. 월 경계 즉시 반영은 안 되지만 새로고침이면 OK.
  const [monthPrefix] = useState(() => {
    const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 7);
  });

  // 이번 달 누적 매출 — TodayHubSection 의 매출 목표 진척도용
  const monthRevenue = useMemo(() => {
    let total = 0;
    for (const ch of comparisonChannels) {
      for (const day of ch.data.dailyRevenue ?? []) {
        if (day.date.startsWith(monthPrefix)) total += day.revenue;
      }
    }
    return total;
  }, [comparisonChannels, monthPrefix]);

  const channelRevenues = useMemo(() => {
    return comparisonChannels.map((ch) => ({
      channelId: ch.channelId,
      name: ch.name,
      monthRevenue: (ch.data.dailyRevenue ?? [])
        .filter((day) => day.date.startsWith(monthPrefix))
        .reduce((sum, day) => sum + day.revenue, 0),
    }));
  }, [comparisonChannels, monthPrefix]);

  const companyMonthRevenue = useMemo(() => {
    let total = 0;
    for (const ch of companyChannels) {
      for (const day of ch.data.dailyRevenue ?? []) {
        if (day.date.startsWith(monthPrefix)) total += day.revenue;
      }
    }
    return total;
  }, [companyChannels, monthPrefix]);

  const brandMonthRevenues = useMemo(() => {
    return BRANDS.map((b) => {
      let monthRevenue = 0;
      for (const id of BRAND_CHANNELS[b.id]) {
        if (id === "all") continue;
        const data = resolveChannel(id);
        for (const day of data.dailyRevenue ?? []) {
          if (day.date.startsWith(monthPrefix)) monthRevenue += day.revenue;
        }
      }
      return { brandId: b.id, name: b.name, monthRevenue };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cafe24Channel, harriotCafe24Channel, channelDataMap, monthPrefix]);

  const overview = useMemo(() => {
    const todayRevenue = companyData.salesSummary.today.revenue;
    const todayOrders = companyData.salesSummary.today.orders;
    const activeChannels = companyChannels.filter((c) => {
      const revenue = c.data.dailyRevenue?.reduce((sum, d) => sum + d.revenue, 0) ?? 0;
      return revenue > 0;
    }).length;
    const lowStock = companyData.inventory?.filter((i) => i.status === "soldout" || i.status === "critical").length ?? 0;
    return { todayRevenue, todayOrders, activeChannels, lowStock };
  }, [companyData, companyChannels]);

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      <div
        aria-live="polite"
        className={`pointer-events-none fixed left-1/2 top-[calc(env(safe-area-inset-top)+3.5rem)] z-[35] flex -translate-x-1/2 items-center gap-2 rounded-full border border-zinc-200 bg-white/95 px-3 py-2 text-xs font-semibold text-zinc-600 shadow-lg shadow-zinc-200/60 backdrop-blur transition-all duration-200 dark:border-zinc-800 dark:bg-zinc-900/95 dark:text-zinc-300 dark:shadow-black/30 ${
          pullDistance > 8 || refreshing ? "opacity-100" : "opacity-0"
        }`}
        style={{
          transform: `translate(-50%, ${Math.max(0, pullDistance - 34)}px)`,
        }}
      >
        <RefreshCw
          size={15}
          className={refreshing ? "animate-spin text-sky-500" : "text-zinc-400"}
          style={!refreshing ? { transform: `rotate(${pullDistance * 2.4}deg)` } : undefined}
        />
        {refreshing ? "새로고침 중" : pullDistance >= PULL_REFRESH_TRIGGER ? "놓으면 새로고침" : "아래로 당겨 새로고침"}
      </div>
      <div
        className="transition-transform duration-200 ease-out"
        style={{
          transform: pullDistance > 0 || refreshing ? `translateY(${refreshing ? 28 : Math.min(42, pullDistance * 0.35)}px)` : undefined,
          transitionDuration: pulling ? "0ms" : undefined,
        }}
      >
      {/* API 오류 배너 (폴바이스 카페24만) */}
      {apiError && brand === "paulvice" && (
        <div className="max-w-[1600px] mx-auto px-3 sm:px-6 pt-4">
          <div className="flex items-center gap-2 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-xl px-4 py-3 text-sm">
            <AlertCircle size={16} className="shrink-0" />
            카페24 API 오류: {apiError} — 샘플값 없이 빈 상태로 표시합니다.
          </div>
        </div>
      )}

      {/* 미연결 배너 (폴바이스만) */}
      {!isAuthenticated && brand === "paulvice" && (
        <div className="max-w-[1600px] mx-auto px-3 sm:px-6 pt-4">
          <div className="flex items-center justify-between bg-violet-50 dark:bg-violet-950/40 border border-violet-200 dark:border-violet-800 text-violet-700 dark:text-violet-300 rounded-xl px-4 py-3 text-sm">
            <span>카페24가 연결되지 않았습니다. 샘플값 없이 빈 상태로 표시 중입니다.</span>
            <a href="/api/auth/login" className="ml-4 shrink-0 font-semibold underline underline-offset-2 hover:opacity-70">
              지금 연결하기 →
            </a>
          </div>
        </div>
      )}

      {/* 업로드 가능 채널 배너 */}
      {isUploadableActive && activeChannelMeta && (
        <div className="max-w-[1600px] mx-auto px-3 sm:px-6 pt-4">
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
      <main className="w-full min-w-0 bg-[radial-gradient(circle_at_top_left,rgba(99,102,241,0.08),transparent_34%),linear-gradient(180deg,rgba(244,244,245,0.9),rgba(250,250,250,1))] px-3 py-4 dark:bg-[radial-gradient(circle_at_top_left,rgba(99,102,241,0.14),transparent_34%),linear-gradient(180deg,rgba(9,9,11,1),rgba(24,24,27,1))] sm:px-6 sm:py-6">
        <div className="mx-auto max-w-[1600px] space-y-4 sm:space-y-6">

        <DashboardOverview
          now={now}
          todayRevenue={overview.todayRevenue}
          todayOrders={overview.todayOrders}
          monthRevenue={companyMonthRevenue}
          brandMonthRevenues={brandMonthRevenues}
          activeChannels={overview.activeChannels}
          lowStock={overview.lowStock}
        />

        {/* 브랜드/채널 컨트롤 */}
        <section className="rounded-2xl border border-zinc-200/70 bg-white/85 p-3 shadow-sm shadow-zinc-200/50 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/80 dark:shadow-black/20 sm:p-4">
          <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">View</p>
              <h2 className="mt-1 text-base font-semibold text-zinc-900 dark:text-zinc-100">브랜드와 채널 범위</h2>
            </div>
            <BrandSwitcher current={brand} />
          </div>
          <ChannelTabs
            activeChannel={activeChannel}
            onChange={ch => { setActiveChannel(ch); setShowUpload(false); }}
            cafe24IsReal={cafe24IsReal}
            visibleChannels={brandChannelIds}
            uploadStatus={{
              wconcept: !!uploads.wconcept,
              musinsa:  !!uploads.musinsa,
              "29cm":   !!uploads["29cm"],
              groupbuy: !!uploads.groupbuy || (cafe24Data?.groupBuyLive?.salesSummary?.month?.revenue ?? 0) > 0,
              lotte_dutyfree:     !!uploads.lotte_dutyfree,
              shinsegae_dutyfree: !!uploads.shinsegae_dutyfree,
              naver_smartstore: !!uploads.naver_smartstore,
              b2b_harriot: !!uploads.b2b_harriot,
            }}
          />
        </section>

        {/* 업로드 패널 — 카카오선물하기는 구글시트 sync, 그 외는 엑셀 업로드 */}
        {isUploadableActive && showUpload && activeChannelMeta && activeUploadable && activeUploadable !== "b2b_harriot" && (
          activeUploadable === "kakao_gift" ? (
            <KakaoGiftSyncPanel
              channelName={activeChannelMeta.name}
              channelColor={activeChannelMeta.color}
              onDataLoaded={handleDataLoaded(activeUploadable)}
              onClear={handleClear(activeUploadable)}
              currentMeta={activeMeta}
            />
          ) : (
            <ExcelUploadPanel
              channel={activeUploadable}
              channelName={activeChannelMeta.name}
              channelColor={activeChannelMeta.color}
              onDataLoaded={handleDataLoaded(activeUploadable)}
              onClear={handleClear(activeUploadable)}
              onRemoveOne={handleRemoveOne(activeUploadable)}
              currentMeta={activeMeta}
              history={activeHistory}
            />
          )
        )}

        {/* 매출 요약 — 4지표 + 비교 % */}
        <SalesSummary daily={displayData.dailyRevenue ?? []} />

        {/* 오늘의 운영 허브 — 양 브랜드 공통 (할일/외부약속/이메일은 전사 공통, 매출액션/빅이벤트는 브랜드별) */}
        {/* key={brand} 로 브랜드 전환 시 인스턴스 재생성 → 브랜드별 데이터 새로 로드 */}
        <TodayHubSection
          key={brand}
          brand={brand}
          monthRevenue={monthRevenue}
          channelRevenues={channelRevenues}
          activeChannel={activeChannel}
        />

        {/* CRM — CARE 등록·연락가능 모수·문자 캠페인 퍼널. 매일 보는 자리에 둔다. */}
        <CollapsibleSection title="CRM · 고객 관계" defaultOpen>
          <CrmSection />
        </CollapsibleSection>

        {/* 리뷰요청 — 요청→도달→열람→작성. 볼 데가 없어서 두 달간 안 챙겨졌던 지표다. */}
        <CollapsibleSection title="리뷰 · 요청과 전환" defaultOpen>
          <ReviewSection />
        </CollapsibleSection>

        {/* 채널 비교 — 채널별 매출 한눈에 */}
        <ChannelComparisonChart channels={comparisonChannels} />

        {/* 광고 성과 KPI — 기간별 지출/매출/ROAS/전환수 */}
        <DashboardAdsKpi brand={brand} />

        {/* 소재별 성과 — 수집은 원래 되고 있었는데 화면이 없어 감으로 판단하고 있었다(2026-08-30) */}
        <CollapsibleSection title="광고 소재 · 어떤 게 파나" defaultOpen>
          <CreativeSection brand={brand} />
        </CollapsibleSection>

        {/* 캠페인 트래킹 — 인플루언서 컬랩 등, Cafe24 쿠폰 코드 매칭. 폴바이스 한정(v1). */}
        {brand === "paulvice" && <CampaignTracker brand={brand} />}

        {/* 손익 분석 (P&L) — 메인 도구: 매출, 수수료, 부가세, 매입원가, 광고비, 고정비 → 영업이익 */}
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
          unmatchedSkus={Array.from(new Set([
            ...(cafe24Data?.unmatchedSkus ?? []),
            ...comparisonChannels.flatMap((c) => c.data.unmatchedSkus ?? []),
          ]))}
          unmatchedNames={Array.from(new Set(
            comparisonChannels.flatMap((c) => c.data.unmatchedNames ?? [])
          ))}
          brand={brand}
        />

        {/* 상품별 판매 순위 — 보조 정보 (접힘) */}
        <CollapsibleSection title="상품별 판매 순위" defaultOpen={false}>
          {/*
            채널마다 실제로 가진 기간이 다르다. 예전엔 없는 기간에 월 데이터를 그대로 돌려줘
            오늘·이번주·이번달이 같은 숫자로 보였고, 업로드 채널에서 3개월을 누르면
            카페24 순위가 떴다(2026-08-30 수정). 이제 제공하는 기간만 노출한다.
              - 카페24 계열: 오늘·이번주·이번달·3개월 전부
              - 엑셀 업로드 채널: 파일 한 벌뿐 → 기간 구분 없음. 파일이 담은 구간을 그대로 표기
              - 전체: 이번 달만 전 채널 합산. 오늘·이번주는 카페24만이라 그렇게 적어둔다
          */}
          <TopProducts
            brand={brand}
            channelName={activeChannelMeta?.name ?? "전체"}
            today={activeCafe24Data?.topProductsToday ?? []}
            week={activeCafe24Data?.topProductsWeek ?? []}
            month={displayData.topProducts}
            isReal={(activeCafe24IsReal && !isUploadableActive) || activeHasUpload}
            availablePeriods={
              isUploadableActive
                ? ["month"]
                : activeChannel === "all"
                  ? ["today", "week", "month"]
                  : ["today", "week", "month", "quarter"]
            }
            uploadPeriod={isUploadableActive && activeMeta ? activeMeta.period : null}
            periodNote={
              activeChannel === "all"
                ? { today: "카페24 기준", week: "카페24 기준", month: "전 채널 합산" }
                : undefined
            }
          />
        </CollapsibleSection>
        </div>
      </main>

      {/* 푸터 */}
      <footer className="bg-zinc-50 px-3 py-4 text-center text-xs text-zinc-300 dark:bg-zinc-900 dark:text-zinc-600 sm:px-6 sm:py-6">
        Harriot Watches · 멀티 브랜드 통합 현황
      </footer>
      </div>
    </div>
  );
}

function DashboardOverview({
  now,
  todayRevenue,
  todayOrders,
  monthRevenue,
  brandMonthRevenues,
  activeChannels,
  lowStock,
}: {
  now: string;
  todayRevenue: number;
  todayOrders: number;
  monthRevenue: number;
  brandMonthRevenues: Array<{ brandId: Brand; name: string; monthRevenue: number }>;
  activeChannels: number;
  lowStock: number;
}) {
  const sortedBrands = [...brandMonthRevenues].sort((a, b) => b.monthRevenue - a.monthRevenue);
  const primaryBrand = sortedBrands[0];
  const secondaryBrand = sortedBrands[1];

  const stats = [
    {
      label: "오늘 전체 매출",
      value: `${fmtKrwCompact(todayRevenue)}원`,
      sub: `주문 ${todayOrders.toLocaleString("ko-KR")}건`,
      icon: BarChart3,
      tone: "text-emerald-600 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-500/10",
    },
    {
      label: "이번 달 전체 매출",
      value: `${fmtKrwCompact(monthRevenue)}원`,
      sub: "전 브랜드 합산",
      icon: Database,
      tone: "text-sky-600 bg-sky-50 dark:text-sky-300 dark:bg-sky-500/10",
    },
    {
      label: "브랜드 기여",
      value: primaryBrand ? `${primaryBrand.name} ${fmtKrwCompact(primaryBrand.monthRevenue)}원` : "0원",
      sub: secondaryBrand ? `${secondaryBrand.name} ${fmtKrwCompact(secondaryBrand.monthRevenue)}원` : "비교 브랜드 없음",
      icon: Layers3,
      tone: "text-violet-600 bg-violet-50 dark:text-violet-300 dark:bg-violet-500/10",
    },
    {
      label: "재고 주의",
      value: `${lowStock.toLocaleString("ko-KR")}종`,
      sub: lowStock > 0 ? "품절·위험 포함" : "문제 없음",
      icon: CheckCircle2,
      tone:
        lowStock > 0
          ? "text-amber-600 bg-amber-50 dark:text-amber-300 dark:bg-amber-500/10"
          : "text-emerald-600 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-500/10",
    },
  ];

  return (
    <section className="overflow-hidden rounded-3xl border border-zinc-200/70 bg-white shadow-sm shadow-zinc-200/60 dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/20">
      <div className="grid gap-0 lg:grid-cols-[1.08fr_1.6fr]">
        <div className="border-b border-zinc-100 p-5 dark:border-zinc-800 sm:p-6 lg:border-b-0 lg:border-r">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-400">Operations Dashboard</p>
          <h1 className="mt-3 text-2xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50 sm:text-3xl">
            해리엇와치스 운영 현황
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">
            폴바이스와 해리엇의 매출, 채널, 재고, 광고 흐름을 한 화면에서 확인합니다.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <span className="rounded-full border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
              회사 전체
            </span>
            <span className="rounded-full border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
              활성 채널 {activeChannels.toLocaleString("ko-KR")}개
            </span>
            <span className="rounded-full border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
              {now}
            </span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-px bg-zinc-100 dark:bg-zinc-800 lg:grid-cols-4">
          {stats.map((s) => {
            const Icon = s.icon;
            return (
              <div key={s.label} className="min-w-0 bg-white p-4 dark:bg-zinc-900 sm:p-5">
                <div className={`mb-4 flex h-9 w-9 items-center justify-center rounded-xl ${s.tone}`}>
                  <Icon size={17} />
                </div>
                <p className="text-[11px] font-medium text-zinc-400">{s.label}</p>
                <p className="mt-1 truncate text-lg font-bold tracking-tight text-zinc-950 dark:text-zinc-50 sm:text-xl">
                  {s.value}
                </p>
                <p className="mt-1 truncate text-xs text-zinc-400">{s.sub}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────
// 접힘 섹션
// ────────────────────────────────────────────────────────────────────
function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 sm:px-6 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition"
      >
        <span className="text-sm font-bold text-zinc-700 dark:text-zinc-300">
          {title}
        </span>
        {open ? (
          <ChevronUp size={16} className="text-zinc-400" />
        ) : (
          <ChevronDown size={16} className="text-zinc-400" />
        )}
      </button>
      {open && (
        <div className="border-t border-zinc-100 dark:border-zinc-800 p-4 sm:p-6">
          {children}
        </div>
      )}
    </section>
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
