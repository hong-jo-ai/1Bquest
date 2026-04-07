/**
 * 주얼리 청산 광고 엔진
 *
 * 기존 "주얼리" 캠페인의 예산을 ROAS 기반으로 자동 조정.
 * - ROAS > 3 → 예산 25% 증가
 * - ROAS ≤ 3 → 예산 20% 감소
 * - 캠페인 이름에 "주얼리"가 포함된 캠페인만 대상
 */
import { metaGet, metaPost } from "./metaClient";

// ── 타입 ──────────────────────────────────────────────────────────────────

export interface BudgetAdjustment {
  adSetId: string;
  adSetName: string;
  previousBudget: number;
  newBudget: number;
  roas: number;
  changePct: number;
}

export interface AdEngineResult {
  campaignId: string | null;
  campaignName: string | null;
  adjustments: BudgetAdjustment[];
  skipped: boolean;
  reason?: string;
  errors: string[];
}

// ── 상수 ──────────────────────────────────────────────────────────────────

const ROAS_THRESHOLD = 3;
const BUDGET_INCREASE_PCT = 0.25;
const BUDGET_DECREASE_PCT = 0.20;

// ── 광고 계정 ID 조회 ────────────────────────────────────────────────────

async function getAdAccountId(token: string): Promise<string> {
  const data = await metaGet("/me/adaccounts", token, {
    fields: "id,name,account_status",
    limit: "10",
  });
  const accounts: any[] = data.data ?? [];
  if (accounts.length === 0) throw new Error("연결된 Meta 광고 계정이 없습니다");

  const envId = process.env.META_AD_ACCOUNT_ID;
  const account =
    (envId ? accounts.find((a: any) => a.id === envId) : null) ??
    accounts.find((a: any) => a.account_status === 1) ??
    accounts[0];
  return account.id;
}

// ── "주얼리" 캠페인 찾기 ─────────────────────────────────────────────────

async function findJewelryCampaign(
  token: string,
  accountId: string
): Promise<{ id: string; name: string } | null> {
  const data = await metaGet(`/${accountId}/campaigns`, token, {
    fields: "id,name,status",
    effective_status: JSON.stringify(["ACTIVE", "PAUSED"]),
    limit: "50",
  });
  const found = (data.data ?? []).find((c: any) =>
    c.name.includes("주얼리")
  );
  return found ? { id: found.id, name: found.name } : null;
}

// ── 광고 세트별 ROAS 조회 + 예산 조정 ────────────────────────────────────

async function getAdSetsWithInsights(
  token: string,
  campaignId: string
): Promise<{ id: string; name: string; dailyBudget: number; roas: number }[]> {
  const data = await metaGet(`/${campaignId}/adsets`, token, {
    fields: "id,name,daily_budget",
    effective_status: JSON.stringify(["ACTIVE"]),
    limit: "50",
  });

  const adSets: { id: string; name: string; dailyBudget: number; roas: number }[] = [];

  for (const adSet of data.data ?? []) {
    let roas = 0;
    try {
      const insights = await metaGet(`/${adSet.id}/insights`, token, {
        fields: "spend,action_values",
        date_preset: "last_7d",
      });
      const row = insights.data?.[0];
      if (row) {
        const spend = parseFloat(row.spend ?? "0");
        const purchaseValue = (row.action_values ?? []).find(
          (a: any) => a.action_type === "offsite_conversion.fb_pixel_purchase"
              || a.action_type === "purchase"
        );
        const revenue = parseFloat(purchaseValue?.value ?? "0");
        roas = spend > 0 ? revenue / spend : 0;
      }
    } catch { /* 인사이트 없으면 roas = 0 */ }

    adSets.push({
      id: adSet.id,
      name: adSet.name,
      dailyBudget: parseInt(adSet.daily_budget ?? "0", 10),
      roas,
    });
  }

  return adSets;
}

// ── 메인 실행 함수 ────────────────────────────────────────────────────────

export async function runClearanceAds(
  token: string,
): Promise<AdEngineResult> {
  const result: AdEngineResult = {
    campaignId: null,
    campaignName: null,
    adjustments: [],
    skipped: false,
    errors: [],
  };

  try {
    const accountId = await getAdAccountId(token);
    const campaign = await findJewelryCampaign(token, accountId);

    if (!campaign) {
      result.skipped = true;
      result.reason = "이름에 '주얼리'가 포함된 캠페인을 찾지 못했습니다";
      return result;
    }

    result.campaignId = campaign.id;
    result.campaignName = campaign.name;

    const adSets = await getAdSetsWithInsights(token, campaign.id);

    if (adSets.length === 0) {
      result.skipped = true;
      result.reason = `캠페인 "${campaign.name}"에 활성 광고 세트가 없습니다`;
      return result;
    }

    for (const adSet of adSets) {
      const isAboveThreshold = adSet.roas > ROAS_THRESHOLD;
      const changePct = isAboveThreshold ? BUDGET_INCREASE_PCT : -BUDGET_DECREASE_PCT;
      const newBudget = Math.round(adSet.dailyBudget * (1 + changePct));

      // Meta 최소 일예산 1,000원(100 in cents 단위가 아닌 원 단위)
      const finalBudget = Math.max(newBudget, 1000);

      if (finalBudget === adSet.dailyBudget) {
        result.adjustments.push({
          adSetId: adSet.id,
          adSetName: adSet.name,
          previousBudget: adSet.dailyBudget,
          newBudget: finalBudget,
          roas: adSet.roas,
          changePct: 0,
        });
        continue;
      }

      try {
        await metaPost(`/${adSet.id}`, token, {
          daily_budget: finalBudget.toString(),
        });

        result.adjustments.push({
          adSetId: adSet.id,
          adSetName: adSet.name,
          previousBudget: adSet.dailyBudget,
          newBudget: finalBudget,
          roas: adSet.roas,
          changePct: Math.round(changePct * 100),
        });
      } catch (e: any) {
        result.errors.push(`[${adSet.name}] 예산 변경 실패: ${e.message}`);
      }
    }
  } catch (e: any) {
    result.errors.push(`광고 엔진 오류: ${e.message}`);
  }

  return result;
}

// ── 상태 조회 ─────────────────────────────────────────────────────────────

export interface ClearanceAdStatus {
  hasCampaign: boolean;
  campaignId: string | null;
  campaignName: string | null;
  campaignStatus: string | null;
  adSetsCount: number;
  activeAdsCount: number;
  totalSpend: number;
  totalRevenue: number;
  roas: number;
  totalImpressions: number;
  totalClicks: number;
  ctr: number;
}

export async function getClearanceAdStatus(token: string): Promise<ClearanceAdStatus> {
  const empty: ClearanceAdStatus = {
    hasCampaign: false,
    campaignId: null,
    campaignName: null,
    campaignStatus: null,
    adSetsCount: 0,
    activeAdsCount: 0,
    totalSpend: 0,
    totalRevenue: 0,
    roas: 0,
    totalImpressions: 0,
    totalClicks: 0,
    ctr: 0,
  };

  try {
    const accountId = await getAdAccountId(token);
    const data = await metaGet(`/${accountId}/campaigns`, token, {
      fields: "id,name,status",
      effective_status: JSON.stringify(["ACTIVE", "PAUSED"]),
      limit: "50",
    });
    const campaign = (data.data ?? []).find((c: any) =>
      c.name.includes("주얼리")
    );
    if (!campaign) return empty;

    // 캠페인 인사이트
    let spend = 0, impressions = 0, clicks = 0, revenue = 0;
    try {
      const insights = await metaGet(`/${campaign.id}/insights`, token, {
        fields: "spend,impressions,clicks,ctr,action_values",
        date_preset: "last_7d",
      });
      const d = insights.data?.[0];
      if (d) {
        spend = parseFloat(d.spend ?? "0");
        impressions = parseInt(d.impressions ?? "0", 10);
        clicks = parseInt(d.clicks ?? "0", 10);
        const purchaseValue = (d.action_values ?? []).find(
          (a: any) => a.action_type === "offsite_conversion.fb_pixel_purchase"
              || a.action_type === "purchase"
        );
        revenue = parseFloat(purchaseValue?.value ?? "0");
      }
    } catch { /* no insights yet */ }

    // 광고 세트 수
    const adSets = await metaGet(`/${campaign.id}/adsets`, token, {
      fields: "id",
      limit: "10",
    });

    // 활성 광고 수
    const ads = await metaGet(`/${campaign.id}/ads`, token, {
      fields: "id,status",
      effective_status: JSON.stringify(["ACTIVE"]),
      limit: "50",
    });

    return {
      hasCampaign: true,
      campaignId: campaign.id,
      campaignName: campaign.name,
      campaignStatus: campaign.status,
      adSetsCount: (adSets.data ?? []).length,
      activeAdsCount: (ads.data ?? []).length,
      totalSpend: spend,
      totalRevenue: revenue,
      roas: spend > 0 ? revenue / spend : 0,
      totalImpressions: impressions,
      totalClicks: clicks,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    };
  } catch {
    return empty;
  }
}
