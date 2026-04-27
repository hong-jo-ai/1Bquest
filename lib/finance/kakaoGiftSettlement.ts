/**
 * 카카오선물하기 월별 정산서 (피오르드 발행) 파서.
 *
 * 입력: .xlsx 정산서 (2개 시트)
 *   - 시트 1 "선물하기 거래내역서": 헤더(행 10) + 상품별 데이터(행 12+) + 합계(행 N)
 *     컬럼: 품목명 | 수량 | 판매가 | 총매출 | 정산기준금액 | 공급가액 | 세액
 *   - 시트 2 "정산 상세 내역": 주문번호 / 상품번호 / 상품명 / 옵션명 / 정산기준금액 / 수량
 *
 * 출력:
 *   - year, month (정산 대상 월)
 *   - totalRevenue (고객 결제 총매출), totalSold (수량)
 *   - products (sku=상품번호 매핑이 있으면 채움, 없으면 상품명만)
 */
import * as XLSX from "xlsx";

export interface KakaoSettlementProduct {
  sku: string;            // 카카오 상품번호 (시트2에서 추출 가능한 경우)
  name: string;
  sold: number;
  revenue: number;        // 총매출 (판매가 × 수량)
  settlementAmount: number; // 정산기준금액 합 (수수료 차감 후)
}

export interface KakaoSettlement {
  year: number;
  month: number;
  totalRevenue: number;        // 고객 결제 총매출
  totalSettlement: number;     // 사업자 정산받는 금액 (부가세 포함, 수수료 차감 후)
  totalSold: number;
  products: KakaoSettlementProduct[];
}

function parseNum(v: unknown): number {
  if (typeof v === "number") return v;
  return parseFloat(String(v ?? "0").replace(/,/g, "").replace(/[^\d.\-]/g, "")) || 0;
}

function findCol(header: unknown[], label: string): number {
  return header.findIndex((c) => String(c ?? "").replace(/\s+/g, "").includes(label));
}

/**
 * 정산 대상 월 추출:
 *   1순위: 파일명에서 "N월" 패턴 (예: "3월 폴바이스 정산서-...")
 *   2순위: 시트1 row 4의 발행일 - 1개월 (정산서는 보통 다음달 초 발행)
 */
function extractPeriod(rows: unknown[][], fileName: string): { year: number; month: number } {
  // 시트1 행 4 발행일 추출 — 셀이 "2026", " 4 ", "월", "10", "일" 식으로 흩어져 있음
  let issueYear: number | null = null;
  let issueMonth: number | null = null;
  if (rows[4]) {
    const cells = rows[4].map((c) => String(c ?? "").trim());
    for (let i = 0; i < cells.length; i++) {
      if (/^\d{4}$/.test(cells[i]) && cells[i + 1] === "" && cells[i + 2] === "" && cells[i + 3] === "" && cells[i + 4] === "년") {
        issueYear = parseInt(cells[i], 10);
      }
      // 발행 월: "년" 다음의 숫자
      if (cells[i] === "년" && /^\d{1,2}$/.test(cells[i + 1])) {
        issueMonth = parseInt(cells[i + 1], 10);
      }
    }
    // fallback: 단순 매칭
    if (!issueYear) {
      const yMatch = cells.find((c) => /^\d{4}$/.test(c));
      if (yMatch) issueYear = parseInt(yMatch, 10);
    }
  }

  // 파일명에서 정산 대상 월
  const fileMatch = fileName.match(/(\d{1,2})\s*월/);
  let targetMonth: number;
  if (fileMatch) {
    targetMonth = parseInt(fileMatch[1], 10);
  } else if (issueMonth) {
    // 발행월이 1월이면 정산 대상은 전년 12월
    targetMonth = issueMonth === 1 ? 12 : issueMonth - 1;
  } else {
    throw new Error("정산 대상 월을 추출할 수 없음 (파일명에 'N월' 포함 필요)");
  }

  let year = issueYear ?? new Date(Date.now() + 9 * 60 * 60 * 1000).getUTCFullYear();
  // 발행월이 1월인데 정산 대상이 12월이면 year - 1
  if (issueMonth === 1 && targetMonth === 12) year -= 1;

  if (targetMonth < 1 || targetMonth > 12) {
    throw new Error(`정산 대상 월이 비정상: ${targetMonth}월`);
  }

  return { year, month: targetMonth };
}

export function parseKakaoSettlement(buffer: ArrayBuffer, fileName: string): KakaoSettlement {
  const wb = XLSX.read(new Uint8Array(buffer), { type: "array", cellDates: false });

  // 시트1 "선물하기 거래내역서" 또는 첫 번째 시트
  const sheet1Name = wb.SheetNames.find((n) => n.includes("거래내역")) ?? wb.SheetNames[0];
  const sheet1 = wb.Sheets[sheet1Name];
  if (!sheet1) throw new Error("거래내역 시트가 없음");
  const rows1 = XLSX.utils.sheet_to_json<unknown[]>(sheet1, { header: 1, defval: "" });

  const { year, month } = extractPeriod(rows1, fileName);

  // 헤더 행 찾기 — '품목명' + '수량' + '판매가' 포함
  let headerRow = -1;
  for (let i = 0; i < Math.min(20, rows1.length); i++) {
    const flat = rows1[i].map((c) => String(c ?? "").replace(/\s+/g, ""));
    if (flat.some((c) => c === "품목명") && flat.some((c) => c === "수량") && flat.some((c) => c === "판매가")) {
      headerRow = i;
      break;
    }
  }
  if (headerRow < 0) throw new Error("품목명/수량/판매가 헤더를 찾을 수 없음");

  const header = rows1[headerRow];
  const cName = findCol(header, "품목명");
  const cQty = findCol(header, "수량");
  const cTotal = findCol(header, "총매출");
  const cSettlement = findCol(header, "정산기준금액");

  // 데이터 행 + 합계 행 처리
  // 합계 행: 첫 셀이 "계"
  const productByName = new Map<string, KakaoSettlementProduct>();
  let totalRevenue = 0;
  let totalSettlement = 0;
  let totalSold = 0;

  for (let i = headerRow + 1; i < rows1.length; i++) {
    const row = rows1[i];
    if (!row || row.every((c) => !c)) continue;

    const firstCell = String(row[0] ?? "").trim();
    const name = String(row[cName] ?? "").trim();

    if (firstCell === "계") {
      totalSold = parseNum(row[cQty]);
      totalRevenue = parseNum(row[cTotal]);
      totalSettlement = parseNum(row[cSettlement]);
      // 합계 행에 정산기준금액이 비어있을 수 있음 — 공급가액+세액으로 보정
      if (totalSettlement === 0) {
        const cSupply = findCol(header, "공급가액");
        const cTax = findCol(header, "세액");
        if (cSupply >= 0 && cTax >= 0) {
          totalSettlement = parseNum(row[cSupply]) + parseNum(row[cTax]);
        }
      }
      break;
    }

    if (!name) continue;

    const qty = parseNum(row[cQty]);
    const total = parseNum(row[cTotal]);
    const settlement = parseNum(row[cSettlement]) * qty; // 정산기준금액은 보통 개당이라 수량 곱
    if (qty === 0 && total === 0) continue;

    const existing = productByName.get(name);
    if (existing) {
      existing.sold += qty;
      existing.revenue += total;
      existing.settlementAmount += settlement;
    } else {
      productByName.set(name, {
        sku: "", // 시트2에서 매칭하면 채움
        name,
        sold: qty,
        revenue: total,
        settlementAmount: settlement,
      });
    }
  }

  // 합계 fallback (합계 행이 없거나 비어있는 경우)
  if (totalSold === 0) {
    for (const p of productByName.values()) totalSold += p.sold;
  }
  if (totalRevenue === 0) {
    for (const p of productByName.values()) totalRevenue += p.revenue;
  }
  if (totalSettlement === 0) {
    for (const p of productByName.values()) totalSettlement += p.settlementAmount;
  }

  // 시트2 "정산 상세 내역"에서 상품명 → 상품번호 매핑
  const sheet2Name = wb.SheetNames.find((n) => n.includes("정산 상세")) ?? wb.SheetNames[1];
  if (sheet2Name) {
    const sheet2 = wb.Sheets[sheet2Name];
    const rows2 = XLSX.utils.sheet_to_json<unknown[]>(sheet2, { header: 1, defval: "" });
    if (rows2.length >= 2) {
      const h = rows2[0].map((c) => String(c ?? "").trim());
      const cSku = h.findIndex((c) => c === "상품번호");
      const cN = h.findIndex((c) => c === "상품명");
      if (cSku >= 0 && cN >= 0) {
        for (let i = 1; i < rows2.length; i++) {
          const row = rows2[i];
          const sku = String(row[cSku] ?? "").trim();
          const name = String(row[cN] ?? "").trim();
          if (!sku || !name) continue;
          const p = productByName.get(name);
          if (p && !p.sku) p.sku = sku;
        }
      }
    }
  }

  return {
    year,
    month,
    totalRevenue,
    totalSettlement,
    totalSold,
    products: Array.from(productByName.values()),
  };
}
