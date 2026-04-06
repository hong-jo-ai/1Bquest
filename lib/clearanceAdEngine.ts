/**
 * 주얼리 청산 광고 엔진
 *
 * 청산 엔진 실행 결과를 받아서 Meta 광고를 자동 생성/업데이트.
 * - 캠페인 1개 (주얼리 클리어런스)
 * - 광고 세트 2개 (신규 트래픽 + 리타겟팅)
 * - 할인 상품별 광고 소재 자동 생성
 */
import { metaGet, metaPost } from "./metaClient";
import type { ClearanceProduct, ClearanceResult } from "./jewelryClearance";

// ── 타입 ──────────────────────────────────────────────────────────────────

export interface SuggestedAdCopy {
  productName: string;
  title: string;
  body: string;
  linkUrl: string;
  discountPct: number;
}

export interface AdEngineResult {
  campaignId: string | null;
  adSetIds: string[];
  adsCreated: number;
  adsUpdated: number;
  adsPaused: number;
  suggestedCopies: SuggestedAdCopy[];
  errors: string[];
}

interface ExistingCampaign {
  id: string;
  name: string;
  status: string;
}

// ── 상수 ──────────────────────────────────────────────────────────────────

const CAMPAIGN_NAME = "[자동] 주얼리 클리어런스";
const ADSET_PROSPECTING = "[자동] 주얼리 청산 - 신규고객";
const ADSET_RETARGETING = "[자동] 주얼리 청산 - 리타겟팅";
const SHOP_URL = "https://icaruse2000.cafe24.com/product/list.html?cate_no=44";

// ── Facebook 페이지 ID 조회 ───────────────────────────────────────────────

async function getPageId(token: string, accountId?: string): Promise<string> {
  // 1순위: 환경변수
  if (process.env.META_PAGE_ID) return process.env.META_PAGE_ID;

  // 2순위: /me/accounts (사용자 토큰인 경우)
  try {
    const data = await metaGet("/me/accounts", token, {
      fields: "id,name",
      limit: "10",
    });
    const pages: any[] = data.data ?? [];
    if (pages.length > 0) return pages[0].id;
  } catch { /* 권한 없으면 다음 방법 시도 */ }

  // 3순위: 광고 계정의 promote_pages
  if (accountId) {
    try {
      const data = await metaGet(`/${accountId}/promote_pages`, token, {
        fields: "id,name",
        limit: "10",
      });
      const pages: any[] = data.data ?? [];
      if (pages.length > 0) return pages[0].id;
    } catch { /* 실패 시 다음 */ }
  }

  throw new Error("Facebook 페이지를 찾을 수 없습니다. META_PAGE_ID 환경변수를 설정하거나, Meta 비즈니스 설정에서 페이지를 광고 계정에 연결하세요.");
}

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

// ── 기존 청산 캠페인 찾기 ─────────────────────────────────────────────────

async function findExistingCampaign(
  token: string,
  accountId: string
): Promise<ExistingCampaign | null> {
  const data = await metaGet(`/${accountId}/campaigns`, token, {
    fields: "id,name,status",
    effective_status: JSON.stringify(["ACTIVE", "PAUSED"]),
    limit: "50",
  });
  const found = (data.data ?? []).find((c: any) => c.name === CAMPAIGN_NAME);
  return found ? { id: found.id, name: found.name, status: found.status } : null;
}

// ── 기존 광고 세트 찾기 ───────────────────────────────────────────────────

async function findAdSets(
  token: string,
  campaignId: string
): Promise<Record<string, string>> {
  const data = await metaGet(`/${campaignId}/adsets`, token, {
    fields: "id,name",
    limit: "10",
  });
  const map: Record<string, string> = {};
  for (const adset of (data.data ?? [])) {
    map[adset.name] = adset.id;
  }
  return map;
}

// ── 기존 광고 목록 ───────────────────────────────────────────────────────

async function findExistingAds(
  token: string,
  adSetId: string
): Promise<Map<string, { id: string; status: string }>> {
  const data = await metaGet(`/${adSetId}/ads`, token, {
    fields: "id,name,status",
    effective_status: JSON.stringify(["ACTIVE", "PAUSED"]),
    limit: "50",
  });
  const map = new Map<string, { id: string; status: string }>();
  for (const ad of (data.data ?? [])) {
    map.set(ad.name, { id: ad.id, status: ad.status });
  }
  return map;
}

// ── 광고 카피 생성 ───────────────────────────────────────────────────────

function generateAdCopy(product: ClearanceProduct): {
  title: string;
  body: string;
  description: string;
  linkUrl: string;
} {
  const discountPct = product.originalPrice > 0
    ? Math.round((1 - product.newPrice / product.originalPrice) * 100)
    : 0;

  const priceFormatted = product.newPrice.toLocaleString("ko-KR");
  const originalFormatted = product.originalPrice.toLocaleString("ko-KR");

  return {
    title: discountPct > 0
      ? `${product.name} ${discountPct}% OFF`
      : product.name,
    body: discountPct > 0
      ? `✨ ${product.name}\n${originalFormatted}원 → ${priceFormatted}원\n한정 수량 특가 · 매일 가격이 바뀝니다`
      : `✨ ${product.name}\n${priceFormatted}원\nPAULVICE 주얼리 컬렉션`,
    description: "PAULVICE 주얼리 클리어런스",
    linkUrl: SHOP_URL,
  };
}

// ── 메인 실행 함수 ────────────────────────────────────────────────────────

export async function runClearanceAds(
  token: string,
  clearanceResult: ClearanceResult
): Promise<AdEngineResult> {
  const result: AdEngineResult = {
    campaignId: null,
    adSetIds: [],
    adsCreated: 0,
    adsUpdated: 0,
    adsPaused: 0,
    suggestedCopies: [],
    errors: [],
  };

  // 가격 변경된 상품만 광고 대상
  const adProducts = clearanceResult.products.filter(
    (p) => p.adjustmentPct > 0 && p.newPrice < p.currentPrice
  );

  if (adProducts.length === 0 && clearanceResult.products.length > 0) {
    // 가격 변경 없어도 기존 상품 중 할인율 높은 순으로 광고
    const sorted = [...clearanceResult.products]
      .filter(p => p.originalPrice > 0 && p.newPrice < p.originalPrice)
      .sort((a, b) => {
        const aDiscount = 1 - a.newPrice / a.originalPrice;
        const bDiscount = 1 - b.newPrice / b.originalPrice;
        return bDiscount - aDiscount;
      });
    adProducts.push(...sorted.slice(0, 5));
  }

  if (adProducts.length === 0) {
    result.errors.push("광고할 상품이 없습니다 (할인 적용된 상품 없음)");
    return result;
  }

  try {
    const accountId = await getAdAccountId(token);
    const pageId = await getPageId(token, accountId);

    // ── 1. 캠페인 생성 또는 찾기 ──────────────────────────────────────
    let campaign = await findExistingCampaign(token, accountId);

    if (!campaign) {
      const res = await metaPost(`/${accountId}/campaigns`, token, {
        name: CAMPAIGN_NAME,
        objective: "OUTCOME_TRAFFIC",
        status: "PAUSED",
        special_ad_categories: "[]",
        is_adset_budget_sharing_enabled: "false",
      });
      campaign = { id: res.id, name: CAMPAIGN_NAME, status: "PAUSED" };
    }
    result.campaignId = campaign.id;

    // ── 2. 광고 세트 생성 또는 찾기 ───────────────────────────────────
    const existingAdSets = await findAdSets(token, campaign.id);

    // 신규고객 광고 세트
    let prospectingAdSetId = existingAdSets[ADSET_PROSPECTING];
    if (!prospectingAdSetId) {
      const res = await metaPost(`/${accountId}/adsets`, token, {
        campaign_id: campaign.id,
        name: ADSET_PROSPECTING,
        optimization_goal: "LINK_CLICKS",
        billing_event: "IMPRESSIONS",
        daily_budget: "10000",
        bid_strategy: "LOWEST_COST_WITHOUT_CAP",
        status: "PAUSED",
        targeting: JSON.stringify({
          age_min: 20,
          age_max: 39,
          genders: [2],
          geo_locations: { countries: ["KR"] },
          targeting_automation: { advantage_audience: 0 },
        }),
      });
      prospectingAdSetId = res.id;
    }
    result.adSetIds.push(prospectingAdSetId);

    // 리타겟팅 광고 세트
    let retargetingAdSetId = existingAdSets[ADSET_RETARGETING];
    if (!retargetingAdSetId) {
      const res = await metaPost(`/${accountId}/adsets`, token, {
        campaign_id: campaign.id,
        name: ADSET_RETARGETING,
        optimization_goal: "LINK_CLICKS",
        billing_event: "IMPRESSIONS",
        daily_budget: "10000",
        bid_strategy: "LOWEST_COST_WITHOUT_CAP",
        status: "PAUSED",
        targeting: JSON.stringify({
          age_min: 20,
          age_max: 39,
          genders: [2],
          targeting_automation: { advantage_audience: 0 },
          geo_locations: { countries: ["KR"] },
        }),
      });
      retargetingAdSetId = res.id;
    }
    result.adSetIds.push(retargetingAdSetId);

    // ── 3. 추천 광고 카피 생성 (소재는 Meta 광고 관리자에서 직접 추가) ──
    for (const product of adProducts.slice(0, 10)) {
      const copy = generateAdCopy(product);
      const discountPct = product.originalPrice > 0
        ? Math.round((1 - product.newPrice / product.originalPrice) * 100)
        : 0;
      result.suggestedCopies.push({
        productName: product.name,
        title: copy.title,
        body: copy.body,
        linkUrl: copy.linkUrl,
        discountPct,
      });
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
  campaignStatus: string | null;
  adSetsCount: number;
  activeAdsCount: number;
  totalSpend: number;
  totalImpressions: number;
  totalClicks: number;
  ctr: number;
}

export async function getClearanceAdStatus(token: string): Promise<ClearanceAdStatus> {
  const empty: ClearanceAdStatus = {
    hasCampaign: false,
    campaignId: null,
    campaignStatus: null,
    adSetsCount: 0,
    activeAdsCount: 0,
    totalSpend: 0,
    totalImpressions: 0,
    totalClicks: 0,
    ctr: 0,
  };

  try {
    const accountId = await getAdAccountId(token);
    const campaign = await findExistingCampaign(token, accountId);
    if (!campaign) return empty;

    // 캠페인 인사이트
    let spend = 0, impressions = 0, clicks = 0;
    try {
      const insights = await metaGet(`/${campaign.id}/insights`, token, {
        fields: "spend,impressions,clicks,ctr",
        date_preset: "last_7d",
      });
      const d = insights.data?.[0];
      if (d) {
        spend = parseFloat(d.spend ?? "0");
        impressions = parseInt(d.impressions ?? "0", 10);
        clicks = parseInt(d.clicks ?? "0", 10);
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
      campaignStatus: campaign.status,
      adSetsCount: (adSets.data ?? []).length,
      activeAdsCount: (ads.data ?? []).length,
      totalSpend: spend,
      totalImpressions: impressions,
      totalClicks: clicks,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    };
  } catch {
    return empty;
  }
}
