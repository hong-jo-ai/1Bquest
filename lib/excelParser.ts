import * as XLSX from "xlsx";
import type { MultiChannelData } from "./multiChannelData";
import type { ProductRank, HourlyData, WeeklyData } from "./cafe24Data";

// ── 컬럼 키워드 매핑 ─────────────────────────────────────────────────────────
const COL_ALIASES = {
  date:    ["주문일시", "주문일", "결제일시", "결제일", "날짜"],
  name:    ["상품명", "품목명"],
  sku:     ["상품코드", "자체상품코드", "브랜드관리코드", "상품관리코드", "품목코드", "옵션코드", "sku"],
  qty:     ["수량", "주문수량", "판매수량"],
  revenue: ["결제금액", "실결제금액", "판매금액", "판매가격", "판매가", "정산금액"],
  status:  ["주문상태", "처리상태", "배송상태"],
};

const CANCEL_KEYWORDS = ["취소", "반품", "환불", "교환", "미결제"];
const WEEK_ORDER = ["월", "화", "수", "목", "금", "토", "일"];
const DAY_IDX: Record<number, string> = { 0: "일", 1: "월", 2: "화", 3: "수", 4: "목", 5: "금", 6: "토" };

interface ParsedRow {
  date: Date | null;
  name: string;
  sku: string;
  qty: number;
  revenue: number;
  status: string;
}

// 헤더 키워드 매칭으로 컬럼 인덱스 찾기
function findColIdx(headers: string[], aliases: string[]): number {
  const norm = headers.map(h => String(h ?? "").replace(/\s+/g, "").toLowerCase());
  for (const alias of aliases) {
    const a = alias.toLowerCase();
    const idx = norm.findIndex(h => h.includes(a));
    if (idx !== -1) return idx;
  }
  return -1;
}

// 날짜 파싱 (문자열 / Date 오브젝트 / Excel 시리얼 넘버)
function parseDate(val: unknown): Date | null {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  if (typeof val === "number") {
    // Excel serial date
    const d = XLSX.SSF.parse_date_code(val);
    if (!d) return null;
    return new Date(d.y, d.m - 1, d.d, d.H ?? 0, d.M ?? 0, d.S ?? 0);
  }
  const s = String(val).trim().replace(/\./g, "-").replace(/\s+/g, " ");
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// 숫자 파싱 (콤마 제거)
function parseNum(val: unknown): number {
  if (typeof val === "number") return val;
  return parseFloat(String(val ?? "0").replace(/,/g, "").replace(/[^\d.-]/g, "")) || 0;
}

// ── 메인 파서 ────────────────────────────────────────────────────────────────

export interface ExcelParseResult {
  data: MultiChannelData;
  rowCount: number;
  period: { start: string; end: string };
  columns: { date: string; name: string; sku: string; qty: string; revenue: string };
}

export function parseExcelBuffer(buffer: ArrayBuffer): ExcelParseResult {
  const wb = XLSX.read(new Uint8Array(buffer), { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const allRows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as unknown[][];

  if (allRows.length < 2) throw new Error("엑셀에 데이터가 없습니다.");

  // 헤더 행 탐색 (최대 10행까지)
  let headerIdx = 0;
  for (let i = 0; i < Math.min(10, allRows.length); i++) {
    const row = allRows[i].map(c => String(c ?? ""));
    const joined = row.join("");
    if (
      joined.includes("주문") ||
      joined.includes("상품") ||
      joined.includes("날짜") ||
      joined.includes("판매") ||
      joined.includes("결제")
    ) {
      headerIdx = i;
      break;
    }
  }

  const headers = allRows[headerIdx].map(c => String(c ?? "").trim());
  const dateCol    = findColIdx(headers, COL_ALIASES.date);
  const nameCol    = findColIdx(headers, COL_ALIASES.name);
  const skuCol     = findColIdx(headers, COL_ALIASES.sku);
  const qtyCol     = findColIdx(headers, COL_ALIASES.qty);
  const revenueCol = findColIdx(headers, COL_ALIASES.revenue);
  const statusCol  = findColIdx(headers, COL_ALIASES.status);

  if (nameCol === -1 && skuCol === -1) {
    throw new Error(
      `상품명 또는 상품코드 컬럼을 찾을 수 없습니다.\n감지된 헤더: ${headers.slice(0, 8).join(", ")}`
    );
  }
  if (revenueCol === -1) {
    throw new Error(
      `판매금액/결제금액 컬럼을 찾을 수 없습니다.\n감지된 헤더: ${headers.slice(0, 8).join(", ")}`
    );
  }

  // 데이터 행 파싱
  const rows: ParsedRow[] = [];
  for (let i = headerIdx + 1; i < allRows.length; i++) {
    const row = allRows[i] as unknown[];
    if (!row || row.every(c => !c)) continue;

    const status = statusCol >= 0 ? String(row[statusCol] ?? "") : "";
    if (CANCEL_KEYWORDS.some(k => status.includes(k))) continue;

    const revenue = revenueCol >= 0 ? parseNum(row[revenueCol]) : 0;
    if (revenue === 0 && !status) continue; // 빈 행 제거

    rows.push({
      date:    dateCol >= 0    ? parseDate(row[dateCol])       : null,
      name:    nameCol >= 0    ? String(row[nameCol] ?? "")    : "",
      sku:     skuCol >= 0     ? String(row[skuCol] ?? "")     : "",
      qty:     qtyCol >= 0     ? Math.max(1, parseNum(row[qtyCol])) : 1,
      revenue,
      status,
    });
  }

  if (rows.length === 0) {
    throw new Error("유효한 주문 데이터가 없습니다. 취소/반품 건을 제외하면 데이터가 0건입니다.");
  }

  // ── 기간 산정 ──────────────────────────────────────────────────────────────
  const dates = rows.map(r => r.date).filter(Boolean) as Date[];
  const minDate = dates.length > 0 ? new Date(Math.min(...dates.map(d => d.getTime()))) : new Date();
  const maxDate = dates.length > 0 ? new Date(Math.max(...dates.map(d => d.getTime()))) : new Date();
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  // ── 매출 요약 ──────────────────────────────────────────────────────────────
  const now = new Date();
  const todayStr      = fmt(now);
  const weekAgo       = new Date(now.getTime() - 7 * 86_400_000);
  // 이번 달: 현재 연/월과 일치하는 행
  const curYear  = now.getFullYear();
  const curMonth = now.getMonth(); // 0-indexed
  // 지난 달
  const prevMonthYear  = curMonth === 0 ? curYear - 1 : curYear;
  const prevMonthMonth = curMonth === 0 ? 11 : curMonth - 1;

  let todayRev = 0,     todayOrders = 0;
  let weekRev = 0,      weekOrders = 0;
  let monthRev = 0,     monthOrders = 0;
  let prevMonthRev = 0, prevMonthOrders = 0;

  for (const r of rows) {
    if (!r.date) continue;
    const ry = r.date.getFullYear();
    const rm = r.date.getMonth();
    // 이번달
    if (ry === curYear && rm === curMonth) {
      monthRev    += r.revenue;
      monthOrders += r.qty;
    }
    // 지난달
    if (ry === prevMonthYear && rm === prevMonthMonth) {
      prevMonthRev    += r.revenue;
      prevMonthOrders += r.qty;
    }
    // 이번주 (최근 7일)
    if (r.date >= weekAgo) {
      weekRev    += r.revenue;
      weekOrders += r.qty;
    }
    // 오늘
    if (fmt(r.date) === todayStr) {
      todayRev    += r.revenue;
      todayOrders += r.qty;
    }
  }

  const salesSummary = {
    today:     { revenue: todayRev,     orders: todayOrders,     avgOrder: todayOrders     > 0 ? Math.round(todayRev     / todayOrders)     : 0 },
    week:      { revenue: weekRev,      orders: weekOrders,      avgOrder: weekOrders      > 0 ? Math.round(weekRev      / weekOrders)      : 0 },
    month:     { revenue: monthRev,     orders: monthOrders,     avgOrder: monthOrders     > 0 ? Math.round(monthRev     / monthOrders)     : 0 },
    prevMonth: { revenue: prevMonthRev, orders: prevMonthOrders, avgOrder: prevMonthOrders > 0 ? Math.round(prevMonthRev / prevMonthOrders) : 0 },
  };

  // ── 상품 순위 ──────────────────────────────────────────────────────────────
  const productMap = new Map<string, { name: string; sku: string; sold: number; revenue: number }>();
  for (const r of rows) {
    const key = (r.sku || r.name).trim();
    if (!key) continue;
    const cur = productMap.get(key) ?? { name: r.name, sku: r.sku, sold: 0, revenue: 0 };
    cur.sold    += r.qty;
    cur.revenue += r.revenue;
    productMap.set(key, cur);
  }
  const topProducts: ProductRank[] = Array.from(productMap.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10)
    .map((p, i) => ({ rank: i + 1, name: p.name, sku: p.sku, sold: p.sold, revenue: p.revenue, image: "⌚" }));

  // ── 시간대별 ──────────────────────────────────────────────────────────────
  const hourMap: Record<number, { orders: number; revenue: number }> = {};
  for (let h = 0; h < 24; h++) hourMap[h] = { orders: 0, revenue: 0 };
  for (const r of rows) {
    if (!r.date) continue;
    const h = r.date.getHours();
    hourMap[h].orders  += r.qty;
    hourMap[h].revenue += r.revenue;
  }
  const hourlyOrders: HourlyData[] = Object.entries(hourMap).map(([h, v]) => ({
    hour: `${String(h).padStart(2, "0")}시`,
    orders: v.orders,
    revenue: v.revenue,
  }));

  // ── 요일별 ────────────────────────────────────────────────────────────────
  const dayMap: Record<string, { orders: number; revenue: number }> = {};
  for (const d of WEEK_ORDER) dayMap[d] = { orders: 0, revenue: 0 };
  for (const r of rows) {
    if (!r.date) continue;
    const day = DAY_IDX[r.date.getDay()];
    dayMap[day].orders  += r.qty;
    dayMap[day].revenue += r.revenue;
  }
  const weeklyRevenue: WeeklyData[] = WEEK_ORDER.map(day => ({
    day,
    orders: dayMap[day].orders,
    revenue: dayMap[day].revenue,
  }));

  return {
    data: { salesSummary, topProducts, hourlyOrders, weeklyRevenue, inventory: [] },
    rowCount: rows.length,
    period: { start: fmt(minDate), end: fmt(maxDate) },
    columns: {
      date:    dateCol >= 0    ? headers[dateCol]    : "(없음)",
      name:    nameCol >= 0    ? headers[nameCol]    : "(없음)",
      sku:     skuCol >= 0     ? headers[skuCol]     : "(없음)",
      qty:     qtyCol >= 0     ? headers[qtyCol]     : "(없음)",
      revenue: revenueCol >= 0 ? headers[revenueCol] : "(없음)",
    },
  };
}
