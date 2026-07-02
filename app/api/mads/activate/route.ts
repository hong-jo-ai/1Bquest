import { type NextRequest, NextResponse } from "next/server";
import { getMetaTokenServer } from "@/lib/metaTokenStore";
import { metaGet, metaPost } from "@/lib/metaClient";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/mads/activate  { campaignId, status?, dailyBudget? }
 * - status: 캠페인 + 그 안의 광고세트 + 광고를 모두 ACTIVE(또는 PAUSED)로 전환.
 * - dailyBudget(원, status 없이): CBO 캠페인 일예산만 변경(상태 불변). manual-budget-bump 는
 *   광고세트 전용이라 CBO 는 여기서 처리.
 * 실제 과금 영향 — 관리자 게이트 보호(/api/mads/*).
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { campaignId?: string; status?: string; dailyBudget?: number };
    const campaignId = body.campaignId;
    if (!campaignId) return NextResponse.json({ ok: false, error: "campaignId 필요" }, { status: 400 });
    const token = await getMetaTokenServer();
    if (!token) return NextResponse.json({ ok: false, error: "Meta 토큰 없음" }, { status: 401 });

    // 예산만 변경 (status 미지정 + dailyBudget 지정) — 상태는 건드리지 않음
    const dailyBudget = Number(body.dailyBudget);
    if (!body.status && Number.isFinite(dailyBudget) && dailyBudget > 0) {
      await metaPost(`/${campaignId}`, token, { daily_budget: String(Math.round(dailyBudget)) }); // KRW zero-decimal
      const after = (await metaGet(`/${campaignId}`, token, { fields: "id,name,daily_budget,status" })) as Record<string, unknown>;
      return NextResponse.json({ ok: true, campaignId, dailyBudget: Math.round(dailyBudget), campaign: after });
    }

    const status = (body.status ?? "ACTIVE").toUpperCase();

    const result: Record<string, unknown> = { campaignId, status };
    // 1) 광고세트 + 광고를 먼저 ACTIVE (캠페인만 켜고 하위가 PAUSED면 안 돎)
    const adsets = (await metaGet(`/${campaignId}/adsets`, token, { fields: "id", limit: "50" })) as { data?: Array<{ id: string }> };
    const ads = (await metaGet(`/${campaignId}/ads`, token, { fields: "id", limit: "50" })) as { data?: Array<{ id: string }> };
    for (const a of adsets.data ?? []) await metaPost(`/${a.id}`, token, { status });
    for (const a of ads.data ?? []) await metaPost(`/${a.id}`, token, { status });
    // 2) 캠페인
    await metaPost(`/${campaignId}`, token, { status });
    result.adsets = (adsets.data ?? []).length;
    result.ads = (ads.data ?? []).length;
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
