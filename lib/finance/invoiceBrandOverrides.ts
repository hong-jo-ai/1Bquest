/**
 * 브랜드가 정해진 매입 세금계산서(광고비) — P&L 에서 따로 떼어 그 브랜드에만 차감한다.
 *
 * 왜: 세금계산서 광고비는 "외부채널 광고 = 폴바이스 전용" 규칙이라 해리엇 손익에서 빠지고,
 * 품목명이 규칙에 안 걸리면 매입으로 분류돼 손익에 아예 안 잡힌다. 그래서 해리엇이 직접 집행한
 * 광고(유튜버 유료광고 등)는 어느 경로로 들어와도 해리엇 광고비가 되지 못했다(2026-09-11).
 *
 * 매칭: 공급자 사업자번호(숫자만 비교). 이메일 파싱에서 사업자번호가 비는 계산서가 있어 상호도 함께 본다.
 */
export type OverrideBrand = "paulvice" | "harriot";

interface InvoiceBrandOverride {
  brand: OverrideBrand;
  regNo: string; // 숫자만
  namePattern: RegExp;
  label: string;
}

const INVOICE_BRAND_OVERRIDES: InvoiceBrandOverride[] = [
  {
    brand: "harriot",
    regNo: "1168602030",
    namePattern: /비타악티바/,
    label: "비타악티바 유한회사(유튜브 생활인의 시계) — 설월 유료광고 2026-09",
  },
];

export function findInvoiceBrandOverride(
  regNo: string | null | undefined,
  partnerName: string | null | undefined,
): InvoiceBrandOverride | null {
  const digits = String(regNo ?? "").replace(/\D/g, "");
  return (
    INVOICE_BRAND_OVERRIDES.find(
      (o) => (digits && digits === o.regNo) || o.namePattern.test(String(partnerName ?? "")),
    ) ?? null
  );
}
