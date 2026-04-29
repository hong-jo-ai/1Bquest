/**
 * /api/campaigns/export?brand=paulvice&id=<campaignId>&format=csv
 *   GET → 캠페인 구매자 명단 CSV 다운로드 (사후 이메일/SMS 발송용)
 */
import { getCampaign } from "@/lib/campaigns/store";
import { computeCampaignMetrics } from "@/lib/campaigns/metrics";
import type { CampaignBrand } from "@/lib/campaigns/types";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

function csvEscape(v: string | number | null | undefined): string {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(req: NextRequest) {
  const brand = req.nextUrl.searchParams.get("brand");
  const id    = req.nextUrl.searchParams.get("id");

  if (brand !== "paulvice") {
    return new Response("brand=paulvice 만 지원", { status: 400 });
  }
  if (!id) {
    return new Response("id 필수", { status: 400 });
  }

  const campaign = await getCampaign(brand as CampaignBrand, id);
  if (!campaign) return new Response("캠페인 없음", { status: 404 });

  const metrics = await computeCampaignMetrics(campaign);

  const rows = [
    ["주문번호", "구매자명", "이메일", "휴대폰", "결제금액", "주문일시"].join(","),
    ...metrics.buyers.map((b) =>
      [b.orderId, b.name, b.email, b.phone, b.amount, b.orderedAt].map(csvEscape).join(",")
    ),
  ].join("\n");

  // BOM + CSV — 한글 엑셀 호환
  const body = "﻿" + rows;
  const filename = `campaign_${campaign.id}_buyers.csv`;

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type":        "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control":       "no-store",
    },
  });
}
