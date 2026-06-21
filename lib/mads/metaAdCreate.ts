/**
 * Meta 신규 광고 생성 (전부 PAUSED).
 *
 * 흐름: 이미지 업로드(adimages) → 캠페인 → 광고 크리에이티브 → 광고세트 → 광고.
 * 모든 객체는 status="PAUSED"로 생성 → 실제 과금은 사장님이 광고관리자에서 "켜기" 해야 시작.
 *
 * KRW는 zero-decimal 통화: dailyBudget=20000 → ₩20,000.
 * objective: "OUTCOME_SALES"(픽셀 구매 최적화) | "OUTCOME_TRAFFIC"(랜딩페이지 조회).
 */
import { metaGet, metaPost } from "../metaClient";

export interface CreateAdInput {
  /** 광고계정 (act_ 포함). 생략 시 resolveAdAccountId 사용. */
  accountId: string;
  token: string;
  /** 캠페인/광고세트/광고 공통 베이스 이름. */
  name: string;
  objective?: "OUTCOME_SALES" | "OUTCOME_TRAFFIC";
  /** 일예산 (원). 기본 20000. */
  dailyBudget?: number;
  /** 랜딩 URL. */
  link: string;
  /** 광고 문구. */
  message: string;
  headline?: string;
  description?: string;
  ctaType?: string; // 기본 SHOP_NOW
  /** 소재: 둘 중 하나. imageUrl이면 내부에서 받아 업로드. */
  imageUrl?: string;
  imageHash?: string;
  /** 페북 페이지 ID. 생략 시 자동탐색(첫 페이지). */
  pageId?: string;
  /** 인스타그램 actor ID(선택). */
  instagramActorId?: string;
  /** 전환 픽셀 ID (OUTCOME_SALES일 때). 생략 시 자동탐색. */
  pixelId?: string;
  /** ISO 시간. 생략 시 광고세트 즉시~무기한(단 PAUSED). */
  startTime?: string;
  endTime?: string;
  /** 타깃 오버라이드. 생략 시 KR 여성 25-50 자동노출. */
  targeting?: Record<string, unknown>;
}

export interface CreateAdResult {
  campaignId: string;
  adsetId: string;
  creativeId: string;
  adId: string;
  imageHash: string;
  pageId: string;
  pixelId: string | null;
  status: "PAUSED";
  managerUrl: string;
}

/** 광고에 쓸 페이지 ID 자동탐색 (promote_pages → /me/accounts 순). */
async function resolvePageId(token: string, accountId: string): Promise<string> {
  try {
    const r = (await metaGet(`/${accountId}`, token, { fields: "promote_pages{id,name}" })) as
      { promote_pages?: { data?: Array<{ id: string }> } };
    const p = r.promote_pages?.data?.[0]?.id;
    if (p) return p;
  } catch { /* fallthrough */ }
  const me = (await metaGet("/me/accounts", token, { fields: "id,name", limit: "5" })) as
    { data?: Array<{ id: string }> };
  const pid = me.data?.[0]?.id;
  if (!pid) throw new Error("페이지를 찾을 수 없습니다. pageId를 명시하세요.");
  return pid;
}

/** 계정의 첫 활성 픽셀 ID 자동탐색. */
async function resolvePixelId(token: string, accountId: string): Promise<string | null> {
  try {
    const r = (await metaGet(`/${accountId}/adspixels`, token, { fields: "id,name", limit: "5" })) as
      { data?: Array<{ id: string }> };
    return r.data?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

/** 이미지 URL을 받아 adimages로 업로드 → image_hash 반환. */
async function uploadImage(token: string, accountId: string, imageUrl: string): Promise<string> {
  const resp = await fetch(imageUrl);
  if (!resp.ok) throw new Error(`소재 이미지 다운로드 실패: ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  const b64 = buf.toString("base64");
  const out = (await metaPost(`/${accountId}/adimages`, token, { bytes: b64 })) as
    { images?: Record<string, { hash: string }> };
  const first = out.images ? Object.values(out.images)[0] : undefined;
  if (!first?.hash) throw new Error(`이미지 업로드 응답에 hash 없음: ${JSON.stringify(out)}`);
  return first.hash;
}

function defaultTargeting(): Record<string, unknown> {
  return {
    geo_locations: { countries: ["KR"] },
    genders: [2],          // 1=남, 2=여
    age_min: 25,
    age_max: 50,
    targeting_automation: { advantage_audience: 1 },
  };
}

export async function createPausedAd(input: CreateAdInput): Promise<CreateAdResult> {
  const {
    accountId, token, name,
    objective = "OUTCOME_SALES",
    dailyBudget = 20000,
    link, message,
    headline, description,
    ctaType = "SHOP_NOW",
    imageUrl, imageHash: givenHash,
    instagramActorId,
    startTime, endTime,
  } = input;

  if (!givenHash && !imageUrl) throw new Error("imageUrl 또는 imageHash가 필요합니다.");

  const pageId  = input.pageId  ?? await resolvePageId(token, accountId);
  const pixelId = objective === "OUTCOME_SALES"
    ? (input.pixelId ?? await resolvePixelId(token, accountId))
    : null;
  const imageHash = givenHash ?? await uploadImage(token, accountId, imageUrl!);

  // 1) 캠페인 (PAUSED)
  // CBO(캠페인 예산) 미사용 → is_adset_budget_sharing_enabled 명시 필수(최신 API).
  const campaign = (await metaPost(`/${accountId}/campaigns`, token, {
    name: `${name} | 캠페인`,
    objective,
    status: "PAUSED",
    special_ad_categories: "[]",
    is_adset_budget_sharing_enabled: "false",
  })) as { id: string };

  // 2) 광고 크리에이티브
  const linkData: Record<string, unknown> = {
    image_hash: imageHash,
    link,
    message,
    call_to_action: { type: ctaType, value: { link } },
  };
  if (headline) linkData.name = headline;
  if (description) linkData.description = description;

  const storySpec: Record<string, unknown> = { page_id: pageId, link_data: linkData };
  if (instagramActorId) storySpec.instagram_actor_id = instagramActorId;

  const creative = (await metaPost(`/${accountId}/adcreatives`, token, {
    name: `${name} | 크리에이티브`,
    object_story_spec: JSON.stringify(storySpec),
  })) as { id: string };

  // 3) 광고세트 (PAUSED)
  const adsetParams: Record<string, string> = {
    name: `${name} | 광고세트`,
    campaign_id: campaign.id,
    daily_budget: String(Math.round(dailyBudget)),  // KRW zero-decimal
    billing_event: "IMPRESSIONS",
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    targeting: JSON.stringify(input.targeting ?? defaultTargeting()),
    status: "PAUSED",
  };
  if (objective === "OUTCOME_SALES" && pixelId) {
    adsetParams.optimization_goal = "OFFSITE_CONVERSIONS";
    adsetParams.promoted_object = JSON.stringify({ pixel_id: pixelId, custom_event_type: "PURCHASE" });
  } else if (objective === "OUTCOME_TRAFFIC") {
    adsetParams.optimization_goal = "LANDING_PAGE_VIEWS";
  } else {
    // SALES 인데 픽셀 없음 → 전환최적화 불가 → 링크클릭으로 폴백(픽셀 없이도 동작).
    adsetParams.optimization_goal = "LINK_CLICKS";
  }
  if (startTime) adsetParams.start_time = startTime;
  if (endTime) adsetParams.end_time = endTime;

  const adset = (await metaPost(`/${accountId}/adsets`, token, adsetParams)) as { id: string };

  // 4) 광고 (PAUSED)
  const ad = (await metaPost(`/${accountId}/ads`, token, {
    name: `${name} | 광고`,
    adset_id: adset.id,
    creative: JSON.stringify({ creative_id: creative.id }),
    status: "PAUSED",
  })) as { id: string };

  const acctNum = accountId.replace(/^act_/, "");
  return {
    campaignId: campaign.id,
    adsetId: adset.id,
    creativeId: creative.id,
    adId: ad.id,
    imageHash,
    pageId,
    pixelId,
    status: "PAUSED",
    managerUrl: `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${acctNum}&selected_campaign_ids=${campaign.id}`,
  };
}
