import type {
  SalesSummaryData,
  ProductRank,
  HourlyData,
  WeeklyData,
  InventoryItem,
} from "./cafe24Data";

export type ChannelId = "all" | "cafe24" | "wconcept" | "musinsa";

export interface ChannelMeta {
  id: ChannelId;
  name: string;
  color: string;
  bgColor: string;
  textColor: string;
}

export const CHANNELS: ChannelMeta[] = [
  { id: "all",      name: "전체",    color: "#7c3aed", bgColor: "bg-violet-600", textColor: "text-violet-600" },
  { id: "cafe24",   name: "카페24",  color: "#0ea5e9", bgColor: "bg-sky-500",    textColor: "text-sky-600"    },
  { id: "wconcept", name: "W컨셉",   color: "#e11d48", bgColor: "bg-rose-500",   textColor: "text-rose-600"   },
  { id: "musinsa",  name: "무신사",  color: "#2563eb", bgColor: "bg-blue-600",   textColor: "text-blue-600"   },
];

export interface MultiChannelData {
  salesSummary: SalesSummaryData;
  topProducts: ProductRank[];
  hourlyOrders: HourlyData[];
  weeklyRevenue: WeeklyData[];
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

  // Inventory — 카페24(첫 번째) 데이터만 사용
  const inventory = datasets[0].inventory;

  return { salesSummary, topProducts, hourlyOrders, weeklyRevenue, inventory };
}
