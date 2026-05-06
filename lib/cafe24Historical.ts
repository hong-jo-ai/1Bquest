/**
 * 카페24 과거 매출 히스토리 보조 저장소.
 *
 * 카페24 라이브 API 는 한 번에 한 달 범위만 조회 가능해 `getDashboardData` 가
 * 이번 달 + 지난 달 만 가져온다. 그 이전 기간(예: 1~3개월 이전) 매출은 라이브에
 * 잡히지 않으므로, 사용자가 카페24 어드민에서 주문 CSV 를 내려받아 업로드하면
 * 여기 보조 저장소에 누적해두고 대시보드/매출 히스토리에서 머지해 보여준다.
 *
 * 저장 형식 (channel-uploads 와 동일한 PerUpload 패턴):
 *   key   = `cafe24_historical:{brand}`
 *   value = { uploads: Cafe24HistoricalUpload[] }
 *
 * 동일 fileName 재업로드는 교체, 다른 파일명은 누적.
 */
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import type { Brand } from "./multiChannelData";
import type { DailyData } from "./cafe24Data";

const KEY_PREFIX = "cafe24_historical:";

export interface Cafe24HistoricalUpload {
  fileName: string;
  rowCount: number;
  period: { start: string; end: string };
  uploadedAt: string;
  /** 일별 머지에 쓰이는 핵심 데이터 — date 별 매출/주문/배송 건수 */
  dailyRevenue: DailyData[];
  /** SKU 집계 — 향후 topProducts 머지용. 지금은 저장만, 머지 미사용. */
  topProducts: Array<{ sku: string; name: string; sold: number; revenue: number }>;
}

export interface Cafe24HistoricalRecord {
  uploads: Cafe24HistoricalUpload[];
}

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

// ── CSV 컬럼 추출 ─────────────────────────────────────────────────────────
// 카페24 어드민 → 주문관리 → 주문목록 → CSV 다운로드 시 한국어 헤더로 내려옴.

const COL = {
  orderId:      "주문번호",
  itemOrderId:  "품목별 주문번호",
  totalAmount:  "총 주문금액",     // 쿠폰/할인 적용 전 — 라이브 API total_amount 와 동일 의미
  paidAmount:   "총 결제금액",     // 실제 결제액 (할인 후) — actual_payment_amount
  productNo:    "상품번호",
  productName:  "주문상품명",
  qty:          "수량",
  receiver:     "수령인",
  phone:        "수령인 휴대전화",
  zipcode:      "수령인 우편번호",
  address:      "수령인 주소",
  addressDetail:"수령인 상세 주소",
  paidFlag:     "결제구분",        // "T" = 결제됨, "F" = 미결제(입금전)
  paymentMethod:"결제수단",
  orderDate:    "발주일",          // "YYYY-MM-DD HH:mm:ss"
};

function findIdx(headers: string[], key: string): number {
  const norm = (s: string) => String(s ?? "").replace(/\s+/g, "").trim();
  const target = norm(key);
  return headers.findIndex((h) => norm(h) === target);
}

function parseNum(v: unknown): number {
  if (typeof v === "number") return v;
  const s = String(v ?? "").replace(/[,₩￦\s]/g, "").trim();
  if (!s) return 0;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function parseDateKst(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    // 카페24 export 의 Date 는 KST 시각이 그대로 들어와 있으므로 그대로 사용
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  const s = String(v).trim();
  if (!s) return null;
  // "2026-01-01 09:01:31" 또는 "2026-01-01"
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const [, y, mo, d] = m;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return null;
}

/**
 * 카페24 주문 CSV 를 파싱해 일별 매출/주문/배송 데이터를 생성.
 *
 * 입금전(결제구분 "F" 또는 발주일 빈값) 주문은 매출에서 제외.
 * 매출 = "총 주문금액" (라이브 API 의 total_amount 와 동일).
 * 배송 건수 = (수령인+휴대전화+주소) 동일 그룹을 1건으로 묶음 (합배송).
 * 동일 주문번호는 1건으로 카운트 (CSV 는 품목별로 분리되어 있음).
 */
export function parseCafe24HistoricalCsv(
  buffer: ArrayBuffer | Uint8Array | Buffer,
  fileName: string,
): Cafe24HistoricalUpload {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("CSV 에 시트가 없습니다");
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as unknown[][];
  if (rows.length < 2) throw new Error("CSV 가 비어있거나 헤더만 있습니다");

  const headers = rows[0].map((h) => String(h ?? ""));

  const idx = {
    orderId:       findIdx(headers, COL.orderId),
    totalAmount:   findIdx(headers, COL.totalAmount),
    paidAmount:    findIdx(headers, COL.paidAmount),
    productNo:     findIdx(headers, COL.productNo),
    productName:   findIdx(headers, COL.productName),
    qty:           findIdx(headers, COL.qty),
    receiver:      findIdx(headers, COL.receiver),
    phone:         findIdx(headers, COL.phone),
    address:       findIdx(headers, COL.address),
    addressDetail: findIdx(headers, COL.addressDetail),
    paidFlag:      findIdx(headers, COL.paidFlag),
    orderDate:     findIdx(headers, COL.orderDate),
  };

  if (idx.orderId < 0 || idx.orderDate < 0 || idx.totalAmount < 0) {
    throw new Error(
      `필수 컬럼 누락 — 주문번호/발주일/총 주문금액. 감지된 헤더: ${headers.slice(0, 30).join(", ")}`
    );
  }

  // 1) 행 → 주문 단위 집계 (품목별 → 주문별)
  interface OrderAgg {
    orderId: string;
    date: string;
    revenue: number;       // 주문 총액 (총 주문금액)
    paid: number;          // 결제액 (총 결제금액)
    paidFlag: string;      // T / F
    shipKey: string;       // 합배송 그룹 키
  }
  const orderMap = new Map<string, OrderAgg>();

  // 상품 집계 (topProducts 산출용) — 품목별로
  const productMap = new Map<string, { sku: string; name: string; sold: number; revenue: number }>();

  let dataRows = 0;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length === 0) continue;

    const orderId = String(r[idx.orderId] ?? "").trim();
    if (!orderId) continue;
    dataRows++;

    const paidFlag = idx.paidFlag >= 0 ? String(r[idx.paidFlag] ?? "").trim().toUpperCase() : "T";
    const dateStr = parseDateKst(r[idx.orderDate]);

    // 입금전 제외: 결제구분 "F" 이거나 발주일 빈값
    if (paidFlag === "F" || !dateStr) continue;

    const totalAmount = parseNum(r[idx.totalAmount]);
    const paidAmount = idx.paidAmount >= 0 ? parseNum(r[idx.paidAmount]) : totalAmount;

    // 한 주문이 여러 품목으로 분리된 경우 첫 행의 총 주문금액만 카운트
    if (!orderMap.has(orderId)) {
      const receiver = idx.receiver >= 0 ? String(r[idx.receiver] ?? "").trim() : "";
      const phone = idx.phone >= 0 ? String(r[idx.phone] ?? "").trim() : "";
      const addrA = idx.address >= 0 ? String(r[idx.address] ?? "").trim() : "";
      const addrB = idx.addressDetail >= 0 ? String(r[idx.addressDetail] ?? "").trim() : "";
      const shipKey = `${dateStr}|${receiver}|${phone}|${addrA}${addrB}`;

      orderMap.set(orderId, {
        orderId,
        date: dateStr,
        revenue: totalAmount,
        paid: paidAmount,
        paidFlag,
        shipKey,
      });
    }

    // 품목별 집계 (topProducts)
    const productNo = idx.productNo >= 0 ? String(r[idx.productNo] ?? "").trim() : "";
    const productName = idx.productName >= 0 ? String(r[idx.productName] ?? "").trim() : "";
    const qty = idx.qty >= 0 ? parseNum(r[idx.qty]) || 1 : 1;
    const key = productNo || productName;
    if (key) {
      const cur = productMap.get(key) ?? { sku: productNo, name: productName, sold: 0, revenue: 0 };
      cur.sold += qty;
      // 품목별 매출은 가격 정보가 라인별로 분산되어 있어 단순 합산 불가 → sold 만 우선
      productMap.set(key, cur);
    }
  }

  if (orderMap.size === 0) {
    throw new Error("유효한 결제 완료 주문이 없습니다 (입금전 제외 후 0건)");
  }

  // 2) 일별 집계
  const dayMap = new Map<string, { revenue: number; orderIds: Set<string>; shipKeys: Set<string> }>();
  for (const o of orderMap.values()) {
    const cur = dayMap.get(o.date) ?? { revenue: 0, orderIds: new Set(), shipKeys: new Set() };
    cur.revenue += o.revenue;
    cur.orderIds.add(o.orderId);
    cur.shipKeys.add(o.shipKey);
    dayMap.set(o.date, cur);
  }

  const dailyRevenue: DailyData[] = Array.from(dayMap.entries())
    .map(([date, v]) => ({
      date,
      revenue: Math.round(v.revenue),
      orders: v.orderIds.size,
      shipments: v.shipKeys.size,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const topProducts = Array.from(productMap.values())
    .sort((a, b) => b.sold - a.sold)
    .slice(0, 50);

  const periodStart = dailyRevenue[0]?.date ?? "";
  const periodEnd = dailyRevenue[dailyRevenue.length - 1]?.date ?? "";

  return {
    fileName,
    rowCount: dataRows,
    period: { start: periodStart, end: periodEnd },
    uploadedAt: new Date().toISOString(),
    dailyRevenue,
    topProducts,
  };
}

// ── 저장소 read/write ───────────────────────────────────────────────────────

function normalizeRecord(raw: unknown): Cafe24HistoricalRecord {
  if (raw && typeof raw === "object") {
    const r = raw as { uploads?: unknown };
    if (Array.isArray(r.uploads)) {
      return { uploads: r.uploads as Cafe24HistoricalUpload[] };
    }
  }
  return { uploads: [] };
}

export async function loadCafe24Historical(brand: Brand): Promise<Cafe24HistoricalRecord> {
  const db = getDb();
  if (!db) return { uploads: [] };
  const { data } = await db
    .from("kv_store")
    .select("data")
    .eq("key", `${KEY_PREFIX}${brand}`)
    .maybeSingle();
  return normalizeRecord((data as { data?: unknown } | null)?.data);
}

export async function saveCafe24HistoricalUpload(
  brand: Brand,
  upload: Cafe24HistoricalUpload,
): Promise<{ totalUploads: number }> {
  const db = getDb();
  if (!db) throw new Error("Supabase 미설정 — SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 필요");

  const existing = await loadCafe24Historical(brand);
  // 동일 fileName 은 교체, 다른 파일명은 누적
  const others = existing.uploads.filter((u) => u.fileName !== upload.fileName);
  others.push(upload);
  others.sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt));
  const next: Cafe24HistoricalRecord = { uploads: others };

  const { error } = await db.from("kv_store").upsert(
    { key: `${KEY_PREFIX}${brand}`, data: next, updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );
  if (error) throw new Error(error.message);
  return { totalUploads: next.uploads.length };
}

/**
 * 모든 누적 업로드의 dailyRevenue 를 날짜별로 머지.
 * 동일 날짜는 가장 최근 업로드 값 우선 (정정/재업로드 의도).
 */
export function mergeCafe24HistoricalDaily(record: Cafe24HistoricalRecord): DailyData[] {
  const sorted = [...record.uploads].sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt));
  const map = new Map<string, DailyData>();
  for (const up of sorted) {
    for (const d of up.dailyRevenue) {
      map.set(d.date, d);
    }
  }
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}
