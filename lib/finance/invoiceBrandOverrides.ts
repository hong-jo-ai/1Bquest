/**
 * 브랜드가 정해진 매입 세금계산서(광고비) — P&L 에서 따로 떼어 그 브랜드에만 차감한다.
 *
 * 왜: 세금계산서 광고비는 "외부채널 광고 = 폴바이스 전용" 규칙이라 해리엇 손익에서 빠지고,
 * 품목명이 규칙에 안 걸리면 매입으로 분류돼 손익에 아예 안 잡힌다. 그래서 해리엇이 직접 집행한
 * 광고(유튜버 유료광고 등)는 어느 경로로 들어와도 해리엇 광고비가 되지 못했다(2026-09-11).
 *
 * 매칭: 공급자 사업자번호(숫자만 비교). 이메일 파싱에서 사업자번호가 비는 계산서가 있어 상호도 함께 본다.
 * 두 브랜드 일을 다 하는 거래처(촬영 외주 등)는 approvalNo 로 **그 계산서 한 건만** 지정한다.
 */
export type OverrideBrand = "paulvice" | "harriot";

interface InvoiceBrandOverride {
  brand: OverrideBrand;
  regNo: string; // 숫자만
  namePattern: RegExp;
  label: string;
  /** 있으면 이 승인번호의 계산서에만 적용(거래처 전체가 아니라). */
  approvalNo?: string;
}

const INVOICE_BRAND_OVERRIDES: InvoiceBrandOverride[] = [
  {
    brand: "harriot",
    regNo: "1168602030",
    namePattern: /비타악티바/,
    label: "비타악티바 유한회사(유튜브 생활인의 시계) — 설월 유료광고 2026-09",
  },
  {
    // 길브로는 폴바이스 누끼도 찍는 곳이라 거래처 단위로 묶지 않는다 — 설월 촬영 계산서만.
    brand: "harriot",
    regNo: "4603700474",
    namePattern: /길브로/,
    label: "길브로 스튜디오 — 설월 연출·누끼 촬영 2026-09 (제품촬영=마케팅비)",
    approvalNo: "20260929-10260929-79451979",
  },
];

export function findInvoiceBrandOverride(
  regNo: string | null | undefined,
  partnerName: string | null | undefined,
  approvalNo?: string | null,
): InvoiceBrandOverride | null {
  const digits = String(regNo ?? "").replace(/\D/g, "");
  return (
    INVOICE_BRAND_OVERRIDES.find(
      (o) =>
        ((digits && digits === o.regNo) || o.namePattern.test(String(partnerName ?? ""))) &&
        (!o.approvalNo || o.approvalNo === approvalNo),
    ) ?? null
  );
}
