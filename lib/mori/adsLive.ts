/**
 * 모리용 메타 광고 실적(계정 단위, 라이브).
 *
 * MADS의 fetchMetaKpi는 비공개 + spend/구매만 본다. 모리가 "왜 주문이 없지?"를 진단하려면
 * 노출·클릭·CTR까지 필요 → 여기서 account/insights 를 직접 조회한다.
 * 토큰/계정은 MADS와 동일 소스 재사용(getMetaTokenServer + resolveAdAccountId).
 */
import { getMetaTokenServer } from "@/lib/metaTokenStore";
import { resolveAdAccountId } from "@/lib/metaBrandFilter";
import { metaGet } from "@/lib/metaClient";

const PURCHASE_ACTIONS = new Set([
  "purchase",
  "omni_purchase",
  "offsite_conversion.fb_pixel_purchase",
]);

export interface AdSummary {
  ok: boolean;
  error?: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number; // %
  purchases: number;
  purchaseValue: number;
  roas: number;
}

const ZERO = { spend: 0, impressions: 0, clicks: 0, ctr: 0, purchases: 0, purchaseValue: 0, roas: 0 };

function sumPurchase(arr: unknown): number {
  if (!Array.isArray(arr)) return 0;
  return arr
    .filter((a: any) => PURCHASE_ACTIONS.has(a?.action_type))
    .reduce((s, a: any) => s + (Number(a?.value) || 0), 0);
}

/** since/until = YYYY-MM-DD (포함). 계정 전체 인사이트 합계. */
export async function fetchAdSummary(since: string, until: string): Promise<AdSummary> {
  let token: string | null = null;
  try {
    token = await getMetaTokenServer();
  } catch {
    /* noop */
  }
  if (!token) return { ok: false, error: "메타 토큰 없음/만료", ...ZERO };

  try {
    const accountId = await resolveAdAccountId(token);
    const res = await metaGet(`/${accountId}/insights`, token, {
      fields: "spend,impressions,clicks,ctr,actions,action_values",
      time_range: JSON.stringify({ since, until }),
      level: "account",
    });
    const row = (res?.data ?? [])[0];
    if (!row) return { ok: true, ...ZERO }; // 노출/지출 0 = 미집행
    const spend = Number(row.spend) || 0;
    const purchaseValue = sumPurchase(row.action_values);
    return {
      ok: true,
      spend,
      impressions: Number(row.impressions) || 0,
      clicks: Number(row.clicks) || 0,
      ctr: Number(row.ctr) || 0,
      purchases: sumPurchase(row.actions),
      purchaseValue,
      roas: spend > 0 ? purchaseValue / spend : 0,
    };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "광고 조회 실패", ...ZERO };
  }
}

/** KST 기준 오늘 YYYY-MM-DD. */
export function todayKstDate(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
