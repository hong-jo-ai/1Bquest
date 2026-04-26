/**
 * 홈택스 전자세금계산서 목록 Excel 파서.
 *
 * 형식:
 *   시트 1 "세금계산서": 인보이스 헤더
 *     행 0   : 사업자 정보 (사업자번호 / 상호 / 대표자명)
 *     행 2   : 총 합계 / 총 공급가액 / 총 세액
 *     행 4-5 : 빈 행 / 컬럼 헤더
 *     행 6~  : 데이터 (작성일자 / 승인번호 / 발급일자 / 전송일자 / 공급자ㅋ... / 공급받는자ㅋ...)
 *
 *   시트 2 "품목": 각 인보이스의 상세 항목
 *     행 4 : 컬럼 헤더 (승인번호 / 품목순번 / ... / 품목명 / 단가 / 공급가액 / 세액)
 *     행 5~: 데이터
 *
 * invoiceType은 파일명 또는 시트 내용으로 판별 ('매입' / '매출').
 */
import * as XLSX from "xlsx";

export type TaxInvoiceType = "purchase" | "sales";

export interface ParsedInvoice {
  approvalNo: string;
  writeDate: string | null;     // YYYY-MM-DD
  issueDate: string | null;
  partnerRegNo: string;
  partnerName: string;
  partnerRep: string;
  partnerAddress: string;
  supplyAmount: number;
  taxAmount: number;
  totalAmount: number;
}

export interface ParsedInvoiceItem {
  approvalNo: string;
  itemSeq: number | null;
  itemDate: string | null;
  itemName: string;
  spec: string;
  quantity: number | null;
  unitPrice: number | null;
  supplyAmount: number;
  taxAmount: number;
  remark: string;
}

export interface HometaxParseResult {
  invoiceType: TaxInvoiceType;
  myBusinessRegNo: string | null;
  myBusinessName: string | null;
  totalSupply: number;
  totalTax: number;
  totalAmount: number;
  invoices: ParsedInvoice[];
  items: ParsedInvoiceItem[];
}

function parseNum(v: unknown): number {
  if (typeof v === "number") return v;
  return parseFloat(String(v ?? "0").replace(/,/g, "").replace(/[^\d.\-]/g, "")) || 0;
}

function parseDate(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(v).trim();
  // "2026-04-08" / "2026.04.08" / "2026/04/08"
  const m = s.match(/^(\d{4})[\-./](\d{1,2})[\-./](\d{1,2})$/);
  if (m) {
    const [, y, mo, d] = m;
    return `${y}-${String(parseInt(mo, 10)).padStart(2, "0")}-${String(parseInt(d, 10)).padStart(2, "0")}`;
  }
  return null;
}

/**
 * @param invoiceType 명시 안 하면 파일 내용에서 추론 ('매입 ...목록조회' / '매출 ...')
 */
export function parseHometaxExcel(
  buffer: ArrayBuffer,
  invoiceType?: TaxInvoiceType
): HometaxParseResult {
  const wb = XLSX.read(new Uint8Array(buffer), {
    type: "array",
    cellDates: true,
    cellNF: false,
  });

  // 시트 찾기
  const taxSheetName = wb.SheetNames.find((n) => n.includes("세금계산서")) ?? wb.SheetNames[0];
  const itemsSheetName = wb.SheetNames.find((n) => n.includes("품목")) ?? null;

  const taxSheet = wb.Sheets[taxSheetName];
  const taxRows = XLSX.utils.sheet_to_json<unknown[]>(taxSheet, { header: 1, defval: "" });

  // 메타: 사업자 정보
  let myRegNo: string | null = null;
  let myName: string | null = null;
  if (taxRows[0]) {
    const r0 = taxRows[0].map(String);
    const idxRegNo = r0.findIndex((c) => c.includes("사업자") && c.includes("등록"));
    const idxName = r0.findIndex((c) => c === "상호");
    if (idxRegNo >= 0 && r0[idxRegNo + 1]) myRegNo = String(r0[idxRegNo + 1]).trim();
    if (idxName >= 0 && r0[idxName + 1]) myName = String(r0[idxName + 1]).trim();
  }

  // 합계: '총 합계금액', '총 공급가액', '총 세액'
  let totalSupply = 0, totalTax = 0, totalAmount = 0;
  for (const row of taxRows.slice(0, 5)) {
    const arr = row as unknown[];
    for (let i = 0; i < arr.length; i++) {
      const cell = String(arr[i] ?? "");
      if (cell.includes("총 합계") || cell.includes("총합계")) totalAmount = parseNum(arr[i + 1]);
      if (cell.includes("총 공급") || cell.includes("총공급")) totalSupply = parseNum(arr[i + 1]);
      if (cell.includes("총 세액") || cell.includes("총세액")) totalTax = parseNum(arr[i + 1]);
    }
  }

  // invoiceType 추론 (시트 어디에든 '매입 전자' / '매출 전자' 헤더가 있음)
  let detectedType: TaxInvoiceType | null = null;
  for (const row of taxRows.slice(0, 10)) {
    const joined = (row as unknown[]).map(String).join(" ");
    if (/매입\s*전자/.test(joined)) detectedType = "purchase";
    if (/매출\s*전자/.test(joined)) detectedType = "sales";
  }
  const finalType = invoiceType ?? detectedType ?? "purchase";

  // 헤더 행 찾기
  let headerIdx = -1;
  for (let i = 0; i < Math.min(15, taxRows.length); i++) {
    const r = (taxRows[i] as unknown[]).map(String);
    if (r.includes("작성일자") || r.includes("승인번호")) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) {
    throw new Error("홈택스 세금계산서 헤더(작성일자/승인번호)를 찾을 수 없습니다.");
  }

  const headers = (taxRows[headerIdx] as unknown[]).map((c) => String(c).trim());
  const idx = (kw: string) => headers.findIndex((h) => h === kw);

  const cWriteDate = idx("작성일자");
  const cApproval = idx("승인번호");
  const cIssueDate = idx("발급일자");
  // 매입: 공급자가 거래처. 매출: 공급받는자가 거래처.
  // 공급자 사업자등록번호 / 공급받는자 사업자등록번호 — 두 컬럼 모두 있음
  const supplierRegIdx = headers.findIndex((h) => h === "공급자사업자등록번호");
  const supplierNameIdx = headers.findIndex((h, i) => h === "상호" && i > supplierRegIdx);
  const supplierRepIdx = headers.findIndex((h, i) => h === "대표자명" && i > supplierRegIdx);
  const supplierAddrIdx = headers.findIndex((h, i) => h === "주소" && i > supplierRegIdx);
  const buyerRegIdx = headers.findIndex((h) => h === "공급받는자사업자등록번호");
  const buyerNameIdx = headers.findIndex((h, i) => h === "상호" && i > buyerRegIdx);
  const buyerRepIdx = headers.findIndex((h, i) => h === "대표자명" && i > buyerRegIdx);
  const buyerAddrIdx = headers.findIndex((h, i) => h === "주소" && i > buyerRegIdx);
  const cSupply = headers.findIndex((h) => h === "공급가액" || h === "총 공급가액");
  const cTax = headers.findIndex((h) => h === "세액" || h === "총 세액");
  const cTotal = headers.findIndex((h) => h === "합계금액" || h === "총 합계금액");

  const invoices: ParsedInvoice[] = [];
  for (let i = headerIdx + 1; i < taxRows.length; i++) {
    const r = taxRows[i] as unknown[];
    if (!r || r.every((c) => !c)) continue;
    const approval = cApproval >= 0 ? String(r[cApproval] ?? "").trim() : "";
    if (!approval) continue;

    // 매입(purchase)이면 거래처 = 공급자, 매출(sales)이면 거래처 = 공급받는자
    const partnerRegIdx = finalType === "purchase" ? supplierRegIdx : buyerRegIdx;
    const partnerNameIdx_ = finalType === "purchase" ? supplierNameIdx : buyerNameIdx;
    const partnerRepIdx = finalType === "purchase" ? supplierRepIdx : buyerRepIdx;
    const partnerAddrIdx = finalType === "purchase" ? supplierAddrIdx : buyerAddrIdx;

    invoices.push({
      approvalNo: approval,
      writeDate: cWriteDate >= 0 ? parseDate(r[cWriteDate]) : null,
      issueDate: cIssueDate >= 0 ? parseDate(r[cIssueDate]) : null,
      partnerRegNo: partnerRegIdx >= 0 ? String(r[partnerRegIdx] ?? "").trim() : "",
      partnerName: partnerNameIdx_ >= 0 ? String(r[partnerNameIdx_] ?? "").trim() : "",
      partnerRep: partnerRepIdx >= 0 ? String(r[partnerRepIdx] ?? "").trim() : "",
      partnerAddress: partnerAddrIdx >= 0 ? String(r[partnerAddrIdx] ?? "").trim() : "",
      supplyAmount: cSupply >= 0 ? parseNum(r[cSupply]) : 0,
      taxAmount: cTax >= 0 ? parseNum(r[cTax]) : 0,
      totalAmount: cTotal >= 0 ? parseNum(r[cTotal]) : 0,
    });
  }

  // 품목 시트
  const items: ParsedInvoiceItem[] = [];
  if (itemsSheetName) {
    const itemSheet = wb.Sheets[itemsSheetName];
    const itemRows = XLSX.utils.sheet_to_json<unknown[]>(itemSheet, { header: 1, defval: "" });
    let itemHeaderIdx = -1;
    for (let i = 0; i < Math.min(10, itemRows.length); i++) {
      const r = (itemRows[i] as unknown[]).map(String);
      if (r.includes("승인번호") && r.includes("품목명")) {
        itemHeaderIdx = i;
        break;
      }
    }
    if (itemHeaderIdx >= 0) {
      const ih = (itemRows[itemHeaderIdx] as unknown[]).map((c) => String(c).trim());
      const iIdx = (kw: string) => ih.findIndex((h) => h === kw);
      const ciApproval = iIdx("승인번호");
      const ciSeq = iIdx("품목순번");
      const ciDate = iIdx("일자");
      const ciName = iIdx("품목명");
      const ciSpec = iIdx("규격");
      const ciQty = iIdx("수량");
      const ciPrice = iIdx("단가");
      const ciSupply = iIdx("공급가액");
      const ciTax = iIdx("세액");
      const ciRemark = iIdx("비고");

      for (let i = itemHeaderIdx + 1; i < itemRows.length; i++) {
        const r = itemRows[i] as unknown[];
        if (!r || r.every((c) => !c)) continue;
        const approval = ciApproval >= 0 ? String(r[ciApproval] ?? "").trim() : "";
        if (!approval) continue;
        items.push({
          approvalNo: approval,
          itemSeq: ciSeq >= 0 ? parseInt(String(r[ciSeq] ?? "0"), 10) || null : null,
          itemDate: ciDate >= 0 ? parseDate(r[ciDate]) : null,
          itemName: ciName >= 0 ? String(r[ciName] ?? "").trim() : "",
          spec: ciSpec >= 0 ? String(r[ciSpec] ?? "").trim() : "",
          quantity: ciQty >= 0 ? (parseNum(r[ciQty]) || null) : null,
          unitPrice: ciPrice >= 0 ? (parseNum(r[ciPrice]) || null) : null,
          supplyAmount: ciSupply >= 0 ? parseNum(r[ciSupply]) : 0,
          taxAmount: ciTax >= 0 ? parseNum(r[ciTax]) : 0,
          remark: ciRemark >= 0 ? String(r[ciRemark] ?? "").trim() : "",
        });
      }
    }
  }

  return {
    invoiceType: finalType,
    myBusinessRegNo: myRegNo,
    myBusinessName: myName,
    totalSupply,
    totalTax,
    totalAmount,
    invoices,
    items,
  };
}

/**
 * 인보이스 거래처명/품목으로 비용 카테고리 추론.
 */
export function categorizeInvoice(inv: ParsedInvoice, items: ParsedInvoiceItem[]): string {
  const text = `${inv.partnerName} ${items.map((i) => i.itemName).join(" ")}`;

  if (/카페24|토스페이먼츠|KG이니시스|KCP|네이버파이낸셜|NICE/i.test(text)) return "수수료";
  if (/패키지|박스|포장|인쇄/i.test(text)) return "매입"; // 패키지 제작
  if (/광고|마케팅|페이스북|구글|카카오|네이버광고|tiktok/i.test(text)) return "광고비";
  if (/택배|배송|운송|CJ대한통운|한진택배|로젠|쿠팡로지스/i.test(text)) return "택배비";
  if (/임대|월세|관리비/i.test(text)) return "임대료";
  if (/통신|전화|인터넷|SKT|KT|LGU|skt|kt|lgu/i.test(text)) return "통신비";
  if (/aws|cloud|github|vercel|notion|figma|saas|소프트웨어/i.test(text)) return "소프트웨어";
  if (/위탁|정산|반품|매출/i.test(text)) return "매출"; // 매출 정산용 (음수면 차감)

  return "매입"; // 기본은 매입 (제품/원자재)
}
