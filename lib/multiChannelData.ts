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
  /** SKU 칼럼이 없어 nameAliases 매핑이 필요한 상품명. */
  unmatchedNames?: string[];
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

// ── 채널별 다중 업로드 머지 ──────────────────────────────────────────────────
//
// 한 채널에 여러 개의 엑셀 파일이 누적 업로드되는 경우 (예: 2월 파일 + 3월 파일),
// 각 업로드는 자기 파일이 커버하는 기간의 MultiChannelData를 들고 있다.
// 이걸 하나의 통합 MultiChannelData로 합쳐 UI에 보여준다.
//
// 머지 정책:
//   - dailyRevenue / dailyCogs : 날짜 키. 동일 날짜는 가장 최근 업로드 값이 우선
//     (사용자가 같은 기간을 다시 올렸다면 보정한 값을 쓴다는 의미).
//   - topProducts    : SKU(또는 상품명) 키로 sold/revenue 합산 → 매출 기준 상위 10.
//                       기간이 겹치는 두 업로드가 있으면 이중 합산될 수 있는데,
//                       동일 fileName 재업로드는 라우트 단에서 교체되므로
//                       실제로는 서로 다른 기간을 올린 일반 케이스에서만 누적된다.
//   - hourlyOrders / weeklyRevenue : 같은 사유로 인덱스별 단순 합산.
//   - salesSummary   : 머지된 dailyRevenue로부터 today/week/month/prevMonth 재계산
//                       (각 업로드 시점의 "오늘" 기준이 아니라 현재 시각 기준이 맞음).
//   - unmatchedSkus / unmatchedNames : 합집합.
//   - inventory      : 빈 배열 (외부 채널은 재고 데이터 없음).
//
export interface PerUpload {
  fileName: string;
  rowCount: number;
  period: { start: string; end: string };
  uploadedAt: string;
  data: MultiChannelData;
}

const HOURS_24 = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}시`);
const WEEK_DAYS = ["월", "화", "수", "목", "금", "토", "일"];

function fmtKstDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function sumDailySlice(daily: DailyData[], predicate: (date: string) => boolean) {
  let revenue = 0;
  let orders = 0;
  for (const d of daily) {
    if (!predicate(d.date)) continue;
    revenue += d.revenue;
    orders += d.orders;
  }
  return { revenue, orders, avgOrder: orders > 0 ? Math.round(revenue / orders) : 0 };
}

export interface MergedChannelUpload {
  data: MultiChannelData;
  meta: {
    fileName: string;
    rowCount: number;
    period: { start: string; end: string };
    uploadedAt: string;
  };
  history: Array<{
    fileName: string;
    rowCount: number;
    period: { start: string; end: string };
    uploadedAt: string;
  }>;
}

export function mergeUploads(uploads: PerUpload[]): MergedChannelUpload | null {
  if (uploads.length === 0) return null;

  // uploadedAt 오름차순 — 머지 시 뒤쪽(최신)이 우선
  const sorted = [...uploads].sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt));

  // dailyRevenue: 날짜 → 최신 업로드 값
  const dailyRevMap = new Map<string, DailyData>();
  for (const up of sorted) {
    for (const d of up.data.dailyRevenue ?? []) {
      dailyRevMap.set(d.date, d);
    }
  }
  const dailyRevenue: DailyData[] = Array.from(dailyRevMap.values()).sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  // dailyCogs: 동일 정책
  const dailyCogsMap = new Map<string, DailyCost>();
  for (const up of sorted) {
    for (const c of up.data.dailyCogs ?? []) {
      dailyCogsMap.set(c.date, c);
    }
  }
  const dailyCogs: DailyCost[] = Array.from(dailyCogsMap.values()).sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  // topProducts: SKU/상품명 키로 합산
  const productMap = new Map<string, { name: string; sku: string; sold: number; revenue: number; image: string }>();
  for (const up of sorted) {
    for (const p of up.data.topProducts ?? []) {
      const key = (p.sku || p.name).trim();
      if (!key) continue;
      const cur = productMap.get(key) ?? {
        name: p.name,
        sku: p.sku,
        sold: 0,
        revenue: 0,
        image: p.image || "⌚",
      };
      cur.sold += p.sold;
      cur.revenue += p.revenue;
      // 이름/이미지는 가장 최신 업로드 값으로 갱신
      cur.name = p.name || cur.name;
      cur.image = p.image || cur.image;
      productMap.set(key, cur);
    }
  }
  const topProducts: ProductRank[] = Array.from(productMap.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10)
    .map((p, i) => ({ rank: i + 1, ...p }));

  // hourlyOrders: 24시간 버킷 합산
  const hourlyOrders: HourlyData[] = HOURS_24.map((hour, i) => {
    let orders = 0;
    let revenue = 0;
    for (const up of sorted) {
      const h = up.data.hourlyOrders?.[i];
      if (h) {
        orders += h.orders;
        revenue += h.revenue;
      }
    }
    return { hour, orders, revenue };
  });

  // weeklyRevenue: 요일 버킷 합산
  const weeklyRevenue: WeeklyData[] = WEEK_DAYS.map((day, i) => {
    let orders = 0;
    let revenue = 0;
    for (const up of sorted) {
      const w = up.data.weeklyRevenue?.[i];
      if (w) {
        orders += w.orders;
        revenue += w.revenue;
      }
    }
    return { day, orders, revenue };
  });

  // salesSummary: 머지된 dailyRevenue로부터 재계산
  const now = new Date();
  const todayStr = fmtKstDate(now);
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  const weekAgoStr = fmtKstDate(weekAgo);
  const curYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevYM = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;

  const salesSummary: SalesSummaryData = {
    today:     sumDailySlice(dailyRevenue, (d) => d === todayStr),
    week:      sumDailySlice(dailyRevenue, (d) => d >= weekAgoStr && d <= todayStr),
    month:     sumDailySlice(dailyRevenue, (d) => d.startsWith(curYM)),
    prevMonth: sumDailySlice(dailyRevenue, (d) => d.startsWith(prevYM)),
  };

  // unmatched 합집합
  const unmatchedSkuSet = new Set<string>();
  const unmatchedNameSet = new Set<string>();
  for (const up of sorted) {
    for (const s of up.data.unmatchedSkus ?? []) unmatchedSkuSet.add(s);
    for (const n of up.data.unmatchedNames ?? []) unmatchedNameSet.add(n);
  }

  const data: MultiChannelData = {
    salesSummary,
    topProducts,
    hourlyOrders,
    weeklyRevenue,
    dailyRevenue,
    dailyCogs,
    unmatchedSkus: Array.from(unmatchedSkuSet),
    unmatchedNames: Array.from(unmatchedNameSet),
    inventory: [],
  };

  // meta: 누적 정보 + 가장 최근 파일명
  const newest = sorted[sorted.length - 1];
  const totalRows = sorted.reduce((s, u) => s + u.rowCount, 0);
  const periodStart = sorted
    .map((u) => u.period.start)
    .filter(Boolean)
    .sort()[0] ?? newest.period.start;
  const periodEnd = sorted
    .map((u) => u.period.end)
    .filter(Boolean)
    .sort()
    .slice(-1)[0] ?? newest.period.end;

  return {
    data,
    meta: {
      fileName: newest.fileName,
      rowCount: totalRows,
      period: { start: periodStart, end: periodEnd },
      uploadedAt: newest.uploadedAt,
    },
    history: sorted.map(({ fileName, rowCount, period, uploadedAt }) => ({
      fileName,
      rowCount,
      period,
      uploadedAt,
    })),
  };
}
