/**
 * 네이버페이 영수증 Excel 파서 (카드영수증 / 현금영수증 두 형식 통합).
 *
 * 카드영수증 헤더:
 *   승인번호 / 카드사 / 카드번호(유효기간) / 거래종류/할부 / 결제일자 / 취소일자
 *   / 상품명 / 승인금액 / 취소금액 / 공급가액 / 부가세액 / 봉사료 / 컵보증금 / 합계
 *
 * 현금영수증 헤더:
 *   승인번호 / 주문번호/상품 주문번호 / 구매자 발행번호 / 발행방법 / 신청구분
 *   / 발행일자 / 상품명 / 공급가액 / 부가세액 / 봉사료 / 합계
 *
 * 첫 행이 헤더인 단순 형식. 카드/현금 자동 감지.
 */
import * as XLSX from "xlsx";

export type NpayReceiptType = "card" | "cash";

export interface ParsedNpayReceipt {
  approvalNo: string;
  receiptType: NpayReceiptType;
  cardCompany: string;        // 카드영수증=카드사, 현금영수증="현금영수증"
  cardNumber: string;
  useDate: Date;
  cancelDate: Date | null;
  merchant: string;          // 상품명
  amount: number;
  cancelAmount: number;
  supplyAmount: number;
  taxAmount: number;
  installment: string;
  total: number;
}

export interface NpayParseResult {
  rows: ParsedNpayReceipt[];
}

function parseNum(v: unknown): number {
  if (typeof v === "number") return v;
  return parseFloat(String(v ?? "0").replace(/,/g, "").replace(/[^\d.\-]/g, "")) || 0;
}

function parseDateTime(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const s = String(v).trim();
  if (!s) return null;
  // "2026-01-30 10:30:31"
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{1,2}):(\d{1,2})$/);
  if (m) {
    const [, y, mo, d, h, mi, sec] = m;
    return new Date(
      Number(y), Number(mo) - 1, Number(d),
      Number(h), Number(mi), Number(sec)
    );
  }
  const m2 = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m2) {
    const [, y, mo, d] = m2;
    return new Date(Number(y), Number(mo) - 1, Number(d));
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export function parseNpayReceiptExcel(buffer: ArrayBuffer): NpayParseResult {
  const wb = XLSX.read(new Uint8Array(buffer), {
    type: "array",
    cellDates: true,
    cellNF: false,
  });
  if (!wb.SheetNames.length) throw new Error("엑셀에 시트가 없습니다.");

  const ws = wb.Sheets[wb.SheetNames[0]];
  const allRows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });
  if (allRows.length < 2) throw new Error("네이버페이 영수증 데이터가 없습니다.");

  // 첫 행이 헤더
  const headers = (allRows[0] as unknown[]).map((c) => String(c).trim());
  const idx = (kw: string) => headers.findIndex((h) => h === kw);

  const cApproval = idx("승인번호");
  const cCard = idx("카드사");
  const cCardNo = idx("카드번호(유효기간)");
  const cKind = idx("거래종류/할부");
  // 결제일자(카드) 또는 발행일자(현금) — 어느 쪽이든 사용
  const cUseDate = idx("결제일자") >= 0 ? idx("결제일자") : idx("발행일자");
  const cCancelDate = idx("취소일자");
  const cMerchant = idx("상품명");
  // 승인금액(카드) 또는 합계(현금) — 결제 금액으로 사용
  const cAmount = idx("승인금액");
  const cCancelAmount = idx("취소금액");
  const cSupply = idx("공급가액");
  const cTax = idx("부가세액");
  const cTotal = idx("합계");
  // 현금영수증 전용
  const cIssueMethod = idx("발행방법");

  // 카드 또는 현금 영수증으로 인식 가능한지 검증
  const hasAmountSource = cAmount >= 0 || cTotal >= 0;
  if (cApproval < 0 || cUseDate < 0 || !hasAmountSource) {
    throw new Error(
      `네이버페이 영수증 형식이 아닙니다. 감지된 헤더: ${headers.join(" | ")}`
    );
  }

  // 카드영수증인지 현금영수증인지 자동 감지
  const isCard = cCard >= 0 && cAmount >= 0;
  const receiptType: NpayReceiptType = isCard ? "card" : "cash";

  const rows: ParsedNpayReceipt[] = [];
  for (let i = 1; i < allRows.length; i++) {
    const r = allRows[i] as unknown[];
    if (!r || r.every((c) => !c)) continue;

    const useDate = parseDateTime(r[cUseDate]);
    if (!useDate) continue;
    const approvalNo = String(r[cApproval] ?? "").trim();
    if (!approvalNo) continue;

    // 결제 금액: 카드는 승인금액, 현금은 합계
    const amount =
      cAmount >= 0 ? parseNum(r[cAmount]) :
      cTotal >= 0 ? parseNum(r[cTotal]) : 0;

    // cardCompany 표시: 카드영수증은 카드사명, 현금영수증은 발행방법(예: "소득공제용")
    const cardCompany = isCard
      ? (cCard >= 0 ? String(r[cCard] ?? "").trim() : "")
      : `현금영수증${cIssueMethod >= 0 && r[cIssueMethod] ? ` (${String(r[cIssueMethod]).trim()})` : ""}`;

    rows.push({
      approvalNo,
      receiptType,
      cardCompany,
      cardNumber: cCardNo >= 0 ? String(r[cCardNo] ?? "").trim() : "",
      useDate,
      cancelDate: cCancelDate >= 0 ? parseDateTime(r[cCancelDate]) : null,
      merchant: cMerchant >= 0 ? String(r[cMerchant] ?? "").trim() : "",
      amount,
      cancelAmount: cCancelAmount >= 0 ? parseNum(r[cCancelAmount]) : 0,
      supplyAmount: cSupply >= 0 ? parseNum(r[cSupply]) : 0,
      taxAmount: cTax >= 0 ? parseNum(r[cTax]) : 0,
      installment: cKind >= 0 ? String(r[cKind] ?? "").trim() : "",
      total: cTotal >= 0 ? parseNum(r[cTotal]) : 0,
    });
  }

  return { rows };
}

/**
 * 카드 사용 항목 자동 분류 (상품명/가맹점명 텍스트 기반).
 */
export function categorizeCardUsage(merchant: string): string {
  const m = merchant.toLowerCase();

  // 매입 (포장재 / 자재 / 부자재)
  if (/뽁뽁이|에어캡|박스|포장|패키지|봉투|테이프|스티커|라벨/.test(merchant)) return "매입";
  if (/^[A-Z]형\s*\d/.test(merchant)) return "매입"; // "A형 280x260x120" 같은 박스 규격

  // 광고비
  if (/광고|마케팅|배너|상위노출|키워드/.test(merchant)) return "광고비";
  if (/facebook|meta|google|kakao|naver\s*ad/i.test(m)) return "광고비";

  // 소프트웨어 / 구독
  if (/saas|구독|월정액|클라우드|aws|github|notion|figma|chatgpt|claude/i.test(m)) return "소프트웨어";
  if (/dji|드론|카메라|액션캠/i.test(m)) return "소프트웨어"; // 촬영 장비

  // 통신비
  if (/skt|kt\b|lgu\+|통신/i.test(m)) return "통신비";

  // 택배비
  if (/택배|배송|운송|cj대한통운|한진|로젠/.test(merchant)) return "택배비";

  // 식비 / 경조사
  if (/꽃다발|화환|근조|축하|결혼|장례|조의|부고|개업/.test(merchant)) return "기타"; // 경조사
  if (/스타벅스|커피|이디야|투썸|맥도날드|버거킹|식당|레스토랑|배달의민족|쿠팡이츠/.test(merchant)) return "식비";

  // 사무용품 / 매입원가가 아닌 일반 비품
  if (/배터리|충전기|케이블|usb|메모리|어댑터/i.test(m)) return "기타";

  return "기타";
}
