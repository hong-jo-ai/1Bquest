/**
 * 한 광고계정(해리엇 계정)에서 폴바이스 + 해리엇 캠페인을 함께 운영.
 * 캠페인/광고세트 *이름*의 키워드 패턴으로 브랜드를 추론한다.
 *
 * 룰:
 *   - 해리엇 키워드 매칭 → harriot
 *   - 그 외(폴바이스 키워드 매칭 OR 어느 쪽도 매칭 안 됨) → paulvice
 *     (사용자가 "미매칭은 폴바이스로 간주" 결정 — 2026-05-11)
 */
import { metaGet } from "./metaClient";

export type Brand = "paulvice" | "harriot";

const BRAND_CAMPAIGN_PATTERNS: Record<Brand, RegExp[]> = {
  paulvice: [/폴바이스/, /paulvice/i, /paulwise/i],
  harriot:  [/해리/, /harriot/i],
};

export function inferBrandFromCampaign(campaignName: string | undefined | null): Brand {
  if (!campaignName) return "paulvice";
  if (BRAND_CAMPAIGN_PATTERNS.harriot.some((p) => p.test(campaignName))) return "harriot";
  return "paulvice";
}

export function campaignMatchesBrand(
  campaignName: string | undefined | null,
  brand: string,
): boolean {
  if (!brand) return true;
  return inferBrandFromCampaign(campaignName) === brand;
}

// META_AD_ACCOUNT_ID 정규화: 사용자가 act_ 접두어 없이 숫자만 입력해도 보정.
export function normalizeAdAccountId(raw: string | undefined): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";
  return trimmed.startsWith("act_") ? trimmed : `act_${trimmed.replace(/^act_/i, "")}`;
}

/**
 * 광고계정 ID 결정:
 *   1) META_AD_ACCOUNT_ID env (act_ 접두어 자동 보정)
 *   2) 없으면 /me/adaccounts 첫 ACTIVE 계정
 */
export async function resolveAdAccountId(token: string): Promise<string> {
  const envId = normalizeAdAccountId(process.env.META_AD_ACCOUNT_ID);
  if (envId) return envId;

  const data = (await metaGet("/me/adaccounts", token, {
    fields: "id,account_status",
    limit: "10",
  })) as { data?: Array<{ id: string; account_status: number }> };

  const accounts = data.data ?? [];
  if (!accounts.length) throw new Error("연결된 Meta 광고 계정 없음");
  const active = accounts.find((a) => a.account_status === 1) ?? accounts[0];
  return active.id;
}
