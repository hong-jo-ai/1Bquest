/**
 * 카카오선물하기 일일 발주서 (피오르드/김송이 발송) 파서.
 *
 * 입력 파일 패턴: YYYYMMDD_카카오선물하기_폴바이스(양식).xlsx
 * 시트1 컬럼 (행 0=헤더, 행 1+=주문):
 *   0: 수취인명
 *   1: 수취인 이동통신
 *   2: 수취인 전화번호
 *   3: 수취인 주소
 *   4: 수취인 우편번호
 *   5: 상품명         ← 매출 매칭 키
 *   6: 색상           ← 옵션 (각인문구 등)
 *   7: 수량
 *   8: 배송메세지
 *   9: 주문번호       ← 중복 방지 키
 *  10: 운송장번호
 *
 * 시트2는 면세점/매장 주소 정적 정보 — 무시.
 *
 * 가격 정보가 없어 revenue 는 별도 단가맵에서 룩업해서 머지 단계에서 계산.
 */
import * as XLSX from "xlsx";

export interface KakaoGiftPoOrder {
  orderId:   string;
  recipient: string;
  phone:     string;
  product:   string;
  option:    string;
  qty:       number;
  shipping?: string;
  trackingNo?: string;
}

export interface KakaoGiftPo {
  /** YYYY-MM-DD KST — 보통 파일명 prefix 8자리에서 추출 */
  date:        string;
  /** 원본 파일명 (디버깅/추적용) */
  fileName:    string;
  orders:      KakaoGiftPoOrder[];
  /** 주문 수 (= orders.length) */
  ordersCount: number;
  /** 수량 합 (한 주문에 여러 개 있을 수 있음) */
  totalQty:    number;
}

function toStr(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function toInt(v: unknown): number {
  if (typeof v === "number") return Math.round(v);
  const n = parseInt(String(v ?? "").replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

/** 파일명에서 YYYY-MM-DD 추출. 실패 시 fallback 사용. */
export function dateFromFileName(fileName: string, fallback?: string): string {
  // "20260429_..." 또는 "2026 0429_..." (가끔 공백 끼는 케이스 있음 — 정상화)
  const cleaned = fileName.replace(/\s+/g, "");
  const m = cleaned.match(/(\d{4})(\d{2})(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  if (fallback) return fallback;
  throw new Error(`파일명에서 날짜 추출 실패: ${fileName}`);
}

export function parseKakaoGiftPo(
  buffer: Buffer | ArrayBuffer | Uint8Array,
  fileName: string,
  fallbackDate?: string,
): KakaoGiftPo {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheetName = wb.SheetNames[0]; // sheet1 / Sheet1 변동 가능
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`시트 없음: ${fileName}`);

  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: "",
  });

  if (rows.length < 2) {
    throw new Error(`발주서 행 수 부족: ${fileName} (${rows.length}행)`);
  }

  // 헤더 검증 (느슨하게: 상품명/주문번호/수량 컬럼이 존재하는지)
  const header = (rows[0] ?? []).map(toStr);
  const colProduct = header.findIndex((c) => c.includes("상품명"));
  const colQty     = header.findIndex((c) => c === "수량");
  const colOrderId = header.findIndex((c) => c.includes("주문번호"));
  const colName    = header.findIndex((c) => c.includes("수취인명"));
  const colPhone   = header.findIndex((c) => c.includes("이동통신") || c.includes("전화"));
  const colOption  = header.findIndex((c) => c === "색상" || c.includes("옵션"));
  const colMemo    = header.findIndex((c) => c.includes("배송메세지") || c.includes("배송메시지"));
  const colTrack   = header.findIndex((c) => c.includes("운송장"));

  if (colProduct < 0 || colQty < 0 || colOrderId < 0) {
    throw new Error(`헤더 컬럼 누락 (상품명/수량/주문번호): ${fileName}. 헤더: ${header.join(",")}`);
  }

  const orders: KakaoGiftPoOrder[] = [];
  let totalQty = 0;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((c) => toStr(c) === "")) continue;

    const orderId = toStr(row[colOrderId]);
    const product = toStr(row[colProduct]);
    const qty     = toInt(row[colQty]);
    if (!orderId || !product || qty <= 0) continue; // 빈 행 / 합계행 스킵

    orders.push({
      orderId,
      recipient: colName    >= 0 ? toStr(row[colName])    : "",
      phone:     colPhone   >= 0 ? toStr(row[colPhone])   : "",
      product,
      option:    colOption  >= 0 ? toStr(row[colOption])  : "",
      qty,
      shipping:  colMemo    >= 0 ? toStr(row[colMemo])    : undefined,
      trackingNo: colTrack  >= 0 ? toStr(row[colTrack])   : undefined,
    });
    totalQty += qty;
  }

  return {
    date: dateFromFileName(fileName, fallbackDate),
    fileName,
    orders,
    ordersCount: orders.length,
    totalQty,
  };
}
