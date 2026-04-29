/**
 * /api/campaigns/metrics?brand=paulvice&id=<campaignId>
 *   GET → 캠페인 메트릭 (주문 수, 매출, 평균 주문, 구매자 명단)
 */
import { getCampaign } from "@/lib/campaigns/store";
import { computeCampaignMetrics } from "@/lib/campaigns/metrics";
import type { CampaignBrand } from "@/lib/campaigns/types";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const brand = req.nextUrl.searchParams.get("brand");
  const id    = req.nextUrl.searchParams.get("id");

  if (brand !== "paulvice" && brand !== "harriot") {
    return Response.json({ ok: false, error: "brand 필수" }, { status: 400 });
  }
  if (!id) {
    return Response.json({ ok: false, error: "id 필수" }, { status: 400 });
  }

  try {
    const campaign = await getCampaign(brand as CampaignBrand, id);
    if (!campaign) {
      return Response.json({ ok: false, error: "캠페인 없음" }, { status: 404 });
    }
    if (brand === "harriot") {
      return Response.json({
        ok: false,
        error: "해리엇 채널은 캠페인 매출 자동 매칭 미지원 (Cafe24 미사용). 추후 식스샵 연동 시 추가.",
      }, { status: 501 });
    }
    const metrics = await computeCampaignMetrics(campaign);
    return Response.json({ ok: true, metrics });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
