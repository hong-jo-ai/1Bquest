import * as XLSX from "xlsx";
import type { MultiChannelData } from "./multiChannelData";
import type { ProductRank, HourlyData, WeeklyData } from "./cafe24Data";

// ── 컬럼 키워드 매핑 ─────────────────────────────────────────────────────────
// 매칭 순서: (1) 정확 매칭 → (2) 부분 매칭(includes)
const COL_ALIASES = {
  date:        ["주문일시", "결제일시", "주문일", "결제일", "발주일", "날짜"],
  orderId:     ["주문번호", "주문 번호", "order_no", "order_id", "order no", "order id", "ordersn"],
  name:        ["상품명", "품목명"],
  sku:         ["상품번호", "상품코드", "자체상품코드", "브랜드관리코드", "상품관리코드", "품목코드", "옵션코드", "sku"],
  qty:         ["수량", "주문수량", "판매수량"], // "현재수량"(재고) 회피
  revenue:     ["실결제금액", "결제금액", "매출금액", "판매금액", "판매가격", "판매가", "정산금액", "금액"],
  status:      ["주문상태", "처리상태", "배송상태"],
  claimStatus: ["클레임상태", "환불상태", "반품상태", "claim_status"],
  // 합배송 그룹핑용 — 운송장번호가 있으면 우선 사용 (가장 정확)
  shipmentId:  ["운송장번호", "운송장", "송장번호", "송장"],
  buyer:       ["주문자", "구매자", "주문인"],
  recipient:   ["수령자", "수령인", "받는사람", "수취인", "수취인명"],
  phone:       ["연락처", "전화번호", "휴대폰", "수령자전화", "받는사람전화", "휴대전화"],
  address:     ["주소", "배송지", "수령지", "배송정보", "받는주소"],
};

// '교환' 제외 (교환완료는 매출 인정). 클레임/주문상태에서 이 키워드가 보이면 매출 제외
const CANCEL_KEYWORDS = ["취소", "반품", "환불", "미결제"];
const WEEK_ORDER = ["월", "화", "수", "목", "금", "토", "일"];
const DAY_IDX: Record<number, string> = { 0: "일", 1: "월", 2: "화", 3: "수", 4: "목", 5: "금", 6: "토" };

interface ParsedRow {
  date: Date | null;
  orderId: string;
  name: string;
  sku: string;
  qty: number;
  revenue: number;
  status: string;
  claimStatus: string;
  shipmentId: string;
  buyer: string;
  recipient: string;
  phone: string;
  address: string;
}

/**
 * 주문 수 카운트 — 주문번호 distinct.
 */
function countOrders(rows: ParsedRow[]): number {
  const hasOrderId = rows.some((r) => r.orderId);
  if (!hasOrderId) return rows.length;
  const set = new Set<string>();
  for (const r of rows) {
    if (r.orderId) set.add(r.orderId);
  }
  return set.size;
}

/**
 * 합배송 그룹 카운트.
 * 우선순위: 운송장번호(가장 정확) > (날짜 + 주문자 + 수령인 + 연락처 + 주소) > 주문번호.
 */
function countShipments(rows: ParsedRow[], dateFmt: (d: Date) => string): number {
  const hasShipmentId = rows.some((r) => r.shipmentId);
  const hasIdentity =
    !hasShipmentId && rows.some((r) => r.buyer || r.recipient || r.phone || r.address);

  const set = new Set<string>();
  for (const r of rows) {
    let key: string;
    if (hasShipmentId) {
      // 운송장번호가 있으면 그것만으로 그룹 (가장 신뢰)
      key = r.shipmentId ? `t:${r.shipmentId}` : `o:${r.orderId || JSON.stringify(r)}`;
    } else if (hasIdentity && r.date) {
      const dateStr = dateFmt(r.date);
      key = `${dateStr}|${r.buyer.trim()}|${r.recipient.trim()}|${r.phone.trim()}|${r.address.trim()}`;
    } else {
      key = `o:${r.orderId || JSON.stringify(r)}`;
    }
    set.add(key);
  }
  return set.size;
}

// 헤더 매칭으로 컬럼 인덱스 찾기.
// 1차로 정확 매칭(=)을 모두 시도, 실패 시 부분 매칭(includes)으로 fallback.
// 이렇게 해야 "수량"과 "현재수량" 같이 한쪽이 다른 쪽 부분문자열인 케이스에서
// 의도한 컬럼이 잡힘.
function findColIdx(headers: string[], aliases: string[]): number {
  const norm = headers.map(h => String(h ?? "").replace(/\s+/g, "").toLowerCase());
  // 1차: 정확 매칭
  for (const alias of aliases) {
    const a = alias.toLowerCase().replace(/\s+/g, "");
    const idx = norm.findIndex(h => h === a);
    if (idx !== -1) return idx;
  }
  // 2차: includes 매칭
  for (const alias of aliases) {
    const a = alias.toLowerCase().replace(/\s+/g, "");
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
  const s = String(val).trim().replace(/\s+/g, " ");
  if (!s) return null;

  // "4/9", "4-9", "04/09" 같은 짧은 형식 (연도 없음) → 현재 연도(KST) 부여
  const shortMatch = s.match(/^(\d{1,2})[\/\-.](\d{1,2})$/);
  if (shortMatch) {
    const [, mStr, dStr] = shortMatch;
    const m = parseInt(mStr, 10);
    const d = parseInt(dStr, 10);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      const kstYear = new Date(Date.now() + 9 * 60 * 60 * 1000).getUTCFullYear();
      return new Date(kstYear, m - 1, d);
    }
  }

  const cleaned = s.replace(/\./g, "-");
  const d = new Date(cleaned);
  return isNaN(d.getTime()) ? null : d;
}

// 숫자 파싱 (콤마 제거)
function parseNum(val: unknown): number {
  if (typeof val === "number") return val;
  return parseFloat(String(val ?? "0").replace(/,/g, "").replace(/[^\d.-]/g, "")) || 0;
}

// HTML 엔티티 디코딩
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

/**
 * XML(SpreadsheetML 2003) 또는 HTML 형식의 표를 행 배열로 추출.
 * 무신사 등 일부 셀러센터가 .xls 확장자로 이런 포맷을 내려보냄.
 */
function extractRowsFromMarkup(text: string): unknown[][] {
  const decoded = decodeHtmlEntities(text);
  const rows: unknown[][] = [];

  // <row>(XML) 또는 <tr>(HTML) 모두 처리
  const rowRegex = /<(?:row|tr)\b[^>]*>([\s\S]*?)<\/(?:row|tr)>/gi;
  let m;
  while ((m = rowRegex.exec(decoded)) !== null) {
    const content = m[1];
    const cells: string[] = [];
    // <cell>/<data>(XML) 또는 <td>/<th>(HTML)
    const cellRegex =
      /<(?:cell|td|th)\b[^>]*>([\s\S]*?)<\/(?:cell|td|th)>/gi;
    let c;
    while ((c = cellRegex.exec(content)) !== null) {
      const inner = c[1]
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim();
      cells.push(inner);
    }
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

/**
 * UTF-8 / UTF-16 순으로 텍스트 디코딩 시도.
 */
function tryDecode(buffer: ArrayBuffer): string | null {
  const u8 = new Uint8Array(buffer);
  // UTF-16 BOM
  if (u8.length >= 2 && u8[0] === 0xff && u8[1] === 0xfe) {
    try {
      return new TextDecoder("utf-16le").decode(buffer);
    } catch { /* try other */ }
  }
  if (u8.length >= 2 && u8[0] === 0xfe && u8[1] === 0xff) {
    try {
      return new TextDecoder("utf-16be").decode(buffer);
    } catch { /* try other */ }
  }
  try {
    return new TextDecoder("utf-8").decode(buffer);
  } catch {
    return null;
  }
}

/**
 * SheetJS 파싱이 실패한 경우의 fallback — 텍스트 기반 포맷(XML/HTML) 시도.
 */
function tryParseAsMarkup(buffer: ArrayBuffer): unknown[][] | null {
  const text = tryDecode(buffer);
  if (!text) return null;
  const head = text.slice(0, 1000).toLowerCase();
  const looksLikeMarkup =
    head.includes("<workbook") ||
    head.includes("<?xml") ||
    head.includes("<html") ||
    head.includes("<table") ||
    head.includes("mime-version") ||
    head.includes("<!doctype");
  if (!looksLikeMarkup) return null;
  const rows = extractRowsFromMarkup(text);
  return rows.length > 0 ? rows : null;
}

// ── 메인 파서 ────────────────────────────────────────────────────────────────

export interface ExcelParseResult {
  data: MultiChannelData;
  rowCount: number;
  period: { start: string; end: string };
  columns: { date: string; name: string; sku: string; qty: string; revenue: string };
}

export function parseExcelBuffer(buffer: ArrayBuffer): ExcelParseResult {
  let allRows: unknown[][];
  let sheetName = "(unknown)";

  // 1차: 표준 SheetJS 파싱 (XLSX/XLS/CSV)
  try {
    const wb = XLSX.read(new Uint8Array(buffer), {
      type: "array",
      cellDates: true,
      cellNF: false,
      cellText: false,
    });
    if (!wb.SheetNames || wb.SheetNames.length === 0) {
      throw new Error("엑셀에 시트가 없습니다.");
    }
    sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    allRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as unknown[][];
  } catch (xlsxErr) {
    // 2차: SheetJS가 못 읽으면 XML/HTML 형식으로 추정해 fallback 파싱
    // (무신사 등 일부 셀러센터가 .xls 확장자로 SpreadsheetML/HTML을 내려보냄)
    console.warn(
      "[excelParser] SheetJS 파싱 실패, XML/HTML fallback 시도:",
      xlsxErr instanceof Error ? xlsxErr.message : String(xlsxErr)
    );
    const fallbackRows = tryParseAsMarkup(buffer);
    if (!fallbackRows) {
      throw new Error(
        `파일을 읽을 수 없습니다 (.xlsx / .xls / .csv / XML / HTML 표 형식 지원). 원본 에러: ${xlsxErr instanceof Error ? xlsxErr.message : String(xlsxErr)}`
      );
    }
    allRows = fallbackRows;
    sheetName = "(XML/HTML fallback)";
    console.log("[excelParser] XML/HTML fallback 파싱 성공:", allRows.length, "행");
  }

  // 디버그: 처음 3행을 콘솔에 찍어 진단 도움
  console.log(`[excelParser] 시트 '${sheetName}', 총 ${allRows.length}행`);
  console.log("[excelParser] 처음 3행:", allRows.slice(0, 3).map((r) => r.map((c) => String(c).slice(0, 40))));

  if (allRows.length < 2) {
    throw new Error(
      `엑셀에 데이터가 없습니다. (총 ${allRows.length}행 — 시트: ${sheetName})`
    );
  }

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
  const dateCol        = findColIdx(headers, COL_ALIASES.date);
  const orderIdCol     = findColIdx(headers, COL_ALIASES.orderId);
  const nameCol        = findColIdx(headers, COL_ALIASES.name);
  const skuCol         = findColIdx(headers, COL_ALIASES.sku);
  const qtyCol         = findColIdx(headers, COL_ALIASES.qty);
  const revenueCol     = findColIdx(headers, COL_ALIASES.revenue);
  const statusCol      = findColIdx(headers, COL_ALIASES.status);
  const claimStatusCol = findColIdx(headers, COL_ALIASES.claimStatus);
  const shipmentIdCol  = findColIdx(headers, COL_ALIASES.shipmentId);
  const buyerCol       = findColIdx(headers, COL_ALIASES.buyer);
  const recipientCol   = findColIdx(headers, COL_ALIASES.recipient);
  const phoneCol       = findColIdx(headers, COL_ALIASES.phone);
  const addressCol     = findColIdx(headers, COL_ALIASES.address);

  const allHeadersStr = headers.filter(Boolean).join(" | ");
  if (nameCol === -1 && skuCol === -1) {
    throw new Error(
      `상품명 또는 상품코드 컬럼을 찾을 수 없습니다.\n감지된 헤더 (${headers.length}개): ${allHeadersStr}`
    );
  }
  if (revenueCol === -1) {
    throw new Error(
      `판매금액/결제금액 컬럼을 찾을 수 없습니다.\n감지된 헤더 (${headers.length}개): ${allHeadersStr}`
    );
  }

  // 데이터 행 파싱
  const rows: ParsedRow[] = [];
  for (let i = headerIdx + 1; i < allRows.length; i++) {
    const row = allRows[i] as unknown[];
    if (!row || row.every(c => !c)) continue;

    const status = statusCol >= 0 ? String(row[statusCol] ?? "") : "";
    const claimStatus = claimStatusCol >= 0 ? String(row[claimStatusCol] ?? "") : "";

    // 주문상태 또는 클레임상태에 취소/환불/반품 키워드 포함 시 매출 제외
    if (CANCEL_KEYWORDS.some(k => status.includes(k) || claimStatus.includes(k))) continue;

    const revenue = revenueCol >= 0 ? parseNum(row[revenueCol]) : 0;
    if (revenue === 0 && !status && !claimStatus) continue; // 빈 행 제거

    rows.push({
      date:        dateCol >= 0        ? parseDate(row[dateCol])                  : null,
      orderId:     orderIdCol >= 0     ? String(row[orderIdCol] ?? "").trim()     : "",
      name:        nameCol >= 0        ? String(row[nameCol] ?? "")               : "",
      sku:         skuCol >= 0         ? String(row[skuCol] ?? "")                : "",
      qty:         qtyCol >= 0         ? Math.max(1, parseNum(row[qtyCol]))       : 1,
      revenue,
      status,
      claimStatus,
      shipmentId:  shipmentIdCol >= 0  ? String(row[shipmentIdCol] ?? "").trim()  : "",
      buyer:       buyerCol >= 0       ? String(row[buyerCol] ?? "").trim()       : "",
      recipient:   recipientCol >= 0   ? String(row[recipientCol] ?? "").trim()   : "",
      phone:       phoneCol >= 0       ? String(row[phoneCol] ?? "").trim()       : "",
      address:     addressCol >= 0     ? String(row[addressCol] ?? "").trim()     : "",
    });
  }

  if (rows.length === 0) {
    throw new Error(
      `유효한 주문 데이터가 없습니다 (취소/반품 제외).\n감지된 헤더: ${allHeadersStr}\n총 행: ${allRows.length - headerIdx - 1}`
    );
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

  // 기간별 행 수집 후 distinct 주문 수 산정
  const todayRows: ParsedRow[] = [];
  const weekRows: ParsedRow[] = [];
  const monthRows: ParsedRow[] = [];
  const prevMonthRows: ParsedRow[] = [];

  for (const r of rows) {
    if (!r.date) continue;
    const ry = r.date.getFullYear();
    const rm = r.date.getMonth();
    if (ry === curYear && rm === curMonth) monthRows.push(r);
    if (ry === prevMonthYear && rm === prevMonthMonth) prevMonthRows.push(r);
    if (r.date >= weekAgo) weekRows.push(r);
    if (fmt(r.date) === todayStr) todayRows.push(r);
  }

  const sumRev = (arr: ParsedRow[]) => arr.reduce((s, r) => s + r.revenue, 0);
  const todayRev = sumRev(todayRows);
  const weekRev = sumRev(weekRows);
  const monthRev = sumRev(monthRows);
  const prevMonthRev = sumRev(prevMonthRows);

  const todayOrders = countOrders(todayRows);
  const weekOrders = countOrders(weekRows);
  const monthOrders = countOrders(monthRows);
  const prevMonthOrders = countOrders(prevMonthRows);

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
  const hourBuckets: Record<number, ParsedRow[]> = {};
  for (let h = 0; h < 24; h++) hourBuckets[h] = [];
  for (const r of rows) {
    if (!r.date) continue;
    hourBuckets[r.date.getHours()].push(r);
  }
  const hourlyOrders: HourlyData[] = Object.entries(hourBuckets).map(([h, arr]) => ({
    hour: `${String(h).padStart(2, "0")}시`,
    orders: countOrders(arr),
    revenue: sumRev(arr),
  }));

  // ── 요일별 ────────────────────────────────────────────────────────────────
  const dayBuckets: Record<string, ParsedRow[]> = {};
  for (const d of WEEK_ORDER) dayBuckets[d] = [];
  for (const r of rows) {
    if (!r.date) continue;
    dayBuckets[DAY_IDX[r.date.getDay()]].push(r);
  }
  const weeklyRevenue: WeeklyData[] = WEEK_ORDER.map(day => ({
    day,
    orders: countOrders(dayBuckets[day]),
    revenue: sumRev(dayBuckets[day]),
  }));

  // ── 일별 매출 + 합배송 그룹 (전체 기간) ───────────────────────────────
  const dailyBuckets = new Map<string, ParsedRow[]>();
  for (const r of rows) {
    if (!r.date) continue;
    const ds = fmt(r.date);
    const arr = dailyBuckets.get(ds) ?? [];
    arr.push(r);
    dailyBuckets.set(ds, arr);
  }
  const dailyRevenue = Array.from(dailyBuckets.entries())
    .map(([date, arr]) => ({
      date,
      revenue: Math.round(sumRev(arr)),
      orders: countOrders(arr),
      shipments: countShipments(arr, fmt),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    data: { salesSummary, topProducts, hourlyOrders, weeklyRevenue, dailyRevenue, inventory: [] },
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
