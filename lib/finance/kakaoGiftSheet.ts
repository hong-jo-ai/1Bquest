/**
 * 카카오선물하기 정산 구글시트 파싱.
 *
 * 시트 형식 (행 1: 월 헤더, 행 2: "판매수량/매출" 페어, 행 3+: 데이터):
 *   카카오코드 | 상품명 | 총합계 | 1월         | 2월         | ... | 12월
 *                       |       | 판매수량/매출 | 판매수량/매출 | ... | 판매수량/매출
 *
 * 출력: MultiChannelData
 *   - topProducts: SKU별 총 판매수량/매출
 *   - dailyRevenue: 각 월의 1일자에 그 달 합계 push (월별 시트라 일별 정확도 없음)
 *   - salesSummary: 이번달 / 직전달 / 최근7일(=0) / 오늘(=0) — 일별 데이터 없으니 월 단위만
 */
import type {
  SalesSummaryData,
  ProductRank,
  HourlyData,
  WeeklyData,
  DailyData,
  InventoryItem,
} from "@/lib/cafe24Data";
import type { MultiChannelData } from "@/lib/multiChannelData";

const HOURS_EMPTY: HourlyData[] = Array.from({ length: 24 }, (_, h) => ({
  hour: String(h),
  orders: 0,
  revenue: 0,
}));

const WEEK_EMPTY: WeeklyData[] = ["월", "화", "수", "목", "금", "토", "일"].map((day) => ({
  day,
  orders: 0,
  revenue: 0,
}));

const PERIOD_EMPTY = { revenue: 0, orders: 0, avgOrder: 0 };

function parseNum(v: unknown): number {
  if (typeof v === "number") return v;
  const s = String(v ?? "").replace(/,/g, "").replace(/[^\d.\-]/g, "");
  return parseFloat(s) || 0;
}

/**
 * Sheets API values.get 응답 형태 (rows[][])를 MultiChannelData로 변환.
 *
 * @param rows  values.get → range A1:Z 의 2D 배열 (행 1=월 헤더, 행 2=페어 헤더, 행 3+=데이터)
 * @param year  데이터 연도 (시트엔 연도가 명시 안 됨 → 호출자가 KST 기준 현재 연도 전달)
 */
export function parseKakaoGiftSheet(
  rows: string[][],
  year: number,
): { data: MultiChannelData; rowCount: number } {
  if (rows.length < 3) {
    throw new Error("카카오선물하기 시트가 비어 있거나 형식이 다릅니다.");
  }

  const monthHeader = rows[0]; // 카카오코드 | 상품명 | 총합계 | 1월 | "" | 2월 | ...

  // 월 라벨이 등장하는 컬럼 인덱스 찾기 → 그 다음 컬럼이 매출
  // "총합계"도 월처럼 (수량, 매출) 페어로 다음 행에 있을 수 있음
  const monthCols: { month: number; qtyCol: number; revCol: number }[] = [];
  for (let i = 0; i < monthHeader.length; i++) {
    const cell = String(monthHeader[i] ?? "").trim();
    const m = cell.match(/^(\d{1,2})월$/);
    if (m) {
      const month = Number(m[1]);
      // 다음 행(rows[1])의 i, i+1 컬럼이 "판매수량", "매출"
      monthCols.push({ month, qtyCol: i, revCol: i + 1 });
    }
  }

  if (monthCols.length === 0) {
    throw new Error("월 헤더(1월~12월)를 찾을 수 없습니다.");
  }

  // SKU/상품명 컬럼 추정 — 일반적으로 0=카카오코드(=SKU), 1=상품명
  const SKU_COL = 0;
  const NAME_COL = 1;

  // ── 데이터 행 처리 ──────────────────────────────────────────────────────
  const productByKey = new Map<
    string,
    { sku: string; name: string; sold: number; revenue: number }
  >();
  const monthlyTotals: Record<number, { sold: number; revenue: number }> = {};

  for (let r = 2; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((c) => !c)) continue;

    const sku = String(row[SKU_COL] ?? "").trim();
    const name = String(row[NAME_COL] ?? "").trim();
    if (!sku && !name) continue;

    let totalSold = 0;
    let totalRevenue = 0;
    for (const { month, qtyCol, revCol } of monthCols) {
      const qty = parseNum(row[qtyCol]);
      const rev = parseNum(row[revCol]);
      totalSold += qty;
      totalRevenue += rev;
      if (!monthlyTotals[month]) monthlyTotals[month] = { sold: 0, revenue: 0 };
      monthlyTotals[month].sold += qty;
      monthlyTotals[month].revenue += rev;
    }

    if (totalSold === 0 && totalRevenue === 0) continue; // 빈 상품 행 스킵

    const key = sku || name;
    const existing = productByKey.get(key);
    if (existing) {
      existing.sold += totalSold;
      existing.revenue += totalRevenue;
    } else {
      productByKey.set(key, { sku, name, sold: totalSold, revenue: totalRevenue });
    }
  }

  // ── topProducts ─────────────────────────────────────────────────────────
  const topProducts: ProductRank[] = Array.from(productByKey.values())
    .sort((a, b) => b.revenue - a.revenue)
    .map((p, i) => ({
      rank: i + 1,
      sku: p.sku,
      name: p.name || p.sku,
      sold: p.sold,
      revenue: p.revenue,
      image: "",
    }));

  // ── dailyRevenue: 각 월의 1일자에 그 달 합계 push ──────────────────────
  const dailyRevenue: DailyData[] = [];
  for (const monthStr of Object.keys(monthlyTotals).sort((a, b) => Number(a) - Number(b))) {
    const month = Number(monthStr);
    const t = monthlyTotals[month];
    if (t.sold === 0 && t.revenue === 0) continue;
    const date = `${year}-${String(month).padStart(2, "0")}-01`;
    dailyRevenue.push({
      date,
      revenue: t.revenue,
      orders: t.sold, // 카카오선물하기는 주문수=판매수량으로 처리
      shipments: t.sold,
    });
  }

  // ── salesSummary ───────────────────────────────────────────────────────
  // 일별 데이터 없으니 today/week=0, month=현재월, prevMonth=직전월
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const curMonth = now.getUTCMonth() + 1;
  const prevMonth = curMonth === 1 ? 12 : curMonth - 1;
  const m = monthlyTotals[curMonth] ?? { sold: 0, revenue: 0 };
  const pm = monthlyTotals[prevMonth] ?? { sold: 0, revenue: 0 };

  const salesSummary: SalesSummaryData = {
    today: PERIOD_EMPTY,
    week: PERIOD_EMPTY,
    month: {
      revenue: m.revenue,
      orders: m.sold,
      avgOrder: m.sold > 0 ? Math.round(m.revenue / m.sold) : 0,
    },
    prevMonth: {
      revenue: pm.revenue,
      orders: pm.sold,
      avgOrder: pm.sold > 0 ? Math.round(pm.revenue / pm.sold) : 0,
    },
  };

  const inventory: InventoryItem[] = [];

  return {
    data: {
      salesSummary,
      topProducts,
      hourlyOrders: HOURS_EMPTY,
      weeklyRevenue: WEEK_EMPTY,
      dailyRevenue,
      inventory,
    },
    rowCount: productByKey.size,
  };
}
