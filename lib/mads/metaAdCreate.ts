/**
 * Meta 신규 광고 생성 (전부 PAUSED).
 *
 * 흐름(이미지): 이미지 업로드(adimages) → 캠페인 → 크리에이티브(link_data) → 광고세트 → 광고.
 * 흐름(영상): 영상 업로드(advideos, file_url) → 처리대기 → 썸네일 → 크리에이티브(video_data) → …
 * 모든 객체는 status="PAUSED"로 생성 → 실제 과금은 사장님이 광고관리자에서 "켜기" 해야 시작.
 *
 * KRW는 zero-decimal 통화: dailyBudget=20000 → ₩20,000.
 * objective: "OUTCOME_SALES"(픽셀 구매 최적화) | "OUTCOME_TRAFFIC"(랜딩페이지 조회).
 */
import { metaGet, metaPost, metaDelete } from "../metaClient";
import { inferBrandFromCampaign, type Brand } from "../metaBrandFilter";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 광고계정(act_3644222039208759)은 폴바이스·해리엇 공유 → 페이지·픽셀이 둘 다 붙어 있다.
 * 자동탐색(resolvePageId/resolvePixelId)은 "첫 자산"을 잡아 브랜드가 뒤섞이는 사고를 낸다
 * (폴바이스 광고가 harriot IG로 나가거나, 폴바이스 판매광고에 해리엇 픽셀/전환없음으로 붙음).
 * → 캠페인 이름으로 브랜드를 추론해 브랜드별 자산을 기본값으로 사용한다.
 *   우선순위: 명시 input > 브랜드 매핑 > 자동탐색 폴백.
 */
const BRAND_PAGES: Record<Brand, string> = {
  paulvice: "224841717389800",   // 폴바이스 페이지/IG
  harriot:  "108567565391400",   // harriotwatches 페이지/IG
};
const BRAND_PIXELS: Record<Brand, string> = {
  paulvice: "7740091496041900",  // 폴바이스 자사몰(icaruse2000) 픽셀
  harriot:  "2532682890498749",  // 해리엇 skin4 주문완료 픽셀
};

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
  /** 소재(이미지): 둘 중 하나. imageUrl이면 내부에서 받아 업로드. */
  imageUrl?: string;
  imageHash?: string;
  /** 소재(영상): videoUrl(공개 URL, advideos로 업로드) 또는 이미 올린 videoId. 있으면 영상 광고로 생성. */
  videoUrl?: string;
  videoId?: string;
  /** 영상 썸네일 URL(선택). 없으면 Meta 자동 생성 썸네일 사용. */
  thumbnailUrl?: string;
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
  /** OUTCOME_SALES 최적화 이벤트. 기본 PURCHASE. 콜드 시작은 ADD_TO_CART 등으로 학습 가속. */
  customEventType?: string;
  /** 생성 상태. 기본 PAUSED(안전). "ACTIVE"면 즉시 노출·과금 시작. */
  status?: "PAUSED" | "ACTIVE";
}

export interface CreateAdResult {
  campaignId: string;
  adsetId: string;
  creativeId: string;
  adId: string;
  imageHash: string;
  videoId: string;
  pageId: string;
  pixelId: string | null;
  status: "PAUSED" | "ACTIVE";
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

/** 공개 영상 URL을 advideos(file_url)로 업로드 → 처리완료까지 대기 → video_id 반환. */
async function uploadVideo(token: string, accountId: string, videoUrl: string): Promise<string> {
  const up = (await metaPost(`/${accountId}/advideos`, token, { file_url: videoUrl })) as { id?: string };
  if (!up.id) throw new Error(`영상 업로드 응답에 id 없음: ${JSON.stringify(up)}`);
  // Meta가 file_url을 내려받아 인코딩 → ready 될 때까지 폴링(최대 ~45s).
  for (let i = 0; i < 15; i++) {
    const s = (await metaGet(`/${up.id}`, token, { fields: "status" })) as
      { status?: { video_status?: string } };
    const st = s.status?.video_status;
    if (st === "ready") return up.id;
    if (st === "error") throw new Error(`영상 처리 실패(video_id=${up.id})`);
    await sleep(3000);
  }
  // 아직 처리 중이어도 id는 유효 — 크리에이티브 생성은 대개 통과, 광고는 PAUSED라 문제없음.
  return up.id;
}

/** video_id의 Meta 자동 생성 썸네일 URI(선호본 우선) 반환. */
async function getVideoThumbnailUrl(token: string, videoId: string): Promise<string | undefined> {
  try {
    const r = (await metaGet(`/${videoId}/thumbnails`, token, { fields: "uri,is_preferred" })) as
      { data?: Array<{ uri: string; is_preferred?: boolean }> };
    return (r.data?.find((t) => t.is_preferred) ?? r.data?.[0])?.uri;
  } catch {
    return undefined;
  }
}

function defaultTargeting(): Record<string, unknown> {
  return {
    geo_locations: { countries: ["KR"] },
    genders: [2],          // 1=남, 2=여
    // 2026-08-25 실측 기반. 메타 최근 90일 여성 구매 ROAS:
    //   45-54 → 3.14 (매출 53.9%, 핵심)  |  25-34 → 2.66  |  55-64 → 2.37  |  35-44 → 2.07  |  65+ → 1.22
    // 상한을 55 → 64 로 넓힌다: 55-64 는 ROAS 2.37 로 이미 많이 쓰는 35-44 보다 낫다.
    // 65+ 는 ROAS 1.22 라 제외. 하한 25 유지 — 25-34 도 ROAS 2.66 으로 버틴다.
    // ⚠️ 40~50 으로 좁히지 말 것. 25~44 가 매출의 35%다.
    age_min: 25,
    age_max: 64,
    // Advantage+ 오디언스는 age_max<65 와 충돌 → 명시 타깃 사용(끔).
    targeting_automation: { advantage_audience: 0 },
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
    videoUrl, videoId: givenVideoId, thumbnailUrl,
    instagramActorId,
    startTime, endTime,
    customEventType = "PURCHASE", // OUTCOME_SALES 최적화 이벤트(PURCHASE | ADD_TO_CART | ...)
    status = "PAUSED",
  } = input;

  const isVideo = Boolean(videoUrl || givenVideoId);
  if (!isVideo && !givenHash && !imageUrl) {
    throw new Error("소재가 필요합니다: videoUrl/videoId(영상) 또는 imageUrl/imageHash(이미지).");
  }

  // 캠페인 이름으로 브랜드 추론(미매칭=폴바이스) → 브랜드별 페이지·픽셀을 기본값으로.
  const brand = inferBrandFromCampaign(name);
  const pageId  = input.pageId  ?? BRAND_PAGES[brand]  ?? await resolvePageId(token, accountId);
  const pixelId = objective === "OUTCOME_SALES"
    ? (input.pixelId ?? BRAND_PIXELS[brand] ?? await resolvePixelId(token, accountId))
    : null;

  // 소재 준비: 영상이면 advideos 업로드+썸네일, 아니면 adimages 업로드.
  let imageHash = "";
  let videoId = "";
  let thumbHash: string | undefined;
  let thumbUrl: string | undefined;
  if (isVideo) {
    videoId = givenVideoId ?? await uploadVideo(token, accountId, videoUrl!);
    if (thumbnailUrl) thumbHash = await uploadImage(token, accountId, thumbnailUrl);
    else thumbUrl = await getVideoThumbnailUrl(token, videoId);
  } else {
    imageHash = givenHash ?? await uploadImage(token, accountId, imageUrl!);
  }

  // 1) 캠페인 (PAUSED)
  // CBO(캠페인 예산) 미사용 → is_adset_budget_sharing_enabled 명시 필수(최신 API).
  const campaign = (await metaPost(`/${accountId}/campaigns`, token, {
    name: `${name} | 캠페인`,
    objective,
    status,
    special_ad_categories: "[]",
    is_adset_budget_sharing_enabled: "false",
  })) as { id: string };

  // 캠페인 이후 단계 실패 시 → 빈 캠페인 롤백(삭제) 후 에러 전파.
  try {
  // 2) 광고 크리에이티브 (영상=video_data / 이미지=link_data)
  const storySpec: Record<string, unknown> = { page_id: pageId };
  if (isVideo) {
    const videoData: Record<string, unknown> = {
      video_id: videoId,
      message,
      call_to_action: { type: ctaType, value: { link } },
    };
    // video_data는 썸네일(image_hash 또는 image_url) 필수.
    if (thumbHash) videoData.image_hash = thumbHash;
    else if (thumbUrl) videoData.image_url = thumbUrl;
    if (headline) videoData.title = headline;
    if (description) videoData.link_description = description;
    storySpec.video_data = videoData;
  } else {
    const linkData: Record<string, unknown> = {
      image_hash: imageHash,
      link,
      message,
      call_to_action: { type: ctaType, value: { link } },
    };
    if (headline) linkData.name = headline;
    if (description) linkData.description = description;
    storySpec.link_data = linkData;
  }
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
    status,
  };
  if (objective === "OUTCOME_SALES" && pixelId) {
    adsetParams.optimization_goal = "OFFSITE_CONVERSIONS";
    adsetParams.promoted_object = JSON.stringify({ pixel_id: pixelId, custom_event_type: customEventType });
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
    status,
  })) as { id: string };

  const acctNum = accountId.replace(/^act_/, "");
  return {
    campaignId: campaign.id,
    adsetId: adset.id,
    creativeId: creative.id,
    adId: ad.id,
    imageHash,
    videoId,
    pageId,
    pixelId,
    status,
    managerUrl: `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${acctNum}&selected_campaign_ids=${campaign.id}`,
  };
  } catch (err) {
    // 빈 캠페인 정리 (실패 누적 방지)
    await metaDelete(`/${campaign.id}`, token).catch(() => {});
    throw err;
  }
}
