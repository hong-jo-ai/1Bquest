/**
 * 현대카드 이용내역 Excel 파서.
 *
 * 형식:
 *   행 0: '실시간 이용내역'
 *   행 1: '이용내역'
 *   행 2: 헤더 (승인일/승인시각/카드구분/카드종류/가맹점명/승인금액/이용구분/할부개월/승인번호/취소일/승인구분)
 *   행 3+: 데이터
 *
 * 특이사항:
 *   - 승인시각이 'Sat Dec 30 1899 14:33:00 GMT+0' 같은 형식 (Excel time-only 셀 quirk)
 *     날짜와 합쳐서 정확한 timestamp 만듦
 *   - 승인구분이 '취소' 또는 '취소전표접수'면 cancel_amount = amount, amount = 0 으로 처리
 */
import * as XLSX from "xlsx";

export interface ParsedHyundaiCardTx {
  approvalNo: string;
  cardCompany: string;
  cardNumber: string;
  useDate: Date;
  cancelDate: Date | null;
  merchant: string;
  amount: number;
  cancelAmount: number;
  installment: string;       // 일시불/할부
  isCanceled: boolean;
}

export interface HyundaiCardParseResult {
  rows: ParsedHyundaiCardTx[];
}

function parseNum(v: unknown): number {
  if (typeof v === "number") return v;
  return parseFloat(String(v ?? "0").replace(/,/g, "").replace(/[^\d.\-]/g, "")) || 0;
}

/** "2026년 04월 26일" → Date (시간 0:00) */
function parseKoreanDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const s = String(v).trim();
  const m = s.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
  if (m) {
    const [, y, mo, d] = m;
    return new Date(Number(y), Number(mo) - 1, Number(d));
  }
  // ISO 형식 fallback
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** 시간 추출: "Sat Dec 30 1899 14:33:00 GMT+0900" 또는 "14:33:00" */
function extractTime(v: unknown): { h: number; m: number; s: number } | null {
  if (!v) return null;
  if (v instanceof Date) {
    return { h: v.getHours(), m: v.getMinutes(), s: v.getSeconds() };
  }
  const s = String(v).trim();
  const m = s.match(/(\d{1,2}):(\d{1,2}):(\d{1,2})/);
  if (m) {
    return { h: Number(m[1]), m: Number(m[2]), s: Number(m[3]) };
  }
  return null;
}

export function parseHyundaiCardExcel(buffer: ArrayBuffer): HyundaiCardParseResult {
  const wb = XLSX.read(new Uint8Array(buffer), {
    type: "array",
    cellDates: true,
    cellNF: false,
  });
  if (!wb.SheetNames.length) throw new Error("엑셀에 시트가 없습니다.");

  const ws = wb.Sheets[wb.SheetNames[0]];
  const allRows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });

  // 헤더 행 찾기 ('승인일' + '가맹점명' 포함)
  let headerIdx = -1;
  for (let i = 0; i < Math.min(10, allRows.length); i++) {
    const r = (allRows[i] as unknown[]).map(String);
    if (r.includes("승인일") && r.includes("가맹점명")) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) {
    throw new Error("현대카드 이용내역 헤더(승인일/가맹점명)를 찾을 수 없습니다.");
  }

  const headers = (allRows[headerIdx] as unknown[]).map((c) => String(c).trim());
  const idx = (kw: string) => headers.findIndex((h) => h === kw);

  const cDate = idx("승인일");
  const cTime = idx("승인시각");
  const cCardKind = idx("카드구분");
  const cCardNo = idx("카드종류");
  const cMerchant = idx("가맹점명");
  const cAmount = idx("승인금액");
  const cInstallment = idx("이용구분");
  const cApproval = idx("승인번호");
  const cCancelDate = idx("취소일");
  const cStatus = idx("승인구분");

  if (cDate < 0 || cMerchant < 0 || cAmount < 0 || cApproval < 0) {
    throw new Error(
      `현대카드 형식이 아닙니다. 감지된 헤더: ${headers.join(" | ")}`
    );
  }

  const rows: ParsedHyundaiCardTx[] = [];
  for (let i = headerIdx + 1; i < allRows.length; i++) {
    const r = allRows[i] as unknown[];
    if (!r || r.every((c) => !c)) continue;

    const baseDate = parseKoreanDate(r[cDate]);
    if (!baseDate) continue;
    const approval = String(r[cApproval] ?? "").trim();
    if (!approval) continue;

    // 시간 합치기
    const time = cTime >= 0 ? extractTime(r[cTime]) : null;
    if (time) {
      baseDate.setHours(time.h, time.m, time.s, 0);
    }

    const status = cStatus >= 0 ? String(r[cStatus] ?? "").trim() : "";
    const isCanceled = status.includes("취소");
    const amount = parseNum(r[cAmount]);
    const cancelDateStr = cCancelDate >= 0 ? String(r[cCancelDate] ?? "").trim() : "";
    const cancelDate =
      cancelDateStr && cancelDateStr !== "-" ? parseKoreanDate(cancelDateStr) : null;

    rows.push({
      approvalNo: approval,
      cardCompany: "현대",
      cardNumber: cCardNo >= 0 ? String(r[cCardNo] ?? "").trim() : "",
      useDate: baseDate,
      cancelDate,
      merchant: cMerchant >= 0 ? String(r[cMerchant] ?? "").trim() : "",
      amount: isCanceled ? 0 : amount,
      cancelAmount: isCanceled ? amount : 0,
      installment: cInstallment >= 0 ? String(r[cInstallment] ?? "").trim() : "",
      isCanceled,
    });
  }

  return { rows };
}
