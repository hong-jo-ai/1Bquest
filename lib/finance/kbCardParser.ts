/**
 * KB국민카드 이용내역 Excel 파서.
 *
 * 형식:
 *   행 0~5: 메타 (조회기간, 카드번호, 정상/취소 합계 등)
 *   행 6:   헤더
 *   행 7+:  데이터
 *
 * 헤더 컬럼:
 *   이용일 / 이용시간 / 이용고객명 / 이용카드명 / 이용하신곳 /
 *   국내이용금액(원) / 해외이용금액($) / 결제방법 / 가맹점정보 /
 *   할인금액 / 적립(예상)포인트리 / 상태 / 결제예정일 / 승인번호
 *
 * 특이사항:
 *   - 상태 = '승인취소' 또는 '취소전표매입' 이면 cancel 처리
 *   - 해외 건은 USD 금액만 있고 KRW 환산이 없음 →
 *     amount=0, merchant 앞에 '[해외$xx.xx] ' 접두어 + raw에 usdAmount 보존
 *   - 같은 (승인번호, 이용일) 조합으로 중복 판정
 */
import * as XLSX from "xlsx";

export interface ParsedKbCardTx {
  approvalNo: string;
  cardCompany: string;
  cardNumber: string;          // 이용카드명 (예: "KB국민 nori 체크카드")
  useDate: Date;
  cancelDate: Date | null;
  merchant: string;
  amount: number;              // 국내 KRW (해외건은 0)
  cancelAmount: number;
  installment: string;         // 일시불/할부
  isCanceled: boolean;
  isForeign: boolean;
  usdAmount: number;
}

export interface KbCardParseResult {
  rows: ParsedKbCardTx[];
}

function parseNum(v: unknown): number {
  if (typeof v === "number") return v;
  return parseFloat(String(v ?? "0").replace(/,/g, "").replace(/[^\d.\-]/g, "")) || 0;
}

function parseIsoDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const s = String(v).trim();
  // "2026-04-27" or "2026-04-27 10:05:00"
  const m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const [, y, mo, d] = m;
    return new Date(Number(y), Number(mo) - 1, Number(d));
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function extractTime(v: unknown): { h: number; m: number } | null {
  if (!v) return null;
  if (v instanceof Date) return { h: v.getHours(), m: v.getMinutes() };
  const s = String(v).trim();
  const m = s.match(/(\d{1,2}):(\d{1,2})/);
  if (m) return { h: Number(m[1]), m: Number(m[2]) };
  return null;
}

export function parseKbCardExcel(buffer: ArrayBuffer): KbCardParseResult {
  const wb = XLSX.read(new Uint8Array(buffer), {
    type: "array",
    cellDates: true,
    cellNF: false,
  });
  if (!wb.SheetNames.length) throw new Error("엑셀에 시트가 없습니다.");

  const ws = wb.Sheets[wb.SheetNames[0]];
  const allRows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });

  // 헤더 행 찾기 ('이용일' + '이용하신곳' + '승인번호' 포함)
  let headerIdx = -1;
  for (let i = 0; i < Math.min(15, allRows.length); i++) {
    const r = (allRows[i] as unknown[]).map((c) => String(c).replace(/\s+/g, ""));
    if (r.includes("이용일") && r.includes("이용하신곳") && r.includes("승인번호")) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) {
    throw new Error("KB카드 이용내역 헤더(이용일/이용하신곳/승인번호)를 찾을 수 없습니다.");
  }

  const headers = (allRows[headerIdx] as unknown[]).map((c) =>
    String(c).replace(/\s+/g, "")
  );
  const idx = (kw: string) => headers.findIndex((h) => h === kw);

  const cDate = idx("이용일");
  const cTime = idx("이용시간");
  const cCardName = idx("이용카드명");
  const cMerchant = idx("이용하신곳");
  const cKrw = idx("국내이용금액(원)");
  const cUsd = idx("해외이용금액($)");
  const cInstallment = idx("결제방법");
  const cStatus = idx("상태");
  const cApproval = idx("승인번호");

  if (cDate < 0 || cMerchant < 0 || cApproval < 0) {
    throw new Error(
      `KB카드 형식이 아닙니다. 감지된 헤더: ${headers.join(" | ")}`
    );
  }

  const rows: ParsedKbCardTx[] = [];
  for (let i = headerIdx + 1; i < allRows.length; i++) {
    const r = allRows[i] as unknown[];
    if (!r || r.every((c) => !c)) continue;

    const baseDate = parseIsoDate(r[cDate]);
    if (!baseDate) continue;
    const approval = String(r[cApproval] ?? "").trim();
    if (!approval) continue;

    if (cTime >= 0) {
      const t = extractTime(r[cTime]);
      if (t) baseDate.setHours(t.h, t.m, 0, 0);
    }

    const status = cStatus >= 0 ? String(r[cStatus] ?? "").trim() : "";
    // '승인취소' 또는 '취소전표매입' → 취소건
    const isCanceled = status === "승인취소" || status === "취소전표매입";

    const krw = cKrw >= 0 ? parseNum(r[cKrw]) : 0;
    const usd = cUsd >= 0 ? parseNum(r[cUsd]) : 0;
    const isForeign = krw <= 0 && usd > 0;

    const rawMerchant = cMerchant >= 0 ? String(r[cMerchant] ?? "").trim() : "";
    const merchant = isForeign
      ? `[해외$${usd.toFixed(2)}] ${rawMerchant}`
      : rawMerchant;

    // 해외건은 KRW 환산이 없으므로 amount = 0 (사용자가 명세서 환율로 보정)
    const baseAmount = isForeign ? 0 : krw;

    rows.push({
      approvalNo: approval,
      cardCompany: "KB국민",
      cardNumber: cCardName >= 0 ? String(r[cCardName] ?? "").trim() : "",
      useDate: baseDate,
      cancelDate: null, // KB카드 양식엔 별도 취소일 컬럼 없음 (상태로만 판별)
      merchant,
      amount: isCanceled ? 0 : baseAmount,
      cancelAmount: isCanceled ? baseAmount : 0,
      installment: cInstallment >= 0 ? String(r[cInstallment] ?? "").trim() : "",
      isCanceled,
      isForeign,
      usdAmount: usd,
    });
  }

  return { rows };
}
