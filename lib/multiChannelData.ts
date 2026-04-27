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
  inventory: InventoryItem[];
}

// ── W컨셉 더미 데이터 ──────────────────────────────────────────────────────

export const wconceptDummy: MultiChannelData = {
  salesSummary: {
    today:     { revenue: 2_100_000,  orders: 3,  avgOrder: 700_000 },
    week:      { revenue: 14_800_000, orders: 21, avgOrder: 704_762 },
    month:     { revenue: 58_400_000, orders: 87, avgOrder: 671_264 },
    prevMonth: { revenue: 61_200_000, orders: 92, avgOrder: 665_217 },
  },
  topProducts: [
    { rank: 1, name: "폴바이스 클래식 오토매틱 블랙", sku: "PW-CA-001-BK", sold: 18, revenue: 16_200_000, image: "⌚" },
    { rank: 2, name: "폴바이스 미니멀 골드",          sku: "PW-MN-004-GD", sold: 14, revenue: 12_600_000, image: "⌚" },
    { rank: 3, name: "폴바이스 헤리티지 브라운",       sku: "PW-HT-010-BR", sold: 11, revenue: 15_400_000, image: "⌚" },
    { rank: 4, name: "폴바이스 레이디 로즈골드",       sku: "PW-LD-006-RG", sold: 9,  revenue: 7_200_000,  image: "⌚" },
    { rank: 5, name: "폴바이스 드레스 실버",           sku: "PW-DR-008-SV", sold: 8,  revenue: 7_200_000,  image: "⌚" },
    { rank: 6, name: "폴바이스 크로노그래프 네이비",   sku: "PW-CH-003-NV", sold: 7,  revenue: 9_800_000,  image: "⌚" },
    { rank: 7, name: "폴바이스 슬림 쿼츠 화이트",     sku: "PW-SQ-002-WH", sold: 6,  revenue: 3_000_000,  image: "⌚" },
    { rank: 8, name: "폴바이스 다이버 블루",           sku: "PW-DV-005-BL", sold: 5,  revenue: 7_000_000,  image: "⌚" },
    { rank: 9, name: "폴바이스 파일럿 스틸",           sku: "PW-PT-007-ST", sold: 5,  revenue: 7_000_000,  image: "⌚" },
    { rank: 10, name: "폴바이스 스포츠 블랙",          sku: "PW-SP-009-BK", sold: 4,  revenue: 3_200_000,  image: "⌚" },
  ],
  hourlyOrders: [
    { hour: "00시", orders: 0, revenue: 0 },        { hour: "01시", orders: 0, revenue: 0 },
    { hour: "02시", orders: 0, revenue: 0 },        { hour: "03시", orders: 0, revenue: 0 },
    { hour: "04시", orders: 0, revenue: 0 },        { hour: "05시", orders: 0, revenue: 0 },
    { hour: "06시", orders: 0, revenue: 0 },        { hour: "07시", orders: 0, revenue: 0 },
    { hour: "08시", orders: 0, revenue: 0 },        { hour: "09시", orders: 0, revenue: 0 },
    { hour: "10시", orders: 1, revenue: 700_000 },  { hour: "11시", orders: 2, revenue: 1_400_000 },
    { hour: "12시", orders: 2, revenue: 1_400_000 }, { hour: "13시", orders: 1, revenue: 700_000 },
    { hour: "14시", orders: 0, revenue: 0 },        { hour: "15시", orders: 1, revenue: 700_000 },
    { hour: "16시", orders: 0, revenue: 0 },        { hour: "17시", orders: 0, revenue: 0 },
    { hour: "18시", orders: 1, revenue: 700_000 },  { hour: "19시", orders: 2, revenue: 1_400_000 },
    { hour: "20시", orders: 1, revenue: 700_000 },  { hour: "21시", orders: 1, revenue: 700_000 },
    { hour: "22시", orders: 0, revenue: 0 },        { hour: "23시", orders: 0, revenue: 0 },
  ],
  weeklyRevenue: [
    { day: "월", revenue: 8_200_000, orders: 12 },  { day: "화", revenue: 9_400_000,  orders: 14 },
    { day: "수", revenue: 7_800_000, orders: 11 },  { day: "목", revenue: 10_600_000, orders: 16 },
    { day: "금", revenue: 12_500_000, orders: 18 }, { day: "토", revenue: 18_300_000, orders: 27 },
    { day: "일", revenue: 15_700_000, orders: 23 },
  ],
  inventory: [],
};

// ── 무신사 더미 데이터 ─────────────────────────────────────────────────────

export const musinsaDummy: MultiChannelData = {
  salesSummary: {
    today:     { revenue: 3_200_000,  orders: 8,   avgOrder: 400_000 },
    week:      { revenue: 22_600_000, orders: 57,  avgOrder: 396_491 },
    month:     { revenue: 89_300_000, orders: 226, avgOrder: 395_133 },
    prevMonth: { revenue: 95_100_000, orders: 241, avgOrder: 394_606 },
  },
  topProducts: [
    { rank: 1, name: "폴바이스 슬림 쿼츠 화이트",   sku: "PW-SQ-002-WH", sold: 52, revenue: 26_000_000, image: "⌚" },
    { rank: 2, name: "폴바이스 스포츠 블랙",         sku: "PW-SP-009-BK", sold: 47, revenue: 37_600_000, image: "⌚" },
    { rank: 3, name: "폴바이스 파일럿 스틸",         sku: "PW-PT-007-ST", sold: 38, revenue: 53_200_000, image: "⌚" },
    { rank: 4, name: "폴바이스 크로노그래프 네이비", sku: "PW-CH-003-NV", sold: 33, revenue: 46_200_000, image: "⌚" },
    { rank: 5, name: "폴바이스 다이버 블루",         sku: "PW-DV-005-BL", sold: 29, revenue: 40_600_000, image: "⌚" },
    { rank: 6, name: "폴바이스 클래식 오토매틱 블랙",sku: "PW-CA-001-BK", sold: 24, revenue: 21_600_000, image: "⌚" },
    { rank: 7, name: "폴바이스 미니멀 골드",         sku: "PW-MN-004-GD", sold: 18, revenue: 16_200_000, image: "⌚" },
    { rank: 8, name: "폴바이스 레이디 로즈골드",     sku: "PW-LD-006-RG", sold: 12, revenue: 9_600_000,  image: "⌚" },
    { rank: 9, name: "폴바이스 드레스 실버",         sku: "PW-DR-008-SV", sold: 9,  revenue: 8_100_000,  image: "⌚" },
    { rank: 10, name: "폴바이스 헤리티지 브라운",    sku: "PW-HT-010-BR", sold: 7,  revenue: 9_800_000,  image: "⌚" },
  ],
  hourlyOrders: [
    { hour: "00시", orders: 1, revenue: 400_000 },   { hour: "01시", orders: 0, revenue: 0 },
    { hour: "02시", orders: 0, revenue: 0 },         { hour: "03시", orders: 0, revenue: 0 },
    { hour: "04시", orders: 0, revenue: 0 },         { hour: "05시", orders: 1, revenue: 400_000 },
    { hour: "06시", orders: 1, revenue: 400_000 },   { hour: "07시", orders: 2, revenue: 800_000 },
    { hour: "08시", orders: 3, revenue: 1_200_000 }, { hour: "09시", orders: 4, revenue: 1_600_000 },
    { hour: "10시", orders: 6, revenue: 2_400_000 }, { hour: "11시", orders: 9, revenue: 3_600_000 },
    { hour: "12시", orders: 14, revenue: 5_600_000 },{ hour: "13시", orders: 12, revenue: 4_800_000 },
    { hour: "14시", orders: 8, revenue: 3_200_000 }, { hour: "15시", orders: 11, revenue: 4_400_000 },
    { hour: "16시", orders: 13, revenue: 5_200_000 },{ hour: "17시", orders: 16, revenue: 6_400_000 },
    { hour: "18시", orders: 19, revenue: 7_600_000 },{ hour: "19시", orders: 15, revenue: 6_000_000 },
    { hour: "20시", orders: 11, revenue: 4_400_000 },{ hour: "21시", orders: 8, revenue: 3_200_000 },
    { hour: "22시", orders: 5, revenue: 2_000_000 }, { hour: "23시", orders: 3, revenue: 1_200_000 },
  ],
  weeklyRevenue: [
    { day: "월", revenue: 14_600_000, orders: 37 }, { day: "화", revenue: 17_200_000, orders: 43 },
    { day: "수", revenue: 15_400_000, orders: 39 }, { day: "목", revenue: 19_800_000, orders: 50 },
    { day: "금", revenue: 24_500_000, orders: 62 }, { day: "토", revenue: 33_100_000, orders: 83 },
    { day: "일", revenue: 29_700_000, orders: 75 },
  ],
  inventory: [],
};

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
