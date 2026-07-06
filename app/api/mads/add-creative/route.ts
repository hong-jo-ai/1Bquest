import { type NextRequest, NextResponse } from "next/server";
import { getMetaTokenServer } from "@/lib/metaTokenStore";
import { resolveAdAccountId } from "@/lib/metaBrandFilter";
import { metaGet, metaPost } from "@/lib/metaClient";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 기존 광고세트에 "소재(광고)만 하나 더" 추가한다. 새 캠페인/세트를 만들지 않으므로
 * 같은 예산 안에서 소재끼리 경쟁(메타 자동 배분)시킬 수 있다. 전부 PAUSED 로 생성.
 * (createPausedAd 는 항상 새 캠페인을 만들어 이 용도엔 부적합.)
 *
 * GET  /api/mads/add-creative        → 계정의 광고세트+광고+크리에이티브 목록(기존 세트/참조 소재 찾기용)
 * POST /api/mads/add-creative        → { adsetId, imageBase64|imageUrl|imageHash, pageId, link,
 *                                        message, headline?, description?, ctaType?, instagramActorId?,
 *                                        adName?, confirm } — confirm 없으면 dryRun.
 */

async function uploadImageHash(
  token: string,
  accountId: string,
  opts: { imageUrl?: string; imageBase64?: string },
): Promise<string> {
  let b64 = opts.imageBase64;
  if (!b64 && opts.imageUrl) {
    const resp = await fetch(opts.imageUrl);
    if (!resp.ok) throw new Error(`이미지 다운로드 실패: ${resp.status}`);
    b64 = Buffer.from(await resp.arrayBuffer()).toString("base64");
  }
  if (!b64) throw new Error("imageBase64 또는 imageUrl 필요");
  const out = (await metaPost(`/${accountId}/adimages`, token, { bytes: b64 })) as {
    images?: Record<string, { hash: string }>;
  };
  const first = out.images ? Object.values(out.images)[0] : undefined;
  if (!first?.hash) throw new Error(`이미지 업로드 응답에 hash 없음: ${JSON.stringify(out).slice(0, 200)}`);
  return first.hash;
}

export async function GET(req: NextRequest) {
  try {
    const token = await getMetaTokenServer();
    if (!token) return NextResponse.json({ ok: false, error: "Meta 토큰 없음" }, { status: 401 });
    const accountId = req.nextUrl.searchParams.get("account") ?? (await resolveAdAccountId(token));
    const ads = (await metaGet(`/${accountId}/ads`, token, {
      fields: "id,name,adset_id,effective_status,creative{id,object_story_spec}",
      limit: "80",
    })) as { data?: unknown[] };
    const adsets = (await metaGet(`/${accountId}/adsets`, token, {
      fields: "id,name,effective_status,daily_budget,campaign{name}",
      limit: "80",
    })) as { data?: unknown[] };
    return NextResponse.json({ ok: true, accountId, adsets: adsets.data ?? [], ads: ads.data ?? [] });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      adsetId?: string;
      imageUrl?: string;
      imageBase64?: string;
      imageHash?: string;
      link?: string;
      message?: string;
      headline?: string;
      description?: string;
      ctaType?: string;
      pageId?: string;
      instagramActorId?: string;
      adName?: string;
      status?: string;
      confirm?: boolean;
    };
    const token = await getMetaTokenServer();
    if (!token) return NextResponse.json({ ok: false, error: "Meta 토큰 없음" }, { status: 401 });
    const accountId = req.nextUrl.searchParams.get("account") ?? (await resolveAdAccountId(token));

    if (!body.adsetId) return NextResponse.json({ ok: false, error: "adsetId 필수" }, { status: 400 });
    if (!body.pageId) return NextResponse.json({ ok: false, error: "pageId 필수(브랜드 페이지)" }, { status: 400 });
    if (!body.link) return NextResponse.json({ ok: false, error: "link 필수" }, { status: 400 });
    if (!body.imageBase64 && !body.imageUrl && !body.imageHash)
      return NextResponse.json({ ok: false, error: "imageBase64/imageUrl/imageHash 중 하나 필수" }, { status: 400 });

    const plan = {
      adsetId: body.adsetId,
      pageId: body.pageId,
      link: body.link,
      message: body.message ?? "",
      headline: body.headline,
      description: body.description,
      ctaType: body.ctaType ?? "SHOP_NOW",
      instagramActorId: body.instagramActorId,
      adName: body.adName ?? "추가 소재",
      status: body.status === "ACTIVE" ? "ACTIVE" : "PAUSED",
    };

    if (!body.confirm) return NextResponse.json({ ok: true, dryRun: true, accountId, plan });

    const imageHash =
      body.imageHash ?? (await uploadImageHash(token, accountId, { imageUrl: body.imageUrl, imageBase64: body.imageBase64 }));

    const linkData: Record<string, unknown> = {
      image_hash: imageHash,
      link: plan.link,
      message: plan.message,
      call_to_action: { type: plan.ctaType, value: { link: plan.link } },
    };
    if (plan.headline) linkData.name = plan.headline;
    if (plan.description) linkData.description = plan.description;
    const storySpec: Record<string, unknown> = { page_id: plan.pageId, link_data: linkData };
    if (plan.instagramActorId) storySpec.instagram_actor_id = plan.instagramActorId;

    const creative = (await metaPost(`/${accountId}/adcreatives`, token, {
      name: `${plan.adName} | 크리에이티브`,
      object_story_spec: JSON.stringify(storySpec),
    })) as { id: string };

    const ad = (await metaPost(`/${accountId}/ads`, token, {
      name: plan.adName,
      adset_id: plan.adsetId,
      creative: JSON.stringify({ creative_id: creative.id }),
      status: plan.status,
    })) as { id: string };

    const acctNum = accountId.replace(/^act_/, "");
    return NextResponse.json({
      ok: true,
      dryRun: false,
      imageHash,
      creativeId: creative.id,
      adId: ad.id,
      status: plan.status,
      managerUrl: `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${acctNum}&selected_adset_ids=${plan.adsetId}`,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
