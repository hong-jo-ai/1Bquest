import { metaGet } from "@/lib/metaClient";
import { getMetaTokenServer } from "@/lib/metaTokenStore";
import { campaignMatchesBrand, resolveAdAccountId } from "@/lib/metaBrandFilter";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

interface CampaignDailyRow {
  date_start:     string; // YYYY-MM-DD
  campaign_id?:   string;
  campaign_name?: string;
  spend?:         string;
}

function kstDateStr(offsetDays: number = 0): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/**
 * 최근 N일치 메타 광고비를 캠페인 단위로 가져와 일별 합산한다.
 * brand 파라미터가 있으면 캠페인명 패턴으로 필터링 (해리/harriot → harriot, 그 외 → paulvice).
 */
export async function GET(req: NextRequest) {
  const token = await getMetaTokenServer();
  if (!token) {
    return Response.json({ ok: false, error: "Meta 미연결" });
  }

  const days = Math.min(
    Math.max(parseInt(req.nextUrl.searchParams.get("days") ?? "60", 10), 1),
    90
  );
  const brand = req.nextUrl.searchParams.get("brand") ?? "";
  const until = kstDateStr(0);
  const since = kstDateStr(-(days - 1));

  try {
    const accountId = await resolveAdAccountId(token);

    // 일별 × 캠페인별 spend. 90일 × 캠페인 수가 limit을 넘지 않도록 1000 사용.
    const ins = (await metaGet(`/${accountId}/insights`, token, {
      fields:         "spend,campaign_id,campaign_name",
      time_increment: "1",
      time_range:     JSON.stringify({ since, until }),
      level:          "campaign",
      limit:          "1000",
    })) as { data?: CampaignDailyRow[] };

    const dailyMap = new Map<string, number>();
    let matchedCount = 0;
    let skippedCount = 0;

    for (const row of ins.data ?? []) {
      if (!campaignMatchesBrand(row.campaign_name, brand)) {
        skippedCount++;
        continue;
      }
      matchedCount++;
      const cur = dailyMap.get(row.date_start) ?? 0;
      dailyMap.set(row.date_start, cur + parseFloat(row.spend ?? "0"));
    }

    const daily = Array.from(dailyMap.entries())
      .map(([date, spend]) => ({ date, spend: Math.round(spend) }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return Response.json({
      ok: true,
      daily,
      accountId,
      brand: brand || "all",
      since,
      until,
      matchedRows: matchedCount,
      skippedRows: skippedCount,
    });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
