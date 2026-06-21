import { type NextRequest, NextResponse } from "next/server";
import { getMetaTokenServer } from "@/lib/metaTokenStore";
import { resolveAdAccountId } from "@/lib/metaBrandFilter";
import { createPausedAd, type CreateAdInput } from "@/lib/mads/metaAdCreate";
import { metaGet } from "@/lib/metaClient";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/mads/create-ad?account=act_xxx
 * 계정의 최근 캠페인·광고 목록(이름·상태·생성시각) 조회 — 검증용.
 */
export async function GET(req: NextRequest) {
  try {
    const token = await getMetaTokenServer();
    if (!token) return NextResponse.json({ ok: false, error: "Meta 토큰 없음" }, { status: 401 });
    const accountId = req.nextUrl.searchParams.get("account") ?? (await resolveAdAccountId(token));
    const campaigns = (await metaGet(`/${accountId}/campaigns`, token, {
      fields: "id,name,status,effective_status,objective,created_time,daily_budget",
      limit: "30",
    })) as { data?: unknown[] };
    const ads = (await metaGet(`/${accountId}/ads`, token, {
      fields: "id,name,status,effective_status,created_time,creative{id,object_story_spec}",
      limit: "30",
    })) as { data?: unknown[] };
    return NextResponse.json({ ok: true, accountId, campaigns: campaigns.data ?? [], ads: ads.data ?? [] });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

/**
 * POST /api/mads/create-ad
 *
 * 새 Meta 광고를 전부 PAUSED 로 생성. 실제 과금은 광고관리자에서 "켜기" 해야 시작.
 * body 미지정 시 여름세트(상품 248) 기본값 사용.
 * 안전장치: { confirm: true } 가 없으면 생성하지 않고 미리보기(dryRun)만 반환.
 */

const SUMMER_DEFAULTS = {
  name: "PLVE 여름세트 0625",
  objective: "OUTCOME_SALES" as const,
  dailyBudget: 20000,
  link: "https://paulvice.co.kr/product/detail.html?product_no=248",
  message:
    "한여름, 손목 위에 시계 한 점과 팔찌 하나 ☀️\n\n" +
    "PAULVICE 에끌라 오벌 워치 + 큐빅 커프 팔찌\n" +
    "따로 사면 ₩138,570 → 여름 세트 ₩119,000\n\n" +
    "무료 각인으로 이름·기념일까지 새겨, 세상에 하나뿐인 선물로.\n" +
    "🎁 무료 선물포장 · 주문당일 발송 · 정식 6개월 A/S",
  headline: "시계 + 팔찌 여름 세트 ₩119,000",
  description: "무료 각인 · 선물포장 · 당일발송",
  ctaType: "SHOP_NOW",
  imageUrl:
    "https://ecimg.cafe24img.com/pg799b36658487045/icaruse2000/web/upload/NNEditor/20260621/2e7241484a1b48a03f68b0bbcd83a67b.png",
  startTime: "2026-06-25T00:00:00+0900",
  endTime: "2026-07-20T23:59:59+0900",
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Partial<CreateAdInput> & { confirm?: boolean };

    const token = await getMetaTokenServer();
    if (!token) {
      return NextResponse.json({ ok: false, error: "Meta 토큰 없음 — 재연결 필요" }, { status: 401 });
    }
    const accountId = body.accountId ?? (await resolveAdAccountId(token));

    const plan = {
      accountId,
      name: body.name ?? SUMMER_DEFAULTS.name,
      objective: body.objective ?? SUMMER_DEFAULTS.objective,
      dailyBudget: body.dailyBudget ?? SUMMER_DEFAULTS.dailyBudget,
      link: body.link ?? SUMMER_DEFAULTS.link,
      message: body.message ?? SUMMER_DEFAULTS.message,
      headline: body.headline ?? SUMMER_DEFAULTS.headline,
      description: body.description ?? SUMMER_DEFAULTS.description,
      ctaType: body.ctaType ?? SUMMER_DEFAULTS.ctaType,
      imageUrl: body.imageUrl ?? (body.imageHash ? undefined : SUMMER_DEFAULTS.imageUrl),
      imageHash: body.imageHash,
      pageId: body.pageId,
      instagramActorId: body.instagramActorId,
      pixelId: body.pixelId,
      startTime: body.startTime ?? SUMMER_DEFAULTS.startTime,
      endTime: body.endTime ?? SUMMER_DEFAULTS.endTime,
      targeting: body.targeting,
    };

    // 안전장치: confirm 없으면 미리보기만
    if (!body.confirm) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        message: "confirm:true 를 보내면 위 설정으로 PAUSED 광고를 생성합니다. (실제 과금은 광고관리자에서 켜야 시작)",
        plan: { ...plan, dailyBudgetKRW: `₩${plan.dailyBudget.toLocaleString()}` },
      });
    }

    const result = await createPausedAd({ token, ...plan } as CreateAdInput);
    return NextResponse.json({ ok: true, dryRun: false, created: result });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
