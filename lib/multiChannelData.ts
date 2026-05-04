import type {
  SalesSummaryData,
  ProductRank,
  HourlyData,
  WeeklyData,
  DailyData,
  DailyCost,
  InventoryItem,
} from "./cafe24Data";

export type ChannelId =
  | "all"
  | "cafe24"
  | "wconcept"
  | "musinsa"
  | "29cm"
  | "groupbuy"
  | "kakao_gift"
  | "sixshop"
  | "naver_smartstore"
  | "sixshop_global";

export type UploadableChannel =
  | "wconcept"
  | "musinsa"
  | "29cm"
  | "groupbuy"
  | "kakao_gift"
  | "sixshop"
  | "naver_smartstore"
  | "sixshop_global";

export const UPLOADABLE_CHANNELS: UploadableChannel[] = [
  "wconcept",
  "musinsa",
  "29cm",
  "groupbuy",
  "kakao_gift",
  "sixshop",
  "naver_smartstore",
  "sixshop_global",
];

// ── 브랜드 ─────────────────────────────────────────────────────────────────
export type Brand = "paulvice" | "harriot";

export const BRANDS: { id: Brand; name: string; gradient: string; accent: string }[] = [
  { id: "paulvice", name: "폴바이스", gradient: "from-violet-500 to-fuchsia-500", accent: "#7c3aed" },
  { id: "harriot",  name: "해리엇",   gradient: "from-amber-600 to-stone-800",     accent: "#b45309" },
];

/** 브랜드별 매출 채널 — 대시보드 탭에 노출되는 순서 */
export const BRAND_CHANNELS: Record<Brand, ChannelId[]> = {
  paulvice: ["all", "cafe24", "wconcept", "musinsa", "29cm", "groupbuy", "kakao_gift"],
  harriot:  ["all", "sixshop", "naver_smartstore", "sixshop_global"],
};

export interface ChannelMeta {
  id: ChannelId;
  name: string;
  color: string;
  bgColor: string;
  textColor: string;
}

export const CHANNELS: ChannelMeta[] = [
  { id: "all",      name: "전체",     color: "#7c3aed", bgColor: "bg-violet-600",   textColor: "text-violet-600"  },
  { id: "cafe24",   name: "카페24",   color: "#0ea5e9", bgColor: "bg-sky-500",      textColor: "text-sky-600"     },
  { id: "wconcept", name: "W컨셉",    color: "#e11d48", bgColor: "bg-rose-500",     textColor: "text-rose-600"    },
  { id: "musinsa",  name: "무신사",   color: "#2563eb", bgColor: "bg-blue-600",     textColor: "text-blue-600"    },
  { id: "29cm",     name: "29CM",     color: "#000000", bgColor: "bg-zinc-900",     textColor: "text-zinc-900"    },
  { id: "groupbuy", name: "공동구매", color: "#f59e0b", bgColor: "bg-amber-500",    textColor: "text-amber-600"   },
  { id: "kakao_gift", name: "카카오선물하기", color: "#fbbf24", bgColor: "bg-yellow-400", textColor: "text-yellow-700"  },

  // 해리엇 채널
  { id: "sixshop",          name: "식스샵",         color: "#10b981", bgColor: "bg-emerald-500", textColor: "text-emerald-600" },
  { id: "naver_smartstore", name: "네이버 스마트스토어", color: "#22c55e", bgColor: "bg-green-500",   textColor: "text-green-600"   },
  { id: "sixshop_global",   name: "식스샵 글로벌",   color: "#0d9488", bgColor: "bg-teal-600",    textColor: "text-teal-600"    },
];

export interface MultiChannelData {
  salesSummary: SalesSummaryData;
  topProducts: ProductRank[];
  hourlyOrders: HourlyData[];
  weeklyRevenue: WeeklyData[];
  dailyRevenue?: DailyData[]; // 일별 매출 (있는 채널만)
  dailyCogs?: DailyCost[];     // 일별 매입원가 (있는 채널만)
  /** 매입 단가가 cogsMap 에 없어 매칭 실패한 SKU. UI에서 누락 안내. */
  unmatchedSkus?: string[];
  inventory: InventoryItem[];
}

// ── W컨셉 / 무신사: 업로드 전 빈 placeholder (29cm·공동구매와 동일 패턴) ──
// 과거에는 데모용 하드코딩 매출이 있었으나, CSV 업로드 안 한 상태에서 가짜 숫자가
// 채널 비교 차트에 노출되는 문제가 있어 빈 데이터로 통일.

// ── 29CM·공동구매 빈 더미 (Excel 업로드 전 placeholder) ───────────────────

const HOURS_EMPTY = Array.from({ length: 24 }, (_, h) => ({
  hour: `${String(h).padStart(2, "0")}시`,
  orders: 0,
  revenue: 0,
}));
const WEEK_EMPTY = ["월", "화", "수", "목", "금", "토", "일"].map((day) => ({
  day,
  revenue: 0,
  orders: 0,
}));
const PERIOD_EMPTY = { revenue: 0, orders: 0, avgOrder: 0 };

export const twentyNineCmDummy: MultiChannelData = {
  salesSummary: {
    today: PERIOD_EMPTY,
    week: PERIOD_EMPTY,
    month: PERIOD_EMPTY,
    prevMonth: PERIOD_EMPTY,
  },
  topProducts: [],
  hourlyOrders: HOURS_EMPTY,
  weeklyRevenue: WEEK_EMPTY,
  inventory: [],
};

export const groupbuyDummy: MultiChannelData = {
  salesSummary: {
    today: PERIOD_EMPTY,
    week: PERIOD_EMPTY,
    month: PERIOD_EMPTY,
    prevMonth: PERIOD_EMPTY,
  },
  topProducts: [],
  hourlyOrders: HOURS_EMPTY,
  weeklyRevenue: WEEK_EMPTY,
  inventory: [],
};

export const kakaoGiftDummy: MultiChannelData = {
  salesSummary: { today: PERIOD_EMPTY, week: PERIOD_EMPTY, month: PERIOD_EMPTY, prevMonth: PERIOD_EMPTY },
  topProducts: [], hourlyOrders: HOURS_EMPTY, weeklyRevenue: WEEK_EMPTY, inventory: [],
};

export const sixshopDummy: MultiChannelData = {
  salesSummary: { today: PERIOD_EMPTY, week: PERIOD_EMPTY, month: PERIOD_EMPTY, prevMonth: PERIOD_EMPTY },
  topProducts: [], hourlyOrders: HOURS_EMPTY, weeklyRevenue: WEEK_EMPTY, inventory: [],
};
export const naverSmartstoreDummy: MultiChannelData = {
  salesSummary: { today: PERIOD_EMPTY, week: PERIOD_EMPTY, month: PERIOD_EMPTY, prevMonth: PERIOD_EMPTY },
  topProducts: [], hourlyOrders: HOURS_EMPTY, weeklyRevenue: WEEK_EMPTY, inventory: [],
};
export const sixshopGlobalDummy: MultiChannelData = {
  salesSummary: { today: PERIOD_EMPTY, week: PERIOD_EMPTY, month: PERIOD_EMPTY, prevMonth: PERIOD_EMPTY },
  topProducts: [], hourlyOrders: HOURS_EMPTY, weeklyRevenue: WEEK_EMPTY, inventory: [],
};

export const wconceptDummy: MultiChannelData = {
  salesSummary: { today: PERIOD_EMPTY, week: PERIOD_EMPTY, month: PERIOD_EMPTY, prevMonth: PERIOD_EMPTY },
  topProducts: [], hourlyOrders: HOURS_EMPTY, weeklyRevenue: WEEK_EMPTY, inventory: [],
};
export const musinsaDummy: MultiChannelData = {
  salesSummary: { today: PERIOD_EMPTY, week: PERIOD_EMPTY, month: PERIOD_EMPTY, prevMonth: PERIOD_EMPTY },
  topProducts: [], hourlyOrders: HOURS_EMPTY, weeklyRevenue: WEEK_EMPTY, inventory: [],
};

export const UPLOADABLE_DUMMIES: Record<UploadableChannel, MultiChannelData> = {
  wconcept: wconceptDummy,
  musinsa: musinsaDummy,
  "29cm": twentyNineCmDummy,
  groupbuy: groupbuyDummy,
  kakao_gift: kakaoGiftDummy,
  sixshop: sixshopDummy,
  naver_smartstore: naverSmartstoreDummy,
  sixshop_global: sixshopGlobalDummy,
};

// ── 합산 유틸 ─────────────────────────────────────────────────────────────

function sumPeriod(arr: SalesSummaryData[keyof SalesSummaryData][]) {
  const revenue = arr.reduce((s, p) => s + p.revenue, 0);
  const orders  = arr.reduce((s, p) => s + p.orders, 0);
  return { revenue, orders, avgOrder: orders > 0 ? Math.round(revenue / orders) : 0 };
}

export function mergeChannelData(datasets: MultiChannelData[]): MultiChannelData {
  // Sales summary
  const salesSummary: SalesSummaryData = {
    today:     sumPeriod(datasets.map((d) => d.salesSummary.today)),
    week:      sumPeriod(datasets.map((d) => d.salesSummary.week)),
    month:     sumPeriod(datasets.map((d) => d.salesSummary.month)),
    prevMonth: sumPeriod(datasets.map((d) => d.salesSummary.prevMonth)),
  };

  // Top products — SKU 기준 합산 후 재정렬
  const pMap: Record<string, ProductRank> = {};
  datasets.flatMap((d) => d.topProducts).forEach((p) => {
    const key = p.sku || p.name;
    if (!pMap[key]) pMap[key] = { ...p, sold: 0, revenue: 0 };
    pMap[key].sold    += p.sold;
    pMap[key].revenue += p.revenue;
  });
  const topProducts = Object.values(pMap)
    .sort((a, b) => b.sold - a.sold)
    .slice(0, 10)
    .map((p, i) => ({ ...p, rank: i + 1 }));

  // Hourly orders
  const hourlyOrders: HourlyData[] = datasets[0].hourlyOrders.map((h, i) => ({
    hour: h.hour,
    orders:  datasets.reduce((s, d) => s + (d.hourlyOrders[i]?.orders  ?? 0), 0),
    revenue: datasets.reduce((s, d) => s + (d.hourlyOrders[i]?.revenue ?? 0), 0),
  }));

  // Weekly revenue
  const weeklyRevenue: WeeklyData[] = datasets[0].weeklyRevenue.map((w, i) => ({
    day:     w.day,
    revenue: datasets.reduce((s, d) => s + (d.weeklyRevenue[i]?.revenue ?? 0), 0),
    orders:  datasets.reduce((s, d) => s + (d.weeklyRevenue[i]?.orders  ?? 0), 0),
  }));

  // Daily revenue — 날짜 기준 합산 (shipments 포함)
  const dailyMap = new Map<
    string,
    { revenue: number; orders: number; shipments: number; hasShipments: boolean }
  >();
  for (const d of datasets) {
    for (const day of d.dailyRevenue ?? []) {
      const cur = dailyMap.get(day.date) ?? { revenue: 0, orders: 0, shipments: 0, hasShipments: false };
      cur.revenue += day.revenue;
      cur.orders += day.orders;
      // shipments가 있으면 합산, 없으면 orders로 fallback
      cur.shipments += day.shipments ?? day.orders;
      if (day.shipments !== undefined) cur.hasShipments = true;
      dailyMap.set(day.date, cur);
    }
  }
  const dailyRevenue: DailyData[] = Array.from(dailyMap.entries())
    .map(([date, v]) => ({
      date,
      revenue: v.revenue,
      orders: v.orders,
      shipments: v.hasShipments ? v.shipments : undefined,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Inventory — 카페24(첫 번째) 데이터만 사용
  const inventory = datasets[0].inventory;

  return { salesSummary, topProducts, hourlyOrders, weeklyRevenue, dailyRevenue, inventory };
}
