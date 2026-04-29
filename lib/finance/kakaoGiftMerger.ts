/**
 * 카카오선물하기 채널 데이터 머지 — 시트 fetch + 월별 정산서를 합쳐 단일
 * channel_upload:kakao_gift 갱신.
 *
 * 정책:
 *   - 정산서가 있는 달은 정산서 데이터 우선 (단일 진실 source)
 *   - 정산서가 없는 달은 시트 데이터 fallback
 *   - topProducts는 모든 정산서 합산 (시트는 12개월 누적이라 월별 분리 불가)
 *
 * KV 키:
 *   - kakao_gift_sheet:data            = 시트 fetch 결과 (MultiChannelData)
 *   - channel_settlement:kakao_gift:YYYY-MM = 월별 정산서 raw (KakaoSettlement)
 *   - channel_upload:kakao_gift        = 머지 결과 (UI에서 사용)
 */
import { createClient } from "@supabase/supabase-js";
import type {
  HourlyData,
  WeeklyData,
  DailyData,
  ProductRank,
  SalesSummaryData,
} from "@/lib/cafe24Data";
import type { MultiChannelData } from "@/lib/multiChannelData";
import type { KakaoSettlement } from "@/lib/finance/kakaoGiftSettlement";
import type { KakaoGiftPo } from "@/lib/finance/kakaoGiftPo";

const HOURS_EMPTY: HourlyData[] = Array.from({ length: 24 }, (_, h) => ({
  hour: String(h),
  orders: 0,
  revenue: 0,
}));
const WEEK_EMPTY: WeeklyData[] = ["월", "화", "수", "목", "금", "토", "일"].map(
  (day) => ({ day, orders: 0, revenue: 0 }),
);

const SHEET_KEY = "kakao_gift_sheet:data";
const SETTLEMENT_PREFIX = "channel_settlement:kakao_gift:";
const CHANNEL_KEY = "channel_upload:kakao_gift";
const PO_PREFIX = "kakao_gift_po:";

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export function settlementKey(year: number, month: number): string {
  return `${SETTLEMENT_PREFIX}${year}-${String(month).padStart(2, "0")}`;
}

export async function saveSheetData(data: MultiChannelData): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  await supabase.from("kv_store").upsert(
    { key: SHEET_KEY, data, updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );
}

export async function saveSettlement(s: KakaoSettlement): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  await supabase.from("kv_store").upsert(
    {
      key: settlementKey(s.year, s.month),
      data: s,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );
}

/** 시트 + 모든 정산서 + 일일 PO → MultiChannelData 빌드 → channel_upload에 저장 */
export async function rebuildKakaoGiftChannelData(): Promise<{
  data: MultiChannelData;
  settlementCount: number;
  poCount: number;
  hasSheet: boolean;
}> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase 미설정");

  // 1. 시트 데이터 로드
  const { data: sheetRow } = await supabase
    .from("kv_store")
    .select("data")
    .eq("key", SHEET_KEY)
    .maybeSingle();
  const sheetData: MultiChannelData | null = (sheetRow?.data as MultiChannelData) ?? null;

  // 2. 모든 정산서 로드
  const { data: settlementRows } = await supabase
    .from("kv_store")
    .select("key, data")
    .like("key", `${SETTLEMENT_PREFIX}%`);
  const settlements: KakaoSettlement[] = ((settlementRows ?? []) as Array<{
    data: KakaoSettlement;
  }>).map((r) => r.data);

  // 2-b. 모든 일일 PO 로드 (Gmail 동기화 결과)
  const { data: poRows } = await supabase
    .from("kv_store")
    .select("data")
    .like("key", `${PO_PREFIX}%`);
  const pos: KakaoGiftPo[] = ((poRows ?? []) as Array<{
    data: KakaoGiftPo;
  }>).map((r) => r.data);

  // 정산서가 있는 달 set ("YYYY-MM")
  const settlementMonths = new Set(
    settlements.map((s) => `${s.year}-${String(s.month).padStart(2, "0")}`),
  );

  // 단가맵 — 모든 정산서 합산해서 product 별 평균 단가
  // PO 의 매출 추정에 사용. PO 에 가격 정보가 없기 때문.
  const priceMap = new Map<string, number>(); // key=상품명, value=평균 단가
  let channelAvgPrice = 0;
  {
    let totalRev = 0;
    let totalQty = 0;
    const perName = new Map<string, { rev: number; qty: number }>();
    for (const s of settlements) {
      for (const p of s.products) {
        const ex = perName.get(p.name) ?? { rev: 0, qty: 0 };
        ex.rev += p.revenue;
        ex.qty += p.sold;
        perName.set(p.name, ex);
        totalRev += p.revenue;
        totalQty += p.sold;
      }
    }
    for (const [name, { rev, qty }] of perName) {
      if (qty > 0) priceMap.set(name, rev / qty);
    }
    if (totalQty > 0) channelAvgPrice = totalRev / totalQty;
  }

  // PO 상품 fuzzy 매칭 — 정확 매칭 실패 시 키워드 substring 매칭, 그래도 없으면 채널 평균
  function resolvePoUnitPrice(productName: string): number {
    const exact = priceMap.get(productName);
    if (exact != null) return exact;
    // 부분 일치 — 정산서 상품명이 PO 상품명에 포함되거나 그 반대
    for (const [name, price] of priceMap) {
      if (productName.includes(name) || name.includes(productName)) return price;
    }
    return channelAvgPrice; // fallback
  }

  // PO 일별 합산 — 같은 날짜에 여러 PO 들어올 수 있어 합산. 단가맵 적용해서 매출 추정.
  const poByDate = new Map<string, { revenue: number; orders: number; qty: number }>();
  for (const po of pos) {
    let rev = 0, qty = 0;
    for (const o of po.orders) {
      const unit = resolvePoUnitPrice(o.product);
      rev += unit * o.qty;
      qty += o.qty;
    }
    const ex = poByDate.get(po.date) ?? { revenue: 0, orders: 0, qty: 0 };
    ex.revenue += rev;
    ex.orders  += po.orders.length;
    ex.qty     += qty;
    poByDate.set(po.date, ex);
  }

  // PO 가 있는 달 set
  const poMonths = new Set<string>();
  for (const date of poByDate.keys()) poMonths.add(date.slice(0, 7));

  // 3. dailyRevenue 우선순위:
  //    (a) 정산서가 있는 달 → 정산서 월 합계 1행 (YYYY-MM-01)
  //    (b) 정산서 없고 PO 있는 달 → PO 일별 entries (이번 달 등)
  //    (c) 정산서/PO 둘 다 없고 시트만 있는 달 → 시트 데이터
  const dailyRevenue: DailyData[] = [];

  for (const s of settlements) {
    dailyRevenue.push({
      date:      `${s.year}-${String(s.month).padStart(2, "0")}-01`,
      revenue:   s.totalRevenue,
      orders:    s.totalSold,
      shipments: s.totalSold,
    });
  }

  for (const [date, agg] of poByDate) {
    const ym = date.slice(0, 7);
    if (settlementMonths.has(ym)) continue; // 정산서 우선
    dailyRevenue.push({
      date,
      revenue:   Math.round(agg.revenue),
      orders:    agg.orders,
      shipments: agg.qty,
    });
  }

  if (sheetData?.dailyRevenue) {
    for (const d of sheetData.dailyRevenue) {
      const ym = d.date.slice(0, 7);
      if (settlementMonths.has(ym) || poMonths.has(ym)) continue; // 더 신선한 소스 우선
      dailyRevenue.push(d);
    }
  }
  dailyRevenue.sort((a, b) => a.date.localeCompare(b.date));

  // 4. topProducts: 모든 정산서 합산 (sku/name 기준)
  const productMap = new Map<
    string,
    { sku: string; name: string; sold: number; revenue: number }
  >();
  for (const s of settlements) {
    for (const p of s.products) {
      const key = p.sku || p.name;
      const ex = productMap.get(key);
      if (ex) {
        ex.sold += p.sold;
        ex.revenue += p.revenue;
        if (!ex.sku && p.sku) ex.sku = p.sku;
      } else {
        productMap.set(key, {
          sku: p.sku,
          name: p.name,
          sold: p.sold,
          revenue: p.revenue,
        });
      }
    }
  }
  // 정산서가 하나도 없으면 시트 topProducts 사용 (1년 누적 추정치)
  const topProducts: ProductRank[] =
    productMap.size > 0
      ? Array.from(productMap.values())
          .sort((a, b) => b.revenue - a.revenue)
          .map((p, i) => ({ ...p, rank: i + 1, image: "" }))
      : sheetData?.topProducts ?? [];

  // 5. salesSummary
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const todayStr = now.toISOString().slice(0, 10);
  const curYM    = todayStr.slice(0, 7);
  const prev = new Date(now);
  prev.setUTCMonth(prev.getUTCMonth() - 1);
  const prevYM = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}`;

  // 7일 전 (포함) — KST 기준
  const weekAgo = new Date(now);
  weekAgo.setUTCDate(weekAgo.getUTCDate() - 6);
  const weekAgoStr = weekAgo.toISOString().slice(0, 10);

  const aggRange = (predicate: (date: string) => boolean) => {
    let revenue = 0, orders = 0;
    for (const d of dailyRevenue) {
      if (predicate(d.date)) { revenue += d.revenue; orders += d.orders; }
    }
    return { revenue, orders, avgOrder: orders > 0 ? Math.round(revenue / orders) : 0 };
  };

  // PO 가 있어 일별 데이터가 있으면 today/week 계산. 정산서만 있는 달은 월합 1행이라 today/week 0.
  const salesSummary: SalesSummaryData = {
    today:     aggRange((d) => d === todayStr),
    week:      aggRange((d) => d >= weekAgoStr && d <= todayStr),
    month:     aggRange((d) => d.startsWith(curYM)),
    prevMonth: aggRange((d) => d.startsWith(prevYM)),
  };

  const data: MultiChannelData = {
    salesSummary,
    topProducts,
    hourlyOrders: HOURS_EMPTY,
    weeklyRevenue: WEEK_EMPTY,
    dailyRevenue,
    inventory: [],
  };

  // 6. channel_upload:kakao_gift에 저장 (다른 채널과 동일 형식: { data, meta })
  const sources: string[] = [];
  if (settlements.length > 0) sources.push(`정산서 ${settlements.length}개월`);
  if (pos.length > 0)         sources.push(`일일발주서 ${pos.length}일`);
  if (sheetData)              sources.push("시트");
  const meta = {
    fileName: sources.length > 0 ? sources.join(" + ") : "데이터 없음",
    rowCount: topProducts.length,
    period: { start: dailyRevenue[0]?.date ?? "", end: dailyRevenue.at(-1)?.date ?? "" },
    uploadedAt: new Date().toISOString(),
  };
  await supabase.from("kv_store").upsert(
    {
      key: CHANNEL_KEY,
      data: { data, meta },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );

  return {
    data,
    settlementCount: settlements.length,
    poCount:         pos.length,
    hasSheet:        !!sheetData,
  };
}
