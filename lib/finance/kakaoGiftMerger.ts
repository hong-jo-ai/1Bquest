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

/** 시트 + 모든 정산서 → MultiChannelData 빌드 → channel_upload에 저장 */
export async function rebuildKakaoGiftChannelData(): Promise<{
  data: MultiChannelData;
  settlementCount: number;
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

  // 정산서가 있는 달 set ("YYYY-MM")
  const settlementMonths = new Set(
    settlements.map((s) => `${s.year}-${String(s.month).padStart(2, "0")}`),
  );

  // 3. dailyRevenue: 정산서 우선, 없는 달은 시트 데이터
  const dailyRevenue: DailyData[] = [];
  for (const s of settlements) {
    dailyRevenue.push({
      date: `${s.year}-${String(s.month).padStart(2, "0")}-01`,
      revenue: s.totalRevenue,
      orders: s.totalSold,
      shipments: s.totalSold,
    });
  }
  if (sheetData?.dailyRevenue) {
    for (const d of sheetData.dailyRevenue) {
      const ym = d.date.slice(0, 7);
      if (!settlementMonths.has(ym)) dailyRevenue.push(d);
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

  // 5. salesSummary: dailyRevenue 기반 이번달 / 직전달
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const curYM = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const prev = new Date(now);
  prev.setUTCMonth(prev.getUTCMonth() - 1);
  const prevYM = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}`;
  const monthAgg = (ym: string) => {
    const m = dailyRevenue.find((d) => d.date.startsWith(ym));
    if (!m) return { revenue: 0, orders: 0, avgOrder: 0 };
    return {
      revenue: m.revenue,
      orders: m.orders,
      avgOrder: m.orders > 0 ? Math.round(m.revenue / m.orders) : 0,
    };
  };

  const salesSummary: SalesSummaryData = {
    today: { revenue: 0, orders: 0, avgOrder: 0 },
    week: { revenue: 0, orders: 0, avgOrder: 0 },
    month: monthAgg(curYM),
    prevMonth: monthAgg(prevYM),
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
  const meta = {
    fileName: settlements.length > 0
      ? `정산서 ${settlements.length}개월 + 시트`
      : "구글시트",
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
    hasSheet: !!sheetData,
  };
}
