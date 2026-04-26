/**
 * 공동구매 매출 엑셀 파서.
 *
 * 일반 셀러 엑셀(주문 단위)과 다르게 발주일별 집계 형태:
 *   - '날짜별 매출' 시트: 발주일 / 총 판매수량 / 총 매출액 / 수수료(30%) / 순 매출
 *   - '상품별 매출 요약' 시트: 제품별 판매 수량/매출
 *   - 반품/취소는 이미 매출 요약에서 제외됨
 *
 * 출력은 일반 ExcelParseResult와 같은 MultiChannelData 형식으로 변환해서
 * 대시보드 파이프라인이 그대로 사용할 수 있게 함.
 */
import * as XLSX from "xlsx";
import type { MultiChannelData } from "./multiChannelData";
import type { DailyData, ProductRank, HourlyData, WeeklyData } from "./cafe24Data";

export interface GroupBuyParseResult {
  data: MultiChannelData;
  rowCount: number;
  period: { start: string; end: string };
  columns: { date: string; name: string; sku: string; qty: string; revenue: string };
}

const HOURS_EMPTY: HourlyData[] = Array.from({ length: 24 }, (_, h) => ({
  hour: `${String(h).padStart(2, "0")}시`,
  orders: 0,
  revenue: 0,
}));
const WEEK_EMPTY: WeeklyData[] = ["월", "화", "수", "목", "금", "토", "일"].map((day) => ({
  day,
  orders: 0,
  revenue: 0,
}));

function parseNum(val: unknown): number {
  if (typeof val === "number") return val;
  return parseFloat(String(val ?? "0").replace(/,/g, "").replace(/[^\d.-]/g, "")) || 0;
}

/** "4/9" 형태 → "YYYY-MM-DD". 연도가 없으면 현재 연도(KST)로 추정. */
function normalizeDate(raw: unknown): string | null {
  if (!raw) return null;
  if (raw instanceof Date) {
    const y = raw.getFullYear();
    const m = String(raw.getMonth() + 1).padStart(2, "0");
    const d = String(raw.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(raw).trim();
  if (!s) return null;

  // "4/9", "04/09", "2026-04-09", "2026.04.09", "2026/4/9" 등 처리
  const cleaned = s.replace(/\./g, "-").replace(/\//g, "-");
  const parts = cleaned.split("-").map((p) => p.trim());
  const kstYear = new Date(Date.now() + 9 * 60 * 60 * 1000).getUTCFullYear();

  if (parts.length === 2) {
    // M-D
    const [m, d] = parts.map((p) => parseInt(p, 10));
    if (!isNaN(m) && !isNaN(d)) {
      return `${kstYear}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }
  if (parts.length === 3) {
    let [y, m, d] = parts.map((p) => parseInt(p, 10));
    if (y < 100) y += 2000;
    if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
      return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }
  return null;
}

interface SheetIndex {
  daily?: XLSX.WorkSheet;
  productSummary?: XLSX.WorkSheet;
}

function indexSheets(wb: XLSX.WorkBook): SheetIndex {
  const result: SheetIndex = {};
  for (const name of wb.SheetNames) {
    if (name.includes("날짜") && (name.includes("매출") || name.includes("판매"))) {
      result.daily = wb.Sheets[name];
    }
    if (name.includes("상품") && (name.includes("요약") || name.includes("매출"))) {
      result.productSummary = wb.Sheets[name];
    }
  }
  return result;
}

/** "날짜별 매출" 시트의 상단 합계 행(발주일 + 총 매출액)만 추출. */
function extractDailyRevenue(ws: XLSX.WorkSheet): DailyData[] {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });
  const result: DailyData[] = [];
  // 헤더 행 인덱스 찾기
  let headerIdx = -1;
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const row = rows[i].map((c) => String(c));
    if (row.some((c) => c.includes("발주") || c.includes("날짜"))) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) return result;

  // 헤더에서 컬럼 인덱스 찾기
  const headers = rows[headerIdx].map((c) => String(c).replace(/\s+/g, ""));
  const dateCol = headers.findIndex((h) => h.includes("발주") || h.includes("날짜"));
  const qtyCol = headers.findIndex((h) => h.includes("수량") || h.includes("판매수량"));
  const revCol = headers.findIndex((h) => h.includes("매출") || h.includes("총매출"));

  if (dateCol < 0 || revCol < 0) return result;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const dateRaw = row[dateCol];
    const dateStr = String(dateRaw).trim();
    if (!dateStr) continue;
    // '합계', '[날짜별 상품 상세]' 같은 비-날짜 행은 스킵
    if (dateStr.startsWith("[") || dateStr === "합계" || dateStr === "총계") {
      // 이 시점부터는 상세 섹션 — 더 이상 발주일 합계 아니므로 종료
      break;
    }
    const date = normalizeDate(dateRaw);
    if (!date) continue;
    const revenue = Math.round(parseNum(row[revCol]));
    if (revenue === 0) continue;
    const qty = qtyCol >= 0 ? Math.round(parseNum(row[qtyCol])) : 0;
    result.push({
      date,
      revenue,
      orders: qty || 1,
      shipments: 1, // 공동구매는 발주일당 단일 일괄 발송으로 간주
    });
  }
  return result;
}

/** "상품별 매출 요약" 시트에서 topProducts 추출. */
function extractTopProducts(ws: XLSX.WorkSheet): ProductRank[] {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });
  if (rows.length < 2) return [];
  const headers = rows[0].map((c) => String(c).replace(/\s+/g, ""));
  const nameCol = headers.findIndex((h) => h.includes("제품") || h.includes("상품"));
  const qtyCol = headers.findIndex((h) => h === "순판매수량" || h === "판매수량");
  const revCol = headers.findIndex((h) => h.includes("순매출") || h.includes("총매출"));

  if (nameCol < 0 || revCol < 0) return [];

  const items: { name: string; sold: number; revenue: number }[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const name = String(row[nameCol] ?? "").trim();
    if (!name || name === "합계") continue;
    const sold = qtyCol >= 0 ? Math.round(parseNum(row[qtyCol])) : 0;
    const revenue = Math.round(parseNum(row[revCol]));
    if (revenue === 0) continue;
    items.push({ name, sold, revenue });
  }
  return items
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10)
    .map((p, i) => ({
      rank: i + 1,
      name: p.name,
      sku: "",
      sold: p.sold,
      revenue: p.revenue,
      image: "⌚",
    }));
}

export function parseGroupBuyExcel(buffer: ArrayBuffer): GroupBuyParseResult {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(new Uint8Array(buffer), {
      type: "array",
      cellDates: true,
      cellNF: false,
    });
  } catch (e) {
    throw new Error(
      `공동구매 엑셀 파일을 읽을 수 없습니다. 원본 에러: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  const sheets = indexSheets(wb);
  if (!sheets.daily) {
    throw new Error(
      `'날짜별 매출' 시트를 찾을 수 없습니다. 시트 목록: ${wb.SheetNames.join(", ")}`
    );
  }

  const dailyRevenue = extractDailyRevenue(sheets.daily);
  if (dailyRevenue.length === 0) {
    throw new Error(
      "'날짜별 매출' 시트에서 유효한 발주일/매출 데이터를 찾지 못했습니다."
    );
  }

  const topProducts = sheets.productSummary
    ? extractTopProducts(sheets.productSummary)
    : [];

  // 합계 — 일반 파서와 같은 SalesSummaryData 형식
  const totalRevenue = dailyRevenue.reduce((s, d) => s + d.revenue, 0);
  const totalOrders = dailyRevenue.reduce((s, d) => s + d.orders, 0);
  const totalShipments = dailyRevenue.reduce((s, d) => s + (d.shipments ?? 1), 0);

  // today/week/month 분리 (발주일 기준)
  const todayStr = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const weekAgoStr = new Date(Date.now() + 9 * 60 * 60 * 1000 - 7 * 86400000).toISOString().slice(0, 10);
  const monthAgoStr = new Date(Date.now() + 9 * 60 * 60 * 1000 - 30 * 86400000).toISOString().slice(0, 10);

  const sumPeriod = (filter: (d: DailyData) => boolean) => {
    const arr = dailyRevenue.filter(filter);
    const rev = arr.reduce((s, d) => s + d.revenue, 0);
    const ord = arr.reduce((s, d) => s + d.orders, 0);
    return { revenue: rev, orders: ord, avgOrder: ord > 0 ? Math.round(rev / ord) : 0 };
  };

  const data: MultiChannelData = {
    salesSummary: {
      today:     sumPeriod((d) => d.date === todayStr),
      week:      sumPeriod((d) => d.date >= weekAgoStr),
      month:     sumPeriod((d) => d.date >= monthAgoStr),
      prevMonth: { revenue: 0, orders: 0, avgOrder: 0 },
    },
    topProducts,
    hourlyOrders: HOURS_EMPTY, // 공동구매는 시간대 정보 없음
    weeklyRevenue: WEEK_EMPTY, // 요일별 의미 없음 (발주일 단위)
    dailyRevenue,
    inventory: [],
  };

  const dates = dailyRevenue.map((d) => d.date).sort();
  return {
    data,
    rowCount: dailyRevenue.length,
    period: { start: dates[0] ?? "", end: dates[dates.length - 1] ?? "" },
    columns: {
      date: "발주일",
      name: "제품명",
      sku: "(없음)",
      qty: "총 판매수량",
      revenue: "총 매출액",
    },
  };
}
