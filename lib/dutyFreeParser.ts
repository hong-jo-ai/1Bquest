/**
 * 면세점 월 정산서 파서 — 밴더사 제드아이티씨(JEDITC) 경유.
 *
 * 롯데/신세계 면세점은 각각 형식이 다르지만, 우리가 매출로 잡는 값은
 * "세금계산서 발행요청 금액(= 수수료 12% 제외 입금예정액)" 으로 동일하다.
 *
 *   - 롯데  : 시트 ['롯데 N월', 'N월 수불부', '현재고(...)'] — 제품 단위 월합계(일자 없음)
 *   - 신세계: 시트 ['JEDITC 정산내역', 'N월매출', 'N월 기말재고'] — 거래 단위 명세
 *
 * 월 정산이므로 일별 데이터는 없다. 매출은 "정산월 말일" 단일 dailyRevenue
 * 항목으로 넣어 그 달 매출로 집계되게 한다(대시보드는 dailyRevenue 날짜 버킷
 * 으로 모든 기간 카드를 계산함 — SalesSummary / mergeUploads 참고).
 */
import * as XLSX from "xlsx";
import type { ExcelParseResult } from "@/lib/excelParser";
import type { MultiChannelData } from "@/lib/multiChannelData";
import type { ProductRank } from "@/lib/cafe24Data";

export type DutyFreeOperator = "lotte" | "shinsegae";

interface AggProduct {
  sku: string;
  name: string;
  units: number;
  gross: number; // 정산금액(공급가 기준) — 순(net) 안분에만 사용
}

function num(v: unknown): number {
  if (typeof v === "number") return v;
  const n = parseFloat(String(v ?? "").replace(/,/g, "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function norm(s: unknown): string {
  return String(s ?? "").replace(/\s+/g, "").toLowerCase();
}

/** 워크북을 시트별 행 배열(2차원)로 읽는다. header:1 → 각 행이 셀 배열. */
function readSheets(buffer: ArrayBuffer): { name: string; rows: unknown[][] }[] {
  const wb = XLSX.read(new Uint8Array(buffer), { type: "array", cellDates: false });
  return wb.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "" }) as unknown[][],
  }));
}

/** 요약 시트에서 입금예정액(세금계산서 발행요청 금액)과 정산월을 찾는다. */
function extractSummary(rows: unknown[][]): { net: number; ym: { y: number; m: number } | null } {
  let net = 0;
  let ym: { y: number; m: number } | null = null;

  for (const row of rows) {
    const joined = row.map((c) => String(c ?? "")).join(" ");
    // 입금예정 = '세금계산서 발행요청 금액' 행의 첫 큰 숫자
    if (net === 0 && joined.includes("세금계산서 발행요청")) {
      for (const c of row) {
        const v = num(c);
        if (v > 1000) { net = v; break; }
      }
    }
    // 정산월 'YYYY년 M월'
    if (!ym) {
      const m = joined.match(/(\d{4})\s*년\s*(\d{1,2})\s*월/);
      if (m) ym = { y: parseInt(m[1], 10), m: parseInt(m[2], 10) };
    }
  }
  return { net, ym };
}

/** 헤더 행 인덱스 + 별칭으로 컬럼 인덱스 찾기. 못 찾으면 -1. */
function findCol(header: unknown[], aliases: string[]): number {
  const cells = header.map(norm);
  for (let i = 0; i < cells.length; i++) {
    if (aliases.some((a) => cells[i].includes(norm(a)))) return i;
  }
  return -1;
}

/** 제품 명세 시트에서 SKU별 판매수량·정산금액을 집계한다(operator별 형식 분기). */
function extractProducts(
  sheets: { name: string; rows: unknown[][] }[],
  operator: DutyFreeOperator,
): { products: AggProduct[]; totalUnits: number; rowCount: number } {
  const agg = new Map<string, AggProduct>();
  let totalUnits = 0;
  let rowCount = 0;

  if (operator === "shinsegae") {
    // 거래 단위: 구분 | 판매일자 | Ref.No | 상품코드 | 상품명 | 판매수량 | 정산단가 | 판매원가 | 부가세 | 정산금액
    const sheet = sheets.find((s) => s.rows.some((r) => r.some((c) => norm(c) === norm("상품코드")) && r.some((c) => norm(c).includes("판매수량"))));
    if (!sheet) return { products: [], totalUnits: 0, rowCount: 0 };
    const hIdx = sheet.rows.findIndex((r) => r.some((c) => norm(c) === norm("상품코드")));
    const H = sheet.rows[hIdx];
    const cGubun = findCol(H, ["구분"]);
    const cCode = findCol(H, ["상품코드"]);
    const cName = findCol(H, ["상품명"]);
    const cQty = findCol(H, ["판매수량"]);
    const cAmt = findCol(H, ["정산금액"]);
    for (let i = hIdx + 1; i < sheet.rows.length; i++) {
      const r = sheet.rows[i];
      const code = String(r[cCode] ?? "").trim();
      if (!code) continue;
      const sign = String(r[cGubun] ?? "").includes("반품") ? -1 : 1;
      const qty = sign * num(r[cQty]);
      const amt = sign * num(r[cAmt]);
      rowCount++;
      const a = agg.get(code) ?? { sku: code, name: String(r[cName] ?? "").trim(), units: 0, gross: 0 };
      a.units += qty; a.gross += amt;
      agg.set(code, a);
    }
  } else {
    // 롯데 수불부: No | SKU NO | 상품명 | REF NO | ... | 기간내판매수량 | 기간내판매금액(USD) | POS판매원가(KRW) | 잔여재고...
    const sheet = sheets.find((s) => s.rows.some((r) => r.some((c) => norm(c).includes("skuno")) && r.some((c) => norm(c).includes("판매수량"))));
    if (!sheet) return { products: [], totalUnits: 0, rowCount: 0 };
    const hIdx = sheet.rows.findIndex((r) => r.some((c) => norm(c).includes("skuno")));
    const H = sheet.rows[hIdx];
    const cSku = findCol(H, ["skuno", "sku"]);
    const cName = findCol(H, ["상품명"]);
    const cQty = findCol(H, ["기간내판매수량", "판매수량"]);
    const cAmt = findCol(H, ["pos판매원가", "판매원가"]);
    for (let i = hIdx + 1; i < sheet.rows.length; i++) {
      const r = sheet.rows[i];
      const sku = String(r[cSku] ?? "").trim();
      const name = String(r[cName] ?? "").trim();
      if (!sku || norm(name) === norm("합계")) continue;
      const qty = num(r[cQty]);
      const amt = num(r[cAmt]);
      if (qty <= 0 && amt <= 0) continue; // 미판매 품목은 건수에서 제외
      rowCount++;
      agg.set(sku, { sku, name, units: qty, gross: amt });
    }
  }

  const products = [...agg.values()].filter((p) => p.units !== 0 || p.gross !== 0);
  totalUnits = products.reduce((s, p) => s + p.units, 0);
  return { products, totalUnits, rowCount };
}

function lastDayOfMonth(y: number, m: number): string {
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); // m: 1-based → day 0 of next month
  return `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}

const OPERATOR_LABEL: Record<DutyFreeOperator, string> = {
  lotte: "롯데면세점",
  shinsegae: "신세계면세점",
};

export function parseDutyFreeSettlement(
  buffer: ArrayBuffer,
  operator: DutyFreeOperator,
): ExcelParseResult {
  const sheets = readSheets(buffer);
  if (sheets.length === 0) throw new Error("정산서에 시트가 없습니다.");

  const { net, ym } = extractSummary(sheets[0]);
  if (net <= 0) {
    throw new Error(
      `${OPERATOR_LABEL[operator]} 정산서에서 '세금계산서 발행요청 금액(입금예정액)'을 찾지 못했습니다. JEDITC 정산서 형식이 맞는지 확인해주세요.`,
    );
  }
  if (!ym) {
    throw new Error(`${OPERATOR_LABEL[operator]} 정산서에서 정산월(YYYY년 M월)을 찾지 못했습니다.`);
  }

  const { products, totalUnits, rowCount } = extractProducts(sheets, operator);

  // 상위 상품 — 정산금액 비중으로 net(입금예정액)을 안분해 채널 합계와 일치시킴
  const grossTotal = products.reduce((s, p) => s + Math.max(0, p.gross), 0) || 1;
  const topProducts: ProductRank[] = products
    .filter((p) => p.units > 0)
    .sort((a, b) => b.gross - a.gross)
    .slice(0, 10)
    .map((p, i) => ({
      rank: i + 1,
      name: p.name,
      sku: p.sku,
      sold: Math.round(p.units),
      revenue: Math.round((Math.max(0, p.gross) / grossTotal) * net),
      image: "",
    }));

  const dateStr = lastDayOfMonth(ym.y, ym.m);
  const orders = Math.max(0, Math.round(totalUnits));
  const monthPeriod = { revenue: net, orders, avgOrder: orders > 0 ? Math.round(net / orders) : 0 };
  const EMPTY = { revenue: 0, orders: 0, avgOrder: 0 };

  // 다른 채널과 동일한 빈 배열 형태(24시간/7일) — merge/차트가 길이를 가정해도 안전.
  const hourlyOrders = Array.from({ length: 24 }, (_, h) => ({
    hour: `${String(h).padStart(2, "0")}시`, orders: 0, revenue: 0,
  }));
  const weeklyRevenue = ["월", "화", "수", "목", "금", "토", "일"].map((day) => ({ day, revenue: 0, orders: 0 }));

  const data: MultiChannelData = {
    salesSummary: { today: EMPTY, week: EMPTY, month: monthPeriod, prevMonth: EMPTY },
    topProducts,
    hourlyOrders,
    weeklyRevenue,
    dailyRevenue: [{ date: dateStr, revenue: net, orders }],
    inventory: [],
  };

  const monthStart = `${ym.y}-${String(ym.m).padStart(2, "0")}-01`;
  return {
    data,
    rowCount,
    period: { start: monthStart, end: dateStr },
    columns: {
      date: "정산월",
      name: "상품명",
      sku: "상품코드",
      qty: "판매수량",
      revenue: "입금예정액(수수료 12% 제외)",
    },
  };
}
